using System.Text;
namespace ScannerAgent;
internal sealed class AgentContext : ApplicationContext
{
    private readonly RawInput _raw = new(); private readonly ApiClient _api = new(); private readonly NotifyIcon _tray; private readonly StringBuilder _buffer = new(); private readonly List<long> _times = []; private readonly SemaphoreSlim _sending = new(1, 1);
    private readonly System.Windows.Forms.Timer _retry = new() { Interval = 15_000 }, _clock = new() { Interval = 1000 }; private readonly EventWaitHandle _activate = new(false, EventResetMode.AutoReset, Program.ActivateEventName); private readonly RegisteredWaitHandle _activationWait;
    private AgentConfig _config = new(); private WorkerForm? _worker; private SettingsForm? _settings; private ShiftState _shift = new(); private bool _shiftKey; private bool _exiting; private int _flushRequested;
    public AgentContext()
    {
        AgentLog.Info($"startup version={AgentLog.Version}");
        _tray = new NotifyIcon { Icon = SystemIcons.Application, Visible = true, Text = "Складской scanner-agent" }; _tray.ContextMenuStrip = BuildMenu(); _tray.DoubleClick += (_, _) => ShowMainWindow();
        _activationWait = ThreadPool.RegisterWaitForSingleObject(_activate, (_, _) => { var form = _settings as Form ?? _worker; if (form is { IsHandleCreated: true }) form.BeginInvoke(ShowMainWindow); }, null, Timeout.Infinite, false);
        _raw.KeyReceived += OnKey; _retry.Tick += async (_, _) => await FlushQueue(); _retry.Start(); _clock.Tick += (_, _) => _worker?.UpdateTimer(_shift); _clock.Start();
        var existing = Storage.LoadConfig(); if (existing is null || !existing.IsComplete || string.IsNullOrWhiteSpace(Storage.LoadToken())) OpenSettings(existing, true); else { _config = existing; ShowWorker(); _ = RestoreShift(); }
    }
    private ContextMenuStrip BuildMenu() { var m = new ContextMenuStrip(); m.Items.Add("Открыть настройки", null, (_, _) => OpenSettings(_config)); m.Items.Add("Статус", null, (_, _) => ShowMainWindow()); m.Items.Add("Сменить сотрудника", null, (_, _) => OpenSettings(_config)); m.Items.Add(new ToolStripSeparator()); m.Items.Add("Выход", null, (_, _) => Exit()); return m; }
    private void OpenSettings(AgentConfig? config = null, bool required = false)
    {
        if (_settings is { IsDisposed: false }) { ShowFront(_settings); return; }
        _settings = new SettingsForm(config, _raw); _settings.FormClosing += (_, e) => { if (required && _settings.DialogResult != DialogResult.OK && !_exiting) { e.Cancel = true; ShowFront(_settings); } }; _settings.FormClosed += async (_, _) => { var form = _settings; if (form?.DialogResult == DialogResult.OK && form.Result is { } result) { _config = result; Storage.SaveConfig(_config, form.Token); ShowWorker(); await RestoreShift(); } _settings = null; }; _settings.Show(); ShowFront(_settings);
    }
    private void ShowWorker() { if (_worker is null || _worker.IsDisposed) { _worker = new WorkerForm(); _worker.ShiftActionRequested += async action => await ChangeShift(action); _worker.SettingsRequested += () => OpenSettings(_config); } _worker.ShowFront(); UpdateTooltip("Работает"); }
    private void ShowMainWindow() { if (_settings is { IsDisposed: false, Visible: true }) ShowFront(_settings); else if (_config.IsComplete) ShowWorker(); else OpenSettings(_config, true); }
    private static void ShowFront(Form f) { if (!f.Visible) f.Show(); if (f.WindowState == FormWindowState.Minimized) f.WindowState = FormWindowState.Normal; f.TopMost = true; f.Activate(); f.BringToFront(); f.BeginInvoke(() => f.TopMost = false); }
    private async Task RestoreShift() { try { _shift = await _api.GetShiftAsync(_config); _worker?.SetServerState(ConnectionState.Connected); _worker?.SetShift(_shift); _worker?.SetPending(Storage.LoadQueue().Count); await FlushQueue(); } catch (HttpRequestException ex) { SetFailure(ex); } }
    private async Task ChangeShift(string action)
    {
        try { var finished = action == "finish"; _worker?.SetServerState(ConnectionState.Waiting); _shift = await RetryShift(action); _worker?.SetConnection(true); _worker?.SetShift(_shift); if (finished) MessageBox.Show($"Активное время: {TimeSpan.FromSeconds(_shift.ActiveSeconds):hh\\:mm\\:ss}\nОбщее время: {TimeSpan.FromSeconds(_shift.TotalSeconds):hh\\:mm\\:ss}\nЗаказов: {_shift.Orders}\nЗаработано: {_shift.Earnings:N2} ₽\nПауз: {_shift.PauseCount}\nВремя пауз: {TimeSpan.FromSeconds(_shift.PauseSeconds):hh\\:mm\\:ss}\nМедианный интервал: {(_shift.MedianIntervalSeconds.HasValue ? TimeSpan.FromSeconds(_shift.MedianIntervalSeconds.Value).ToString(@"hh\:mm\:ss") : "—")}", "Итоги смены"); }
        catch (AgentApiException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized) { SetAuthorizationError(); _worker?.SetNotice(ex.Message, true); }
        catch (AgentApiException ex) { SetFailure(ex); _worker?.SetNotice(ex.Message, true); }
        catch (Exception ex) { _worker?.SetServerState(ConnectionState.Waiting); _worker?.SetNotice($"Ожидание связи: {ex.Message}", true); }
    }
    private async Task<ShiftState> RetryShift(string action)
    {
        var delays = new[] { 0, 2, 5, 10, 15 };
        HttpRequestException? last = null;
        foreach (var seconds in delays) { if (seconds > 0) await Task.Delay(TimeSpan.FromSeconds(seconds)); try { return await _api.ShiftActionAsync(_config, action); } catch (HttpRequestException ex) when (ex.StatusCode is null || (int)ex.StatusCode >= 500) { last = ex; SetFailure(ex); } }
        throw last ?? new HttpRequestException("Ожидание связи");
    }
    private void OnKey(string device, Keys key) { if (!string.Equals(device, _config.ScannerDevice, StringComparison.OrdinalIgnoreCase)) return; if (key is Keys.ShiftKey or Keys.LShiftKey or Keys.RShiftKey) { _shiftKey = true; return; } if (key == Keys.Enter) { if (_buffer.Length >= 8 && _buffer.ToString().All(char.IsDigit)) CompleteScan(); else Reset(); return; } var c = RawInput.Character(key, _shiftKey); _shiftKey = false; if (c is >= ' ' and <= '~') { _buffer.Append(c); _times.Add(Environment.TickCount64); if (_buffer.Length > 512) Reset(); } }
    private void CompleteScan() { if (_shift.Status != "active" || !_shift.Id.HasValue) { _worker?.SetNotice(_shift.Status == "paused" ? "Смена на паузе" : "Сначала начните смену", true); Reset(); return; } var duration = _times.Count > 1 ? (int)Math.Min(600_000, _times[^1] - _times[0]) : 0; var average = _times.Count > 1 ? (double)duration / (_times.Count - 1) : 0; var item = new ScanEvent(Guid.NewGuid(), _buffer.ToString(), _config.EmployeeIdentifier, duration, _config.ScannerDevice, DateTimeOffset.Now, new ScanInputMetadata(average, "windows-agent"), _shift.Id); Storage.Enqueue(item); _worker?.SetPending(Storage.LoadQueue().Count); AgentLog.Info($"queued event_id={item.EventId} queue={Storage.LoadQueue().Count}"); Reset(); _ = FlushQueue(); }
    private void Reset() { _buffer.Clear(); _times.Clear(); _shiftKey = false; }
    private async Task FlushQueue(bool announce = false)
    {
        if (!_config.IsComplete) return;
        if (!await _sending.WaitAsync(0)) { Interlocked.Exchange(ref _flushRequested, 1); return; }
        try
        {
            while (Storage.PeekQueue() is { } item)
            {
                ScanResponse response; try { response = await _api.SendAsync(_config, item); } catch (HttpRequestException ex) { SetFailure(ex); return; }
                Storage.RemoveFromQueue(item.EventId); _worker?.SetConnection(true); _worker?.SetPending(Storage.LoadQueue().Count); AgentLog.Info($"synced event_id={item.EventId}"); _worker?.SetScan(response);
                if (response.Result == "counted") { _shift.Orders++; _shift.Earnings = response.EarningsToday; }
                Notify(response.Message.Length > 0 ? response.Message : "Скан отклонен", response.Result == "counted" ? ToolTipIcon.Info : ToolTipIcon.Warning);
            }
            if (announce) Notify("Соединение с сервером работает", ToolTipIcon.Info);
        }
        finally { _sending.Release(); if (Interlocked.Exchange(ref _flushRequested, 0) != 0) _ = FlushQueue(); }
    }
    private void Notify(string text, ToolTipIcon icon) { _tray.BalloonTipTitle = "Складской сканер"; _tray.BalloonTipText = text; _tray.BalloonTipIcon = icon; _tray.ShowBalloonTip(3500); }
    private void SetAuthorizationError() { UpdateTooltip("Ошибка авторизации"); _worker?.SetAuthorizationError(); }
    private void SetFailure(HttpRequestException ex) { var state = ex.StatusCode switch { System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden => ConnectionState.AuthorizationError, System.Net.HttpStatusCode.NotFound => ConnectionState.NotFound, { } code when (int)code >= 500 => ConnectionState.ServerError, _ => System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable() ? ConnectionState.ServerUnavailable : ConnectionState.NoInternet }; _worker?.SetServerState(state); _worker?.SetPending(Storage.LoadQueue().Count); AgentLog.Error($"connection state={state}", ex); }
    private void SetOffline() { UpdateTooltip("Нет связи"); _worker?.SetConnection(false); } private void UpdateTooltip(string status) { var t = $"{status} · {_config.EmployeeIdentifier}"; _tray.Text = t[..Math.Min(63, t.Length)]; }
    private void Exit() { _exiting = true; _retry.Stop(); _clock.Stop(); _activationWait.Unregister(null); _activate.Dispose(); _tray.Visible = false; _tray.Dispose(); _raw.Dispose(); _api.Dispose(); _settings?.Dispose(); _worker?.Dispose(); ExitThread(); }
}
