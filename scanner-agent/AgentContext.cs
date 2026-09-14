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
    private int _attempt, _ticks, _generation;
    private DateTimeOffset _nextHealth = DateTimeOffset.MinValue;

    public AgentContext()
    {
        AgentLog.Info($"startup version={AgentLog.Version}");
        _tray = new NotifyIcon { Icon = SystemIcons.Application, Visible = true, Text = "ScannerAgent v1.2.0" };
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
        try
        {
            _config = Storage.LoadConfig() ?? new();
            _employee = Storage.LoadEmployee();
            if (_employee is not null && Guid.TryParse(_employee.Id, out _))
            {
                _config.EmployeeIdentifier = _employee.Id; _shift = _employee.Shift;
                _worker.SetShift(_shift);
            }
            _worker.SetPending(Storage.LoadQueue().Count);
        }
        catch (Exception ex) { AgentLog.Error("storage startup", ex); _worker.SetNotice("Не удалось прочитать настройки/очередь. Обратитесь к настройщику.", true); }
        Discover();
        _timer.Tick += async (_, _) => {
            _worker.UpdateTimer(_shift);
            if (++_ticks % 3 == 0) Discover();
            if (DateTimeOffset.UtcNow >= _nextHealth) await CheckConnection();
        };
        _timer.Start();
        _worker.BeginInvoke(() => {
            if (!_config.IsComplete) _worker.SetNotice("Ноутбук ещё не настроен. Обратитесь к настройщику.", true);
            else if (_employee is null) Login();
        });
    }

    private void Discover()
    {
        if (_exiting) return;
        try
        {
            var devices = RawInput.Devices().Select(path => (Path: path, Fingerprint: ScannerFingerprint.Read(path)))
                .Where(d => d.Fingerprint is not null).Select(d => (d.Path, Fingerprint: d.Fingerprint!)).ToArray();
            if (_config.Fingerprint is null)
            {
                _detect = true; _worker.SetScanner("Первичная настройка");
                if (!_loginOpen) _worker.SetNotice("Первичная настройка сканера. Пикните любой штрихкод.");
                return;
            }
            var resolved = ScannerFingerprint.Resolve(_config.Fingerprint, devices);
            if (!string.Equals(resolved, _device, StringComparison.OrdinalIgnoreCase))
            {
                AgentLog.Info($"HID {(resolved is null ? "disconnect" : "reconnect")} fingerprint={System.Text.Json.JsonSerializer.Serialize(_config.Fingerprint)} current_path={resolved}");
                _device = resolved;
            }
            _worker.SetScanner(_device is null ? "Отключён / устройство не определено" : "Готов");
        }
        catch (Exception ex) { AgentLog.Error("HID discovery failed", ex); _device = null; _worker.SetScanner("Отключён"); }
    }

    private void Login()
    {
        if (_busy || _loginOpen || _settings is not null) return;
        if (!_config.IsComplete) { _worker.SetNotice("Требуется первичная настройка ноутбука.", true); return; }
        if (_shift.Status is "active" or "paused" && MessageBox.Show("Текущая смена останется открытой. Сменить сотрудника?", "Сменить сотрудника", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
        _loginOpen = true;
        try
        {
            using var form = new EmployeeLoginForm(_api, Snapshot());
            if (form.ShowDialog(_worker) != DialogResult.OK || form.Employee is null) return;
            _generation++; _employee = form.Employee; _config.EmployeeIdentifier = _employee.Id;
            _shift = new ShiftState { EmployeeName = _employee.Name };
            PersistEmployee(); _worker.SetShift(_shift); _ = RestoreShift();
        }
        catch (Exception ex) { AgentLog.Error("employee login storage failed", ex); _worker.SetNotice("Не удалось сохранить вход.", true); }
        finally { _loginOpen = false; }
    }

    private void OpenSettings()
    {
        if (_busy || _loginOpen || _settings is not null) return;
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
                    _device = null; _nextHealth = DateTimeOffset.MinValue;
                }
            }
            catch (Exception ex) { AgentLog.Error("machine configuration save failed", ex); _worker.SetNotice("Настройки не сохранены. Проверьте права установки и очередь.", true); }
            finally { _settings = null; _detect = _config.Fingerprint is null; Discover(); }
        };
        _settings.Show(_worker);
    }

    private AgentConfig Snapshot() => new() { BackendUrl = _config.BackendUrl, EmployeeIdentifier = _config.EmployeeIdentifier, ScannerDevice = _device ?? "", Fingerprint = _config.Fingerprint };
    private void PersistEmployee() { if (_employee is null) return; _employee.Shift = _shift; Storage.SaveEmployee(_employee); }
    private async Task RestoreShift()
    {
        if (_restoreBusy || _busy || _employee is null || _exiting) return;
        _restoreBusy = true; var generation = _generation;
        try
        {
            var state = await _api.GetShiftAsync(Snapshot());
            if (_exiting || generation != _generation || _busy) return;
            _shift = state; if (_employee is not null) _employee.ShiftUncertain = false; PersistEmployee(); _worker.SetShift(_shift);
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
        if (_healthBusy || !_config.IsComplete || _exiting) return;
        _healthBusy = true;
        try
        {
            await _api.PingAsync(Snapshot());
            if (_exiting) return;
            _online = true; _attempt = 0;
            _worker.SetServerState(ConnectionState.Connected);
            _nextHealth = DateTimeOffset.UtcNow.AddSeconds(15);
            _ = FlushQueue();
            _ = RestoreShift();
        }
        catch (HttpRequestException ex) { Failure(ex); }
        catch (Exception ex) { AgentLog.Error("connection check failed", ex); _nextHealth = DateTimeOffset.UtcNow.AddSeconds(15); }
        finally { _healthBusy = false; }
    }

    private void Failure(HttpRequestException ex)
    {
        if (_exiting) return;
        _online = false;
        var delay = new[] { 2, 5, 10, 15 }[Math.Min(_attempt++, 3)];
        _nextHealth = DateTimeOffset.UtcNow.AddSeconds(delay);
        var state = ex.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden ? ConnectionState.AuthorizationError
            : System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable() ? ConnectionState.ServerUnavailable : ConnectionState.NoInternet;
        _worker.SetServerState(state); AgentLog.Info($"connection state={state} retry_seconds={delay} http_status={ex.StatusCode}");
    }

    private async Task ChangeShift(string action)
    {
        if (_busy || _loginOpen || _employee is null || _restoreBusy || _settings is not null) return;
        if (_employee.ShiftUncertain) { _worker.SetNotice("Подтверждаем состояние смены на сервере.", true); await RestoreShift(); return; }
        _busy = true; _worker.SetBusy(true);
        try
        {
            await FlushQueue();
            if (Storage.LoadQueue().Any(e => e.ShiftId == _shift.Id)) { _worker.SetNotice("Дождитесь синхронизации заказов перед изменением смены.", true); return; }
            _employee.ShiftUncertain = true; PersistEmployee();
            _shift = await _api.ShiftActionAsync(Snapshot(), action);
            _employee.ShiftUncertain = false;
            PersistEmployee(); _worker.SetShift(_shift);
            if (action == "finish") MessageBox.Show($"Заказов: {_shift.Orders}\nЗаработано: {_shift.Earnings:N2} ₽\nАктивное время: {TimeSpan.FromSeconds(_shift.ActiveSeconds)}", "Итоги смены");
        }
        catch (HttpRequestException ex) { Failure(ex); _worker.SetNotice("Не удалось подтвердить изменение смены. Проверяем состояние сервера.", true); }
        catch (Exception ex) { AgentLog.Error("shift action failed", ex); _worker.SetNotice("Не удалось сохранить состояние смены.", true); }
        finally { _busy = false; if (!_exiting) { _worker.SetBusy(false); _worker.SetShift(_shift); await RestoreShift(); } }
    }

    private void OnRawScan(RawScan raw)
    {
        if (_exiting || _loginOpen || (_settings is not null && !_detect)) return;
        var scan = raw with { Barcode = BarcodePolicy.Normalize(raw.Barcode) };
        // Detection never creates an order and never accepts a slowly typed PIN.
        if (_detect)
        {
            if (scan.RawCharCount < 2 || scan.ElapsedMs > 1500 || scan.AverageIntervalMs > 50) return;
            var fingerprint = ScannerFingerprint.Read(scan.DevicePath);
            if (fingerprint is null) return;
            try
            {
                if (_settings is not null) _settings.CompleteDetection(scan.DevicePath);
                else { _config.Fingerprint = fingerprint; _config.ScannerDevice = scan.DevicePath; Storage.SaveMachine(_config); }
                _detect = false; Discover(); _worker.SetNotice("Сканер настроен");
            }
            catch (Exception ex) { AgentLog.Error("scanner detection save failed", ex); _worker.SetNotice("Не удалось сохранить сканер. Проверьте установку ноутбука.", true); }
            return;
        }
        if (!string.Equals(scan.DevicePath, _device, StringComparison.OrdinalIgnoreCase)) return;
        var type = BarcodePolicy.Type(scan.Barcode);
        AgentLog.Info($"barcode_validation_type={type} length={scan.Barcode.Length}");
        if (type == "invalid") { _worker.SetNotice("Недопустимый формат штрихкода", true); return; }
        if (_employee?.ShiftUncertain == true) { _worker.SetNotice("Подтверждаем состояние смены. Повторите скан после восстановления связи.", true); return; }
        if (scan.RawCharCount < 2 || scan.ElapsedMs > 2500 || scan.AverageIntervalMs > 100) { _worker.SetNotice("Ручной ввод не засчитан", true); return; }
        if (_busy || _employee is null || _shift.Status != "active" || _shift.Id is null) { _worker.SetNotice("Сначала начните или продолжите смену", true); return; }
        try
        {
            var item = new ScanEvent(Guid.NewGuid(), scan.Barcode, _employee.Id, scan.ElapsedMs, scan.DevicePath,
                DateTimeOffset.UtcNow, new ScanInputMetadata(scan.AverageIntervalMs, "windows-agent"), _shift.Id);
            Storage.Enqueue(item); var size = Storage.LoadQueue().Count;
            _worker.SetPending(size); _worker.SetNotice($"Принят: {scan.Barcode} · ожидает синхронизации");
            AgentLog.Info($"queued event_id={item.EventId} queue_size={size}");
            if (_online) _ = FlushQueue();
        }
        catch (Exception ex) { AgentLog.Error("queue write failed", ex); _worker.SetNotice("Заказ НЕ сохранён. Освободите диск и повторите скан.", true); }
    }

    private async Task FlushQueue()
    {
        if (_exiting || !_config.IsComplete || !await _sending.WaitAsync(0)) return;
        try
        {
            while (!_exiting && Storage.PeekQueue() is { } item)
            {
                var response = await _api.SendAsync(Snapshot(), item);
                if (response.Result is not ("counted" or "duplicate" or "rejected")) throw new HttpRequestException("Некорректное подтверждение скана");
                Storage.RemoveFromQueue(item.EventId);
                if (_exiting) return;
                var count = Storage.LoadQueue().Count; _worker.SetPending(count);
                AgentLog.Info($"synced event_id={item.EventId} result={response.Result} queue_size={count}");
                if (item.EmployeeIdentifier == _employee?.Id && item.ShiftId == _shift.Id) _worker.SetScan(response);
            }
        }
        catch (HttpRequestException ex) { Failure(ex); }
        catch (Exception ex) { AgentLog.Error("queue sync failed", ex); if (!_exiting) _worker.SetNotice("Очередь сохранена, синхронизация будет повторена.", true); }
        finally { _sending.Release(); }
    }

    private void Exit()
    {
        _exiting = true; _timer.Stop(); _timer.Dispose(); _activationWait.Unregister(null); _activate.Dispose();
        _tray.Visible = false; _tray.Dispose(); _raw.Dispose(); _api.Dispose(); _settings?.Dispose(); _worker.Dispose(); ExitThread();
    }
}
