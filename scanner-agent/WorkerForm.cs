namespace ScannerAgent;

internal sealed class WorkerForm : Form
{
    private readonly Label _employee = V("—"), _orders = V("0"), _earnings = V("0 ₽"), _scanner = V("Готов"), _server = V("Проверка…"), _timer = V("Смена не начата"), _notice = V("");
    private readonly Button _start = new() { Text = "Начать смену", AutoSize = true }, _pause = new() { Text = "Пауза", AutoSize = true }, _resume = new() { Text = "Продолжить", AutoSize = true }, _finish = new() { Text = "Завершить смену", AutoSize = true }, _settings = new() { Text = "Настройки", AutoSize = true };
    public event Action<string>? ShiftActionRequested;
    public event Action? SettingsRequested;
    public WorkerForm()
    {
        Text = "Складской scanner-agent"; Width = 390; Height = 430; MinimumSize = new Size(360, 390); StartPosition = FormStartPosition.Manual;
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1200, 800); Location = new Point(area.Right - Width - 16, area.Top + 16);
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 2, RowCount = 9 };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 52));
        Add(grid, 0, "Сотрудник", _employee); Add(grid, 1, "Заказов сегодня", _orders); Add(grid, 2, "Заработано сегодня", _earnings); Add(grid, 3, "Сканер", _scanner); Add(grid, 4, "Сервер", _server); Add(grid, 5, "Текущая смена", _timer);
        _notice.Font = new Font(Font, FontStyle.Bold); grid.Controls.Add(_notice, 0, 6); grid.SetColumnSpan(_notice, 2);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true }; buttons.Controls.AddRange([_start, _pause, _resume, _finish, _settings]); grid.Controls.Add(buttons, 0, 7); grid.SetColumnSpan(buttons, 2);
        var top = new CheckBox { Text = "Поверх остальных окон", AutoSize = true }; top.CheckedChanged += (_, _) => TopMost = top.Checked; grid.Controls.Add(top, 0, 8); grid.SetColumnSpan(top, 2); Controls.Add(grid);
        _start.Click += (_, _) => ShiftActionRequested?.Invoke("start"); _pause.Click += (_, _) => ShiftActionRequested?.Invoke("pause"); _resume.Click += (_, _) => ShiftActionRequested?.Invoke("resume"); _finish.Click += (_, _) => ShiftActionRequested?.Invoke("finish"); _settings.Click += (_, _) => SettingsRequested?.Invoke();
        FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        SetShift(new ShiftState());
    }
    private static Label V(string text) => new() { Text = text, AutoSize = true, Anchor = AnchorStyles.Left };
    private static void Add(TableLayoutPanel g, int row, string title, Control value) { g.Controls.Add(new Label { Text = title, AutoSize = true, ForeColor = Color.DimGray, Anchor = AnchorStyles.Left }, 0, row); g.Controls.Add(value, 1, row); }
    public void SetConnection(bool online) { _server.Text = online ? "Подключён" : "Нет связи"; _server.ForeColor = online ? Color.Green : Color.Firebrick; }
    public void SetAuthorizationError() { _server.Text = "Ошибка авторизации"; _server.ForeColor = Color.Firebrick; }
    public void SetScan(ScanResponse r) { _orders.Text = r.OrdersToday.ToString(); _earnings.Text = $"{r.EarningsToday:N2} ₽"; _notice.Text = r.Result switch { "counted" => "+1 заказ", "duplicate" => "Дубль — не засчитан", _ => r.Message.Length > 0 ? r.Message : "Скан отклонен" }; _notice.ForeColor = r.Result == "counted" ? Color.Green : Color.Firebrick; }
    public void SetNotice(string value, bool error = false) { _notice.Text = value; _notice.ForeColor = error ? Color.Firebrick : Color.Green; }
    public void SetShift(ShiftState s) { _employee.Text = s.EmployeeName; _orders.Text = s.Orders.ToString(); _earnings.Text = $"{s.Earnings:N2} ₽"; _start.Enabled = s.Status is "none" or "finished"; _pause.Enabled = s.Status == "active"; _resume.Enabled = s.Status == "paused"; _finish.Enabled = s.Status is "active" or "paused"; UpdateTimer(s); }
    public void UpdateTimer(ShiftState s) { if (s.Status is "none" or "finished") { _timer.Text = "Смена не начата"; return; } var seconds = s.ActiveSeconds; if (s.Status == "active" && s.StartedAt.HasValue) seconds = Math.Max(seconds, (long)(DateTimeOffset.UtcNow - s.StartedAt.Value).TotalSeconds - s.PauseSeconds); var t = TimeSpan.FromSeconds(seconds); _timer.Text = s.Status == "paused" ? $"Пауза · работал {t:hh\\:mm\\:ss}" : $"Работает {t:hh\\:mm\\:ss}"; }
    public void ShowFront() { if (!Visible) Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate(); BringToFront(); }
}
