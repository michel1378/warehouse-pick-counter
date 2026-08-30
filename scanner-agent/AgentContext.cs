using System.Text;

namespace ScannerAgent;

internal sealed class AgentContext : ApplicationContext
{
    private readonly RawInput _raw = new();
    private readonly ApiClient _api = new();
    private readonly NotifyIcon _tray;
    private readonly StringBuilder _buffer = new();
    private readonly List<long> _times = [];
    private readonly SemaphoreSlim _sending = new(1, 1);
    private readonly System.Windows.Forms.Timer _retry = new() { Interval = 30_000 };
    private AgentConfig _config = new();
    private bool _shift;

    public AgentContext()
    {
        _tray = new NotifyIcon { Icon = SystemIcons.Application, Visible = true, Text = "Складской сканер" };
        _tray.ContextMenuStrip = BuildMenu(); _tray.DoubleClick += (_, _) => OpenSettings();
        _raw.KeyReceived += OnKey;
        _retry.Tick += async (_, _) => await FlushQueue(); _retry.Start();
        var existing = Storage.LoadConfig();
        if (existing is null || string.IsNullOrEmpty(Storage.LoadToken())) { if (!OpenSettings(existing)) { Exit(); return; } }
        else _config = existing;
        UpdateTooltip("Работает"); _ = FlushQueue();
    }
    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Статус: Работает").Enabled = false;
        menu.Items.Add("Сотрудник: —").Enabled = false;
        menu.Items.Add("Сканер: —").Enabled = false;
        menu.Items.Add("Открыть настройки", null, (_, _) => OpenSettings());
        menu.Items.Add("Проверить соединение", null, async (_, _) => await FlushQueue(true));
        menu.Items.Add("Сменить сотрудника", null, (_, _) => OpenSettings());
        menu.Items.Add("Выход", null, (_, _) => Exit()); return menu;
    }
    private bool OpenSettings(AgentConfig? config = null)
    {
        using var form = new SettingsForm(config ?? _config, _raw);
        if (form.ShowDialog() != DialogResult.OK || form.Result is null) return false;
        _config = form.Result; Storage.SaveConfig(_config, form.Token); UpdateTooltip("Работает"); return true;
    }
    private void OnKey(string device, Keys key)
    {
        if (!string.Equals(device, _config.ScannerDevice, StringComparison.OrdinalIgnoreCase)) return;
        if (key is Keys.ShiftKey or Keys.LShiftKey or Keys.RShiftKey) { _shift = true; return; }
        if (key == Keys.Enter)
        {
            if (_buffer.Length >= 8 && _buffer.ToString().All(char.IsDigit)) CompleteScan(); else Reset();
            return;
        }
        var c = RawInput.Character(key, _shift); _shift = false;
        if (c is >= ' ' and <= '~') { _buffer.Append(c); _times.Add(Environment.TickCount64); if (_buffer.Length > 512) Reset(); }
    }
    private void CompleteScan()
    {
        var duration = _times.Count > 1 ? (int)Math.Min(600_000, _times[^1] - _times[0]) : 0;
        var average = _times.Count > 1 ? (double)duration / (_times.Count - 1) : 0;
        var item = new ScanEvent(Guid.NewGuid(), _buffer.ToString(), _config.EmployeeIdentifier, duration, average, "windows-agent", _config.ScannerDevice, DateTimeOffset.UtcNow);
        var queue = Storage.LoadQueue(); queue.Add(item); Storage.SaveQueue(queue); Reset(); _ = FlushQueue();
    }
    private void Reset() { _buffer.Clear(); _times.Clear(); _shift = false; }
    private async Task FlushQueue(bool announceConnection = false)
    {
        if (!await _sending.WaitAsync(0)) return;
        try
        {
            var queue = Storage.LoadQueue();
            while (queue.Count > 0)
            {
                ScanResponse response;
                try { response = await _api.SendAsync(_config, queue[0]); }
                catch { SetOffline(); if (announceConnection) Notify("Нет связи с сервером", ToolTipIcon.Error); return; }
                queue.RemoveAt(0); Storage.SaveQueue(queue);
                UpdateTooltip("Работает");
                Notify(response.Message.Length > 0 ? response.Message : response.Result switch { "counted" => $"+1 заказ. Сегодня: {response.OrdersToday}", "duplicate" => "Дубль — не засчитан", _ => "Скан отклонён" }, response.Result == "counted" ? ToolTipIcon.Info : ToolTipIcon.Error);
            }
            if (announceConnection) Notify("Соединение с сервером работает", ToolTipIcon.Info);
        }
        finally { _sending.Release(); }
    }
    private void Notify(string text, ToolTipIcon icon) { _tray.BalloonTipTitle = "Складской сканер"; _tray.BalloonTipText = text; _tray.BalloonTipIcon = icon; _tray.ShowBalloonTip(3500); }
    private void SetOffline() { UpdateTooltip("Нет связи"); }
    private void UpdateTooltip(string status) { var tooltip = $"{status} · {_config.EmployeeIdentifier}"; _tray.Text = tooltip[..Math.Min(63, tooltip.Length)]; if (_tray.ContextMenuStrip is { } m) { m.Items[0].Text = $"Статус: {status}"; m.Items[1].Text = $"Сотрудник: {_config.EmployeeIdentifier}"; m.Items[2].Text = $"Сканер: {ShortDevice(_config.ScannerDevice)}"; } }
    private static string ShortDevice(string value) => value.Length <= 42 ? value : "…" + value[^41..];
    private void Exit() { _retry.Stop(); _retry.Dispose(); _tray.Visible = false; _tray.Dispose(); _raw.Dispose(); _api.Dispose(); ExitThread(); }
}
