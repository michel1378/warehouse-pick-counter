namespace ScannerAgent;

internal sealed class AgentContext : ApplicationContext
{
    private readonly RawInput _raw = new();
    private readonly ApiClient _api = new();
    private readonly WorkerForm _worker = new();
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    private readonly EventWaitHandle _activate = new(false, EventResetMode.AutoReset, Program.ActivateEventName);
    private readonly RegisteredWaitHandle _activationWait;
    private readonly SemaphoreSlim _sending = new(1, 1);
    private AgentConfig _config = new();
    private EmployeeSession? _employee;
    private ShiftState _shift = new();
    private SettingsForm? _settings;
    private string? _device;
    private bool _detect, _busy, _healthBusy, _restoreBusy, _online, _exiting, _loginOpen;
    private int _ticks, _generation, _scanRevision, _saving;
    private bool _discovering, _initialized, _scannerMeasured;
    private readonly RecoveryPolicy _recovery = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly System.Diagnostics.Stopwatch _startup = System.Diagnostics.Stopwatch.StartNew();
    private DateTimeOffset? _reconnected;
    private readonly Dictionary<Guid,long> _durableTicks = new();
    private int _pendingRefresh;
    private readonly SemaphoreSlim _captureSave = new(1, 1);
    private readonly SemaphoreSlim _sessionSave = new(1, 1);
    private DateTimeOffset _nextHealth = DateTimeOffset.MinValue;

    public AgentContext()
    {
        AgentLog.Info($"startup version={AgentLog.Version}");
        _tray = new NotifyIcon { Icon = SystemIcons.Application, Visible = true, Text = $"ScannerAgent v{AgentLog.Version}" };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Открыть", null, (_, _) => _worker.ShowFront());
        menu.Items.Add("Сменить сотрудника", null, (_, _) => Login());
        menu.Items.Add("Расширенные настройки", null, (_, _) => OpenSettings());
        menu.Items.Add("Выход", null, (_, _) => Exit()); _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => _worker.ShowFront();
        _worker.SettingsRequested += Login;
        _worker.ShiftActionRequested += async action => await ChangeShift(action);
        _worker.ShowFront();
        _activationWait = ThreadPool.RegisterWaitForSingleObject(_activate, (_, _) => {
            if (!_exiting && _worker.IsHandleCreated) _worker.BeginInvoke(() => _worker.ShowFront());
        }, null, Timeout.Infinite, false);
        _raw.ScanReceived += OnRawScan; _raw.DevicesChanged += Discover;
        _timer.Tick += async (_, _) => {
            if (!_initialized) return;
            _raw.ExpireCaptures(Environment.TickCount64);
            if (_employee?.ShiftUncertain != true) _worker.UpdateTimer(_shift);
            if (++_ticks % 3 == 0) Discover();
            if (DateTimeOffset.UtcNow >= _nextHealth) await CheckConnection();
        };
        _timer.Start();
        _worker.BeginInvoke(async () => await Initialize());
    }

    private async Task Initialize()
    {
        try {
            var loaded = await Task.Run(() => (Config: Storage.LoadConfig(), Employee: Storage.LoadEmployee(), Count: Storage.LoadQueue().Count));
            if (_exiting) return;
            _config = loaded.Config ?? new(); _employee = loaded.Employee;
            if (_employee is not null) { _config.EmployeeIdentifier = _employee.Id; _shift = _employee.Shift; _worker.SetShift(_shift); if (_employee.ShiftUncertain) _worker.SetShiftChecking(); }
            _worker.SetPending(loaded.Count);
        } catch (Exception ex) { AgentLog.Error("storage startup", ex); _worker.SetQueueError(); _worker.SetNotice("Не удалось прочитать настройки/очередь", true); }
        _initialized = true; Discover();
        _ = CheckConnection();
        if (!_config.IsComplete) _worker.SetNotice("Ноутбук ещё не настроен", true);
        else if (_employee is null) Login();
    }

