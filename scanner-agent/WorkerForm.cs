namespace ScannerAgent;

internal sealed class WorkerForm : Form
{
    private readonly Label _employee = V("—"), _orders = V("0"), _earnings = V("0 ₽"), _scanner = V("Отключён"), _server = V("Подключаемся…"), _timer = V("Смена не начата"), _median = V("—"), _pending = V("Очередь: проверяем…"), _notice = V(""), _last = V("—");
    private readonly Button _start = new() { Text = "Начать смену", AutoSize = true }, _pause = new() { Text = "Пауза", AutoSize = true }, _resume = new() { Text = "Продолжить", AutoSize = true }, _finish = new() { Text = "Завершить смену", AutoSize = true }, _settings = new() { Text = "Настройки", AutoSize = true };
    private readonly ListBox _history = new() { Dock = DockStyle.Bottom, Height = 100 };
    public string NoticeText => _notice.Text;
    public string PendingText => _pending.Text;
    public event Action<string>? ShiftActionRequested;
    public event Action? SettingsRequested;
    public void SetScanner(string state) { _scanner.Text = state; _scanner.ForeColor = state == "Готов" ? Color.Green : Color.DarkOrange; }
    private bool _busy, _checking;
    private ShiftState _state = new();
    public string ServerText => _server.Text;
    public string ShiftText => _timer.Text;
    public bool PauseEnabled => _pause.Enabled;
    public void SetBusy(bool busy) { _busy = busy; UpdateButtons(); }
    private void UpdateButtons() {
        var enabled = !_busy && !_checking;
        _start.Enabled = enabled && (_state.Status is "none" or "finished");
        _pause.Enabled = enabled && _state.Status == "active";
        _resume.Enabled = enabled && _state.Status == "paused";
        _finish.Enabled = enabled && (_state.Status is "active" or "paused");
        _settings.Enabled = !_busy && !_checking;
    }
    public WorkerForm()
    {
        _settings.Text = "Сменить сотрудника";
        Text = $"Складской scanner-agent v{AgentLog.Version}"; Width = 410; Height = 640; MinimumSize = new Size(380, 430); StartPosition = FormStartPosition.Manual;
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1200, 800); Location = new Point(area.Right - Width - 16, area.Top + 16);
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 2, RowCount = 12 };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 52));
        Add(grid, 0, "Сотрудник", _employee); Add(grid, 1, "Заказов сегодня", _orders); Add(grid, 2, "Заработано сегодня", _earnings); Add(grid, 3, "Сканер", _scanner); Add(grid, 4, "Сервер", _server); Add(grid, 5, "Текущая смена", _timer); Add(grid, 6, "Медианное время сборки сегодня", _median);
        Add(grid, 7, "Последний заказ", _last); grid.Controls.Add(_pending, 0, 8); grid.SetColumnSpan(_pending, 2); _notice.Font = new Font(Font, FontStyle.Bold); grid.Controls.Add(_notice, 0, 9); grid.SetColumnSpan(_notice, 2);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true }; buttons.Controls.AddRange([_start, _pause, _resume, _finish, _settings]); grid.Controls.Add(buttons, 0, 10); grid.SetColumnSpan(buttons, 2);
        var top = new CheckBox { Text = "Поверх остальных окон", AutoSize = true }; top.CheckedChanged += (_, _) => TopMost = top.Checked; grid.Controls.Add(top, 0, 11); grid.SetColumnSpan(top, 2); Controls.Add(grid); Controls.Add(_history);
        _start.Click += (_, _) => ShiftActionRequested?.Invoke("start"); _pause.Click += (_, _) => ShiftActionRequested?.Invoke("pause"); _resume.Click += (_, _) => ShiftActionRequested?.Invoke("resume"); _finish.Click += (_, _) => ShiftActionRequested?.Invoke("finish"); _settings.Click += (_, _) => SettingsRequested?.Invoke();
        FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        SetShift(new ShiftState());
    }
    private static Label V(string text) => new() { Text = text, AutoSize = true, Anchor = AnchorStyles.Left };
    private static void Add(TableLayoutPanel g, int row, string title, Control value) { g.Controls.Add(new Label { Text = title, AutoSize = true, ForeColor = Color.DimGray, Anchor = AnchorStyles.Left }, 0, row); g.Controls.Add(value, 1, row); }
    public void SetConnection(bool online) { _server.Text = online ? "Подключён" : "Нет связи"; _server.ForeColor = online ? Color.Green : Color.Firebrick; }
    public void SetAuthorizationError() { _server.Text = "Ошибка авторизации"; _server.ForeColor = Color.Firebrick; }
    public void SetQueueError() { _pending.Text = "Очередь: ошибка чтения"; _pending.ForeColor = Color.Firebrick; }
    public void SetShiftChecking() { _checking = true; _timer.Text = "Проверяем…"; UpdateButtons(); }
    public void SetPending(int count) { _pending.Text = count == 0 ? "Все данные синхронизированы" : $"Ожидают отправки: {count}"; _pending.ForeColor = count == 0 ? Color.Green : Color.DarkOrange; }
    public void SetServerState(ConnectionState state) { _server.Text = state switch { ConnectionState.Connected => "Готов", ConnectionState.NoInternet => "Временно недоступен", ConnectionState.ServerUnavailable => "Временно недоступен", ConnectionState.AuthorizationError => "Ошибка конфигурации / токена", ConnectionState.NotFound => "Ошибка конфигурации / токена", ConnectionState.ServerError => "Временно недоступен", _ => "Подключаемся…" }; _server.ForeColor = state == ConnectionState.Connected ? Color.Green : Color.Firebrick; }
    private static string WorkDuration(double seconds) { var value = TimeSpan.FromSeconds(Math.Max(0, Math.Round(seconds))); return value.TotalHours >= 1 ? $"{(int)value.TotalHours}:{value.Minutes:00}:{value.Seconds:00}" : $"{value.Minutes:00}:{value.Seconds:00}"; }
    public void SetScan(ScanResponse r) { if (r.Result == "counted") _last.Text = r.LastIntervalSeconds.HasValue ? WorkDuration(r.LastIntervalSeconds.Value) : "Засчитан"; _orders.Text = r.OrdersToday.ToString(); _earnings.Text = $"{r.EarningsToday:N2} ₽"; _median.Text = r.MedianIntervalSeconds.HasValue ? WorkDuration(r.MedianIntervalSeconds.Value) : "—"; _notice.Text = r.Result switch { "counted" when r.LastIntervalSeconds.HasValue => $"+1 заказ · Последний заказ: {WorkDuration(r.LastIntervalSeconds.Value)}", "counted" => "+1 заказ", "duplicate" => "Дубликат — не засчитан", _ => "Отклонён: " + (r.Message.Length > 0 ? r.Message : r.Reason) }; _notice.ForeColor = r.Result == "counted" ? Color.Green : Color.Firebrick; RecordNotice(_notice.Text); }
    public void SetNotice(string value, bool error = false) { _notice.Text = value; _notice.ForeColor = error ? Color.Firebrick : Color.Green; RecordNotice(value); }
    private void RecordNotice(string value) { _history.Items.Insert(0, DateTime.Now.ToString("HH:mm:ss") + " " + value); if (_history.Items.Count > 200) _history.Items.RemoveAt(200); }
    public void SetShift(ShiftState s) { _state = s; _checking = false; _employee.Text = s.EmployeeName; _orders.Text = s.Orders.ToString(); _earnings.Text = $"{s.Earnings:N2} ₽"; _median.Text = s.MedianIntervalSeconds.HasValue ? WorkDuration(s.MedianIntervalSeconds.Value) : "—"; UpdateButtons(); UpdateTimer(s); }
    public void UpdateTimer(ShiftState s) { if (_checking) return; if (s.Status is "none" or "finished") { _timer.Text = "Смена не начата"; return; } var seconds = s.ActiveSeconds; if (s.Status == "active" && s.StartedAt.HasValue) seconds = Math.Max(seconds, (long)(DateTimeOffset.UtcNow - s.StartedAt.Value).TotalSeconds - s.PauseSeconds); var t = TimeSpan.FromSeconds(seconds); _timer.Text = s.Status == "paused" ? $"Пауза · работал {t:hh\\:mm\\:ss}" : $"Работает {t:hh\\:mm\\:ss}"; }
    public void ShowFront() { if (!Visible) Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate(); BringToFront(); }
}
