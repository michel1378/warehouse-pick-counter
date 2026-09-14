namespace ScannerAgent;

internal sealed class SettingsForm : Form
{
    private readonly TextBox _url = new() { Dock = DockStyle.Fill, PlaceholderText = "https://example.vercel.app" };
    private readonly TextBox _token = new() { Dock = DockStyle.Fill, UseSystemPasswordChar = true };
    private readonly ComboBox _device = new() { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly Label _identify = new() { AutoSize = true };
    private readonly AgentConfig? _current;
    public event Action? DetectionRequested;
    public AgentConfig? Result { get; private set; }
    public string Token => _token.Text;
    public SettingsForm(AgentConfig? current)
    {
        _current = current;
        Text = "Расширенные настройки ноутбука"; Width = 700; Height = 330;
        StartPosition = FormStartPosition.CenterScreen; MaximizeBox = false;
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 6 };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Add(grid, 0, "URL сайта / API", _url); Add(grid, 1, "API token", _token); Add(grid, 2, "HID-сканер", _device);
        var refresh = new Button { Text = "Обновить список", AutoSize = true };
        refresh.Click += (_, _) => LoadDevices(current?.ScannerDevice); grid.Controls.Add(refresh, 1, 3);
        var identify = new Button { Text = "Определить сканер", AutoSize = true };
        identify.Click += (_, _) => { _identify.Text = "Сканируйте любой штрихкод"; DetectionRequested?.Invoke(); };
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true }; panel.Controls.Add(identify); panel.Controls.Add(_identify); grid.Controls.Add(panel, 1, 4);
        var save = new Button { Text = "Сохранить", AutoSize = true }; save.Click += Save; grid.Controls.Add(save, 1, 5);
        Controls.Add(grid); AcceptButton = save;
        _url.Text = current?.BackendUrl ?? ""; _token.Text = Storage.LoadToken(); LoadDevices(current?.ScannerDevice);
    }
    private static void Add(TableLayoutPanel grid, int row, string label, Control control)
    { grid.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left }, 0, row); grid.Controls.Add(control, 1, row); }
    private void LoadDevices(string? selected)
    {
        _device.Items.Clear();
        foreach (var device in RawInput.Devices()) _device.Items.Add(device);
        if (selected is not null) { if (!_device.Items.Contains(selected)) _device.Items.Add(selected); _device.SelectedItem = selected; }
    }
    public void CompleteDetection(string device)
    {
        if (IsDisposed) return;
        if (!_device.Items.Contains(device)) _device.Items.Add(device);
        _device.SelectedItem = device; _identify.Text = "Сканер определён";
    }
    private void Save(object? sender, EventArgs e)
    {
        if (!Uri.TryCreate(_url.Text.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != "https" && !uri.IsLoopback) || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query))
        { MessageBox.Show("Укажите корректный HTTPS URL без паролей и параметров."); return; }
        if (_token.Text.Length < 32) { MessageBox.Show("Токен должен содержать минимум 32 символа."); return; }
        var device = _device.SelectedItem as string ?? "";
        var fingerprint = device == _current?.ScannerDevice ? _current.Fingerprint : ScannerFingerprint.Read(device);
        if (device.Length > 0 && fingerprint is null) { MessageBox.Show("Не удалось получить fingerprint. Подключите USB-сканер и повторите определение."); return; }
        Result = new AgentConfig { BackendUrl = _url.Text.Trim().TrimEnd('/'), ScannerDevice = device, Fingerprint = fingerprint };
        DialogResult = DialogResult.OK; Close();
    }
}