    private async void Discover()
    {
        if (_exiting || _discovering) return;
        _discovering = true; var generation = _generation;
        try
        {
            var devices = await Task.Run(() => RawInput.Devices().Select(path => (Path: path, Fingerprint: ScannerFingerprint.Read(path)))
                .Where(d => d.Fingerprint is not null).Select(d => (d.Path, Fingerprint: d.Fingerprint!)).ToArray());
            if (_exiting || generation != _generation) return;
            if (_config.Fingerprint is null)
            {
                _detect = true; _worker.SetScanner("Отключён");
                if (!_loginOpen) _worker.SetNotice("Первичная настройка сканера. Пикните любой штрихкод.");
                return;
            }
            var resolved = ScannerFingerprint.Resolve(_config.Fingerprint, devices);
            if (!string.Equals(resolved, _device, StringComparison.OrdinalIgnoreCase))
            {
                AgentLog.Info($"HID {(resolved is null ? "disconnect" : "reconnect")} fingerprint={System.Text.Json.JsonSerializer.Serialize(_config.Fingerprint)} current_path={resolved}");
                _device = resolved;
                if (resolved is not null && !_scannerMeasured) { _scannerMeasured = true; AgentLog.Info($"metric=startup_scanner_ready latency_ms={_startup.ElapsedMilliseconds}"); }
            }
            _worker.SetScanner(_device is null ? "Отключён" : "Готов");
        }
        catch (Exception ex) { AgentLog.Error("HID discovery failed", ex); _device = null; if (!_exiting) _worker.SetScanner("Отключён"); }
        finally { _discovering = false; }
    }

