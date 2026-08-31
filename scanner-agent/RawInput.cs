using System.Runtime.InteropServices;
using System.Text;

namespace ScannerAgent;

internal sealed record RawScan(string DevicePath, int RawCharCount, string Barcode, int ElapsedMs, double AverageIntervalMs);

internal sealed class RawInput : NativeWindow, IDisposable
{
    private const int WM_INPUT = 0x00FF, RID_INPUT = 0x10000003, RIM_TYPEKEYBOARD = 1, RIDEV_INPUTSINK = 0x100;
    private const uint WM_KEYDOWN = 0x0100, WM_SYSKEYDOWN = 0x0104;
    private readonly Dictionary<string, Capture> _captures = new(StringComparer.OrdinalIgnoreCase);
    public event Action<RawScan>? ScanReceived;
    public event Action<string, Keys, bool>? RawKeyReceived;
    public RawInput()
    {
        CreateHandle(new CreateParams { Caption = "WarehouseScannerAgent.RawInput", Parent = new IntPtr(-3) });
        if (Handle == IntPtr.Zero || !IsWindow(Handle)) throw new InvalidOperationException("Raw Input message window was not created.");
        Register();
    }
    protected override void WndProc(ref Message m) { if (m.Msg == WM_INPUT) Read(m.LParam); base.WndProc(ref m); }
    private void Register()
    {
        var d = new RAWINPUTDEVICE { UsagePage = 0x01, Usage = 0x06, Flags = RIDEV_INPUTSINK, Target = Handle };
        if (!RegisterRawInputDevices([d], 1, (uint)Marshal.SizeOf<RAWINPUTDEVICE>())) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "RegisterRawInputDevices failed.");
        AgentLog.Info($"raw_input_registered usage_page=0x01 usage=0x06 flags=RIDEV_INPUTSINK hwnd=0x{Handle.ToInt64():X} hwnd_alive={IsWindow(Handle)}");
    }
    private void Read(IntPtr handle)
    {
        uint size = 0;
        if (GetRawInputData(handle, RID_INPUT, IntPtr.Zero, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>()) == uint.MaxValue || size == 0) return;
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (GetRawInputData(handle, RID_INPUT, buffer, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>()) != size) return;
            var raw = Marshal.PtrToStructure<RAWINPUT>(buffer);
            if (raw.Header.Type != RIM_TYPEKEYBOARD) return;
            var path = DeviceName(raw.Header.Device); var key = (Keys)raw.Keyboard.VKey;
            var keyDown = raw.Keyboard.Message is WM_KEYDOWN or WM_SYSKEYDOWN;
            if (keyDown) ProcessKey(path, key);
            var length = !string.IsNullOrWhiteSpace(path) && _captures.TryGetValue(path, out var capture) ? capture.Text.Length : 0;
            AgentLog.RawInput(raw.Header.Device, path, key, keyDown, length);
            RawKeyReceived?.Invoke(path, key, keyDown);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private void ProcessKey(string device, Keys key)
    {
        if (string.IsNullOrWhiteSpace(device)) return;
        if (!_captures.TryGetValue(device, out var capture)) _captures[device] = capture = new Capture();
        var now = Environment.TickCount64;
        if (capture.LastAt != 0 && now - capture.LastAt > 2_000) capture.Reset();
        if (key is Keys.ShiftKey or Keys.LShiftKey or Keys.RShiftKey) { capture.Shift = true; capture.LastAt = now; return; }
        if (key is Keys.Enter or Keys.Return or Keys.Tab)
        {
            if (capture.Text.Length > 0)
            {
                var elapsed = capture.Times.Count > 1 ? (int)Math.Min(600_000, capture.Times[^1] - capture.Times[0]) : 0;
                var scan = new RawScan(device, capture.Text.Length, capture.Text.ToString().Trim(), elapsed, capture.Times.Count > 1 ? (double)elapsed / (capture.Times.Count - 1) : 0);
                capture.Reset();
                ScanReceived?.Invoke(scan);
            }
            else capture.Reset();
            return;
        }
        var character = Character(key, capture.Shift); capture.Shift = false; capture.LastAt = now;
        if (character is >= ' ' and <= '~') { capture.Text.Append(character); capture.Times.Add(now); if (capture.Text.Length > 512) capture.Reset(); }
    }
    public static IReadOnlyList<string> Devices()
    {
        uint count = 0; GetRawInputDeviceList(null, ref count, (uint)Marshal.SizeOf<RAWINPUTDEVICELIST>()); if (count == 0) return [];
        var list = new RAWINPUTDEVICELIST[count]; GetRawInputDeviceList(list, ref count, (uint)Marshal.SizeOf<RAWINPUTDEVICELIST>());
        return list.Where(x => x.Type == RIM_TYPEKEYBOARD).Select(x => DeviceName(x.Device)).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }
    private static string DeviceName(IntPtr device) { uint size = 0; GetRawInputDeviceInfo(device, 0x20000007, null, ref size); if (size == 0) return ""; var sb = new StringBuilder((int)size); GetRawInputDeviceInfo(device, 0x20000007, sb, ref size); return sb.ToString(); }
    public void Dispose() => DestroyHandle();
    public static char? Character(Keys key, bool shift)
    {
        if (key >= Keys.D0 && key <= Keys.D9) { const string shifted = ")!@#$%^&*("; var i = (int)key - (int)Keys.D0; return shift ? shifted[i] : (char)('0' + i); }
        if (key >= Keys.NumPad0 && key <= Keys.NumPad9) return (char)('0' + (int)key - (int)Keys.NumPad0);
        if (key >= Keys.A && key <= Keys.Z) return (char)((shift ? 'A' : 'a') + (int)key - (int)Keys.A);
        return key switch { Keys.OemMinus => shift ? '_' : '-', Keys.Oemplus => shift ? '+' : '=', Keys.Space => ' ', Keys.Decimal => '.', _ => null };
    }
    private sealed class Capture { public StringBuilder Text { get; } = new(); public List<long> Times { get; } = []; public bool Shift; public long LastAt; public void Reset() { Text.Clear(); Times.Clear(); Shift = false; LastAt = 0; } }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUTDEVICE { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUTDEVICELIST { public IntPtr Device; public uint Type; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUTHEADER { public uint Type, Size; public IntPtr Device, WParam; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWKEYBOARD { public ushort MakeCode, Flags, Reserved, VKey; public uint Message, ExtraInformation; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUT { public RAWINPUTHEADER Header; public RAWKEYBOARD Keyboard; }
    [DllImport("user32", SetLastError = true)] private static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
    [DllImport("user32")] private static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32")] private static extern uint GetRawInputDeviceList([Out] RAWINPUTDEVICELIST[]? list, ref uint count, uint size);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder? data, ref uint size);
    [DllImport("user32")] private static extern bool IsWindow(IntPtr handle);
}
