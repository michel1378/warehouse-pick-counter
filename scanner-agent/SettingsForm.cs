namespace ScannerAgent;

internal sealed class SettingsForm : Form
{
    private readonly TextBox _url = new() { Dock = DockStyle.Fill, PlaceholderText = "https://example.vercel.app" }, _employee = new() { Dock = DockStyle.Fill, PlaceholderText = "UUID сотрудника или PIN" }, _token = new() { Dock = DockStyle.Fill, UseSystemPasswordChar = true };
    private readonly ComboBox _device = new() { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly Label _identify = new() { AutoSize = true };
    public event Action? DetectionRequested;
    public AgentConfig? Result { get; private set; } public string Token => _token.Text;
    public SettingsForm(AgentConfig? current)
    {
        Text = "Настройка складского сканера"; Width = 700; Height = 390; StartPosition = FormStartPosition.CenterScreen; MaximizeBox = false;
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 7 }; grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Add(grid, 0, "URL сайта / API", _url); Add(grid, 1, "Сотрудник (UUID или PIN)", _employee); Add(grid, 2, "API token", _token); Add(grid, 3, "HID-сканер", _device);
        var refresh = new Button { Text = "Обновить список", AutoSize = true }; refresh.Click += (_, _) => LoadDevices(current?.ScannerDevice); grid.Controls.Add(refresh, 1, 4);
        var identify = new Button { Text = "Определить сканер", AutoSize = true }; identify.Click += (_, _) => { _identify.Text = "Сканируйте любой штрихкод"; DetectionRequested?.Invoke(); }; var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true }; panel.Controls.Add(identify); panel.Controls.Add(_identify); grid.Controls.Add(panel, 1, 5);
        var save = new Button { Text = "Сохранить и начать", AutoSize = true }; save.Click += Save; grid.Controls.Add(save, 1, 6); Controls.Add(grid); AcceptButton = save;
        _url.Text = current?.BackendUrl ?? ""; _employee.Text = current?.EmployeeIdentifier ?? ""; _token.Text = Storage.LoadToken(); LoadDevices(current?.ScannerDevice);
    }
    private static void Add(TableLayoutPanel g, int row, string label, Control c) { g.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left }, 0, row); g.Controls.Add(c, 1, row); }
    private void LoadDevices(string? selected) { _device.Items.Clear(); foreach (var d in RawInput.Devices()) _device.Items.Add(d); if (selected is not null && _device.Items.Contains(selected)) _device.SelectedItem = selected; else if (_device.Items.Count > 0) _device.SelectedIndex = 0; }
    public void CompleteDetection(string device) { if (IsDisposed) return; BeginInvoke(() => { if (!_device.Items.Contains(device)) _device.Items.Add(device); _device.SelectedItem = device; _identify.Text = "Сканер определен"; }); }
    private void Save(object? sender, EventArgs e)
    {
        if (!Uri.TryCreate(_url.Text.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Host != "localhost")) { MessageBox.Show("Укажите корректный HTTPS URL."); return; }
        if (string.IsNullOrWhiteSpace(_employee.Text) || _token.Text.Length < 32 || _device.SelectedItem is not string device) { MessageBox.Show("Заполните сотрудника, токен (минимум 32 символа) и выберите сканер."); return; }
        Result = new AgentConfig { BackendUrl = _url.Text.Trim(), EmployeeIdentifier = _employee.Text.Trim(), ScannerDevice = device }; DialogResult = DialogResult.OK; Close();
    }
    protected override void OnShown(EventArgs e) { base.OnShown(e); TopMost = true; Activate(); BringToFront(); BeginInvoke(() => TopMost = false); }
}