    private async void Login()
    {
        if (_busy || _saving > 0 || _loginOpen || _settings is not null) return;
        _loginOpen = true;
        try {
            if (!_config.IsComplete) { _worker.SetNotice("Требуется первичная настройка ноутбука", true); return; }
            var pending = (await Task.Run(Storage.LoadQueue)).Count;
            if (_exiting) return;
            if (pending > 0) { _worker.SetNotice("Сначала синхронизируйте очередь", true); return; }
            if (_shift.Status is "active" or "paused" && MessageBox.Show("Текущая смена останется открытой. Сменить сотрудника?", "Сменить сотрудника", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
            using var form = new EmployeeLoginForm(_api, Snapshot());
            if (form.ShowDialog(_worker) != DialogResult.OK || form.Employee is null) return;
            _generation++; _employee = form.Employee;
            _shift = EmployeeSwitch.Apply(_config, _employee, pending);
            await PersistEmployee(); _worker.SetShift(_shift); _ = RestoreShift();
        } catch (Exception ex) { AgentLog.Error("employee login failed", ex); if (!_exiting) _worker.SetNotice("Не удалось сменить сотрудника: проверьте очередь и связь", true); }
        finally { _loginOpen = false; }
    }

    private void OpenSettings()
    {
        if (_busy || _saving > 0 || _loginOpen || _settings is not null) return;
        if (MessageBox.Show("Это настройки ноутбука для ответственного за установку. Продолжить?", "Расширенные настройки", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
        _settings = new SettingsForm(_config);
        _settings.DetectionRequested += () => _detect = true;
        _settings.FormClosed += (_, _) => {
            try
            {
                if (_settings?.DialogResult == DialogResult.OK && _settings.Result is { } result)
                {
                    if (Storage.LoadQueue().Count > 0 && !string.Equals(result.BackendUrl, _config.BackendUrl, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Сначала синхронизируйте очередь перед сменой сервера.");
                    result.EmployeeIdentifier = _config.EmployeeIdentifier;
                    Storage.SaveConfig(result, _settings.Token); _config = result; _generation++;
                    _device = null; _online = false; _worker.SetServerState(ConnectionState.Waiting); _nextHealth = DateTimeOffset.MinValue;
                }
            }
            catch (Exception ex) { AgentLog.Error("machine configuration save failed", ex); _worker.SetNotice("Настройки не сохранены. Проверьте права установки и очередь.", true); }
            finally { _settings = null; _detect = _config.Fingerprint is null; Discover(); }
        };
        _settings.Show(_worker);
    }

    private async Task RefreshPending() {
        var revision = ++_pendingRefresh;
        try { var count = (await Task.Run(Storage.LoadQueue)).Count; if (!_exiting && revision == _pendingRefresh) _worker.SetPending(count); }
        catch { if (!_exiting) _worker.SetQueueError(); }
    }
    private AgentConfig Snapshot() => new() { BackendUrl = _config.BackendUrl, EmployeeIdentifier = _config.EmployeeIdentifier, ScannerDevice = _device ?? "", Fingerprint = _config.Fingerprint };
    private async Task PersistEmployee() { if (_employee is null) return; _employee.Shift = _shift; var snapshot = System.Text.Json.JsonSerializer.Deserialize<EmployeeSession>(System.Text.Json.JsonSerializer.Serialize(_employee))!; await _sessionSave.WaitAsync(); try { await Task.Run(() => Storage.SaveEmployee(snapshot)); } finally { _sessionSave.Release(); } }
    private async Task RestoreShift()
    {
        if (_restoreBusy || _busy || _employee is null || _exiting) return;
        _restoreBusy = true; var generation = _generation; var revision = _scanRevision;
        if (_employee.ShiftUncertain) _worker.SetShiftChecking();
        try
        {
            var config = Snapshot();
            var state = await ShiftRecovery.Fetch(() => _api.GetShiftAsync(config, _lifetime.Token));
            if (_exiting || generation != _generation || _busy || revision != _scanRevision) return;
            _shift = state; if (_employee is not null) _employee.ShiftUncertain = false; await PersistEmployee(); _worker.SetShift(_shift);
        }
        catch (HttpRequestException ex)
        {
            if (generation == _generation && !_exiting)
            {
                if (ex.StatusCode == System.Net.HttpStatusCode.Forbidden) { _employee = null; _config.EmployeeIdentifier = ""; _shift = new(); Storage.ClearEmployee(); _worker.SetShift(_shift); }
                Failure(ex);
            }
        }
        catch (Exception ex) { AgentLog.Error("restore shift/cache failed", ex); }
        finally { _restoreBusy = false; }
    }

    private async Task CheckConnection()
    {
        if (_healthBusy || _exiting) return;
        if (!_config.IsComplete) { _online = false; _worker.SetServerState(ConnectionState.AuthorizationError); return; }
        _healthBusy = true; var generation = _generation; var revision = _scanRevision;
        try
        {
            await _api.PingAsync(Snapshot(), _lifetime.Token);
            if (_exiting || generation != _generation || revision != _scanRevision) return;
            if (!_online) _reconnected = DateTimeOffset.UtcNow;
            _online = true;
            if (!_recovery.EverReady) AgentLog.Info($"metric=startup_backend_ready latency_ms={_startup.ElapsedMilliseconds}");
            _worker.SetServerState(ConnectionState.Connected);
            _nextHealth = DateTimeOffset.UtcNow.AddSeconds(15);
            await FlushQueue();
            if (_online) { await RestoreShift(); if (_online) _recovery.Ready(); }
        }
        catch (HttpRequestException ex) { Failure(ex); }
        catch (Exception ex) { AgentLog.Error("connection check failed", ex); _online = false; _worker.SetServerState(ConnectionState.AuthorizationError); _nextHealth = DateTimeOffset.UtcNow.AddSeconds(60); }
        finally { _healthBusy = false; }
    }

    private void Failure(HttpRequestException ex)
    {
        if (_exiting) return;
        _online = false;
        _scanRevision++;
        var delay = _recovery.Fail(ex);
        _nextHealth = DateTimeOffset.UtcNow.AddSeconds(delay);
        var state = RecoveryPolicy.Configuration(ex) ? ConnectionState.AuthorizationError
            : ConnectionState.ServerUnavailable;
        _worker.SetServerState(state); AgentLog.Info($"connection state={state} retry_seconds={delay} attempt={_recovery.Attempt} http_status={ex.StatusCode}");
    }

    private async Task ChangeShift(string action)
    {
        if (_busy || _saving > 0 || _loginOpen || _employee is null || _settings is not null) return;
        if (_restoreBusy) { _worker.SetNotice("Проверяем состояние смены. Повторите действие после проверки."); return; }
        if (_employee.ShiftUncertain) { _worker.SetNotice("Подтверждаем состояние смены на сервере.", true); await RestoreShift(); return; }
        _busy = true; _worker.SetBusy(true);
        try
        {
            await FlushQueue();
            if ((await Task.Run(Storage.LoadQueue)).Any(e => e.ShiftId == _shift.Id)) { _worker.SetNotice("Дождитесь синхронизации заказов перед изменением смены.", true); return; }
            _employee.ShiftUncertain = true; await PersistEmployee(); _worker.SetShiftChecking();
            _shift = await _api.ShiftActionAsync(Snapshot(), action, _shift.Id, _lifetime.Token);
            _employee.ShiftUncertain = false;
            await PersistEmployee(); _worker.SetShift(_shift);
            if (action == "finish") MessageBox.Show($"Заказов: {_shift.Orders}\nЗаработано: {_shift.Earnings:N2} ₽\nАктивное время: {TimeSpan.FromSeconds(_shift.ActiveSeconds)}", "Итоги смены");
        }
        catch (HttpRequestException ex) { Failure(ex); _worker.SetNotice("Не удалось подтвердить изменение смены. Проверяем состояние сервера.", true); }
        catch (Exception ex) { AgentLog.Error("shift action failed", ex); _worker.SetNotice("Не удалось сохранить состояние смены.", true); }
        finally { _busy = false; if (!_exiting) { _worker.SetBusy(false); if (_employee?.ShiftUncertain == true) _worker.SetShiftChecking(); else _worker.SetShift(_shift); await RestoreShift(); } }
    }

    private async void OnRawScan(RawScan raw)
    {
        if (_exiting) return;
        var physicalAt = DateTimeOffset.UtcNow; var localTimer = System.Diagnostics.Stopwatch.StartNew();
        var scan = raw with { Barcode = BarcodePolicy.Normalize(raw.Barcode) };
        // Detection never creates an order and never accepts a slowly typed PIN.
        if (_detect)
        {
            if (_loginOpen) { _worker.SetNotice("Настройка сканера: завершите вход и повторите скан"); return; }
            if (BarcodePolicy.Type(scan.Barcode) == "invalid" || scan.ElapsedMs > 1500 || scan.AverageIntervalMs > 50 || scan.Error is not null) { _worker.SetNotice("Ошибка настройки: повторите скан", true); return; }
            var fingerprint = ScannerFingerprint.Read(scan.DevicePath);
            if (fingerprint is null) { _worker.SetNotice("Ошибка сканера: fingerprint недоступен", true); return; }
            try
            {
                if (_settings is not null) _settings.CompleteDetection(scan.DevicePath);
                else { _config.Fingerprint = fingerprint; _config.ScannerDevice = scan.DevicePath; Storage.SaveMachine(_config); }
                _detect = false; Discover(); _worker.SetNotice("Сканер настроен");
            }
            catch (Exception ex) { AgentLog.Error("scanner detection save failed", ex); _worker.SetNotice("Не удалось сохранить сканер. Проверьте установку ноутбука.", true); }
            return;
        }
        if (!string.Equals(scan.DevicePath, _device, StringComparison.OrdinalIgnoreCase)) { if (ScannerFingerprint.Read(scan.DevicePath) is { } fp && _config.Fingerprint?.Matches(fp) == true) _worker.SetNotice("Ошибка сканера: устройство переподключается", true); return; }
        var rejection = ScanFeedback.Rejection(scan, _loginOpen || _settings is not null,
            _employee?.ShiftUncertain == true, _busy, _employee is not null && _shift.Status == "active" && _shift.Id is not null);
        if (rejection is not null) { _worker.SetNotice(rejection, true); return; }
        var item = new ScanEvent(Guid.NewGuid(), scan.Barcode, _employee!.Id, scan.ElapsedMs, scan.DevicePath,
            physicalAt, new ScanInputMetadata(scan.AverageIntervalMs, "windows-agent"), _shift.Id, DurableAt: DateTimeOffset.UtcNow);
        _saving++;
        await _captureSave.WaitAsync();
        try
        {
            var size = await Task.Run(() => { Storage.Enqueue(item); return Storage.LoadQueue().Count; });
            if (_exiting) return;
            AgentLog.Info($"metric=physical_to_durable event_id={item.EventId} latency_ms={localTimer.ElapsedMilliseconds} queue_length={size}");
            _durableTicks[item.EventId] = System.Diagnostics.Stopwatch.GetTimestamp();
            await RefreshPending(); _worker.SetNotice("Сохранён локально — ожидает синхронизации");
            AgentLog.Info($"queued event_id={item.EventId} queue_size={size}");
            if (_online) _ = FlushQueue();
        }
        catch (Exception ex) { AgentLog.Error("queue write failed", ex); if (!_exiting) _worker.SetNotice("Ошибка сканера: заказ НЕ сохранён. Освободите диск и повторите скан.", true); }
        finally { _saving--; _captureSave.Release(); }
    }

    private async Task FlushQueue()
    {
        if (_exiting || !_online || !_config.IsComplete || !await _sending.WaitAsync(0)) return;
        try
        {
            while (!_exiting && await Task.Run(Storage.PeekQueue) is { } item)
            {
                AgentLog.Info($"endpoint=scan event_id={item.EventId} attempt={_recovery.Attempt + 1}");
                ScanResponse? response = null;
                await QueueDelivery.Deliver(item, e => _api.SendAsync(Snapshot(), e, _lifetime.Token), async (e, r) => { await Task.Run(() => Storage.Acknowledge(e, r)); response = r; });
                if (response is null) throw new HttpRequestException("Нет подтверждения");
                if (_durableTicks.Remove(item.EventId, out var savedTicks)) AgentLog.Info($"metric=durable_to_ack event_id={item.EventId} latency_ms={System.Diagnostics.Stopwatch.GetElapsedTime(savedTicks).TotalMilliseconds:F0}");
                else AgentLog.Info($"metric=replayed_ack event_id={item.EventId} queue_age_ms={(DateTimeOffset.UtcNow - (item.DurableAt ?? item.ScannedAt ?? DateTimeOffset.UtcNow)).TotalMilliseconds:F0}");
                _scanRevision++;
                if (_exiting) return;
                var count = (await Task.Run(Storage.LoadQueue)).Count; await RefreshPending();
                AgentLog.Info($"synced event_id={item.EventId} result={response.Result} reason={response.Reason} queue_length={count}");
                if (item.EmployeeIdentifier == _employee?.Id && item.ShiftId == _shift.Id) _worker.SetScan(response);
                else _worker.SetNotice(response.Message, response.Result != "counted");
                if (count == 0 && _reconnected is { } since) { AgentLog.Info($"metric=reconnect_queue_drained latency_ms={(DateTimeOffset.UtcNow - since).TotalMilliseconds:F0}"); _reconnected = null; }
            }
        }
        catch (HttpRequestException ex) { Failure(ex); }
        catch (Exception ex) { AgentLog.Error("queue sync failed", ex); if (!_exiting) _worker.SetNotice("Очередь сохранена, синхронизация будет повторена.", true); }
        finally { _sending.Release(); }
    }

    private async void Exit()
    {
        if (_saving > 0) { _worker.SetNotice("Сохраняем скан. Повторите выход после сохранения."); return; }
        _exiting = true; _lifetime.Cancel(); _timer.Stop(); _timer.Dispose(); _activationWait.Unregister(null); _activate.Dispose();
        _tray.Visible = false; _tray.Dispose(); _raw.Dispose(); _api.Dispose(); _settings?.Dispose(); _worker.Dispose(); await AgentLog.Complete(); ExitThread();
    }
}
