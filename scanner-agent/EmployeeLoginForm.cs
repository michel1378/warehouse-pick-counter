namespace ScannerAgent;

internal sealed class EmployeeLoginForm : Form
{
    private readonly TextBox _pin = new() { UseSystemPasswordChar = true, MaxLength = 32, Dock = DockStyle.Top };
    private readonly Button _login = new() { Text = "Войти", Dock = DockStyle.Top };
    private readonly Label _status = new() { AutoSize = true, Dock = DockStyle.Top };
    public EmployeeSession? Employee { get; private set; }
    public EmployeeLoginForm(ApiClient api, AgentConfig config)
    {
        Text = "Сменить сотрудника"; Width = 340; Height = 190; StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
        var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16) };
        panel.Controls.Add(_status); panel.Controls.Add(_login); panel.Controls.Add(_pin);
        panel.Controls.Add(new Label { Text = "PIN сотрудника", Dock = DockStyle.Top }); Controls.Add(panel); AcceptButton = _login;
        _login.Click += async (_, _) =>
        {
            _login.Enabled = false; _status.Text = "Проверка…";
            try
            {
                var employee = await api.ResolveEmployeeAsync(config, _pin.Text.Trim());
                if (!Guid.TryParse(employee.Id, out _) || string.IsNullOrWhiteSpace(employee.Name) || !employee.Permissions.Contains("picking")) throw new InvalidDataException("Некорректный ответ входа");
                if (IsDisposed) return;
                Employee = employee; Employee.VerifiedAt = DateTimeOffset.UtcNow;
                _pin.Clear(); DialogResult = DialogResult.OK; Close();
            }
            catch (Exception) { if (!IsDisposed) { _status.Text = "Не удалось войти. Проверьте PIN и связь."; _pin.Clear(); _login.Enabled = true; } }
        };
    }
}
