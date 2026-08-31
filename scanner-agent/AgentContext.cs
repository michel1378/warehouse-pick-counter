namespace ScannerAgent;
internal sealed class AgentContext : ApplicationContext
{
    private readonly RawInput _raw = new(); private readonly ApiClient _api = new(); private readonly NotifyIcon _tray; private readonly SemaphoreSlim _sending = new(1, 1);
    private readonly System.Windows.Forms.Timer _retry = new() { Interval = 15_000 }, _clock = new() { Interval = 1000 }; private readonly EventWaitHandle _activate = new(false, EventResetMode.AutoReset, Program.ActivateEventName); private readonly RegisteredWaitHandle _activationWait;
    private AgentConfig _config = new(); private WorkerForm? _worker; private SettingsForm? _settings; private ShiftState _shift = new(); private bool _detectionMode; private string? _detectionDevice; private bool _exiting; private int _flushRequested;
    public AgentContext()
    {
        AgentLog.Info($"startup version={AgentLog.Version}");
        _tray = new NotifyIcon { Icon = SystemIcons.Application, Visible = true, Text = "Складской scanner-agent" }; _tray.ContextMenuStrip = BuildMenu(); _tray.DoubleClick += (_, _) => ShowMainWindow();
        _activationWait = ThreadPool.RegisterWaitForSingleObject(_activate, (_, _) => { var form = _settings as Form ?? _worker; if (form is { IsHandleCreated: true }) form.BeginInvoke(ShowMainWindow); }, null, Timeout.Infinite, false);
        _raw.ScanReceived += OnRawScan; _raw.RawKeyReceived += OnRawKey; _retry.Tick += async (_, _) => await FlushQueue(); _retry.Start(); _clock.Tick += (_, _) => _worker?.UpdateTimer(_shift); _clock.Start();
        var existing = Storage.LoadConfig(); if (existing is null || !existing.IsComplete || string.IsNullOrWhiteSpace(Storage.LoadToken())) OpenSettings(existing, true); else { _config = existing; ShowWorker(); _ = RestoreShift(); }
    }
    private ContextMenuStrip BuildMenu() { var m = new ContextMenuStrip(); m.Items.Add("Открыть настройки", null, (_, _) => OpenSettings(_config)); m.Items.Add("Статус", null, (_, _) => ShowMainWindow()); m.Items.Add("Сменить сотрудника", null, (_, _) => OpenSettings(_config)); m.Items.Add(new ToolStripSeparator()); m.Items.Add("Выход", null, (_, _) => Exit()); return m; }
    private void OpenSettings(AgentConfig? config = null, bool required = false)
    {
        if (_settings is { IsDisposed: false }) { ShowFront(_settings); return; }
        _settings = new SettingsForm(config); _settings.DetectionRequested += () => { _detectionDevice = null; _detectionMode = true; }; _settings.FormClosing += (_, e) => { if (required && _settings.DialogResult != DialogResult.OK && !_exiting) { e.Cancel = true; ShowFront(_settings); } }; _settings.FormClosed += async (_, _) => { _detectionMode = false; _detectionDevice = null; var form = _settings; if (form?.DialogResult == DialogResult.OK && form.Result is { } result) { _config = result; Storage.SaveConfig(_config, form.Token); ShowWorker(); await RestoreShift(); } _settings = null; }; _settings.Show(); ShowFront(_settings);
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
    private void OnRawScan(RawScan scan)
    {
        if (_detectionMode)
        {
            _detectionMode = false; _detectionDevice = null; AgentLog.Scan(scan, "scanner detected"); _settings?.CompleteDetection(scan.DevicePath);
            return;
        }
        var reason = Validate(scan);
        AgentLog.Scan(scan, reason ?? "accepted");
        if (reason is not null) { ShowRejection(reason); return; }
        var item = new ScanEvent(Guid.NewGuid(), scan.Barcode, _config.EmployeeIdentifier, scan.ElapsedMs, scan.DevicePath, DateTimeOffset.Now, new ScanInputMetadata(scan.AverageIntervalMs, "windows-agent"), _shift.Id);
        Storage.Enqueue(item); _worker?.SetPending(Storage.LoadQueue().Count); AgentLog.Info($"queued event_id={item.EventId} queue={Storage.LoadQueue().Count}"); _ = FlushQueue();
    }
    private void OnRawKey(string device, Keys key, bool keyDown)
    {
        if (!_detectionMode || !keyDown || string.IsNullOrWhiteSpace(device)) return;
        _detectionDevice ??= device;
        if (key is not (Keys.Enter or Keys.Return or Keys.Tab) || !string.Equals(device, _detectionDevice, StringComparison.OrdinalIgnoreCase)) return;
        _detectionMode = false; var detected = _detectionDevice; _detectionDevice = null;
        AgentLog.Info($"scanner_detected_from_raw_terminator device_path={detected}"); _settings?.CompleteDetection(detected);
    }
    private string? Validate(RawScan scan)
    {
        if (!string.Equals(scan.DevicePath, _config.ScannerDevice, StringComparison.OrdinalIgnoreCase)) return "unknown device";
        if (scan.Barcode.Length < 8) return "too short";
        if (scan.Barcode.Length > 20) return "too long";
        if (!scan.Barcode.All(char.IsDigit)) return "non-digit";
        if (scan.RawCharCount < 2 || scan.ElapsedMs > 2_500 || scan.AverageIntervalMs > 100) return "manual input";
        if (_shift.Status != "active" || !_shift.Id.HasValue) return "no active shift";
        return null;
    }
    private void ShowRejection(string reason)
    {
        var text = reason switch { "too short" => "Штрихкод слишком короткий", "too long" => "Штрихкод слишком длинный", "non-digit" => "Штрихкод должен содержать только цифры", "manual input" => "Ручной ввод не засчитан", "unknown device" => "Неизвестное устройство", "no active shift" when _shift.Status == "paused" => "Смена на паузе", "no active shift" => "Сначала начните смену", _ => "Скан отклонён" };
        _worker?.SetNotice(text, true);
    }
    private async Task FlushQueue(bool announce = false)
    {
        if (!_config.IsComplete) return;
        if (!await _sending.WaitAsync(0)) { Interlocked.Exchange(ref _flushRequested, 1); return; }
        try
        {
            while (Storage.PeekQueue() is { } item)
            {
                ScanResponse response; try { response = await _api.SendAsync(_config, item); } catch (HttpRequestException ex) { SetFailure(ex); return; }
                Storage.RemoveFromQueue(item.EventId); _worker?.SetConnection(true); _worker?.SetPending(Storage.LoadQueue().Count); AgentLog.Info($"synced event_id={item.EventId} device_path={item.ScannerDevice} normalized_barcode={item.Barcode} barcode_length={item.Barcode.Length} validation_result={response.Result}"); _worker?.SetScan(response);
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
