using System.Runtime.InteropServices;
using System.Text;

namespace ScannerAgent;

internal sealed class RawInput : NativeWindow, IDisposable
{
    private const int WM_INPUT = 0x00FF, RID_INPUT = 0x10000003, RIM_TYPEKEYBOARD = 1, RIDEV_INPUTSINK = 0x100;
    public event Action<string, Keys>? KeyReceived;
    public RawInput() { CreateHandle(new CreateParams { Caption = "WarehouseScannerAgent.RawInput", Parent = new IntPtr(-3) }); Register(); }
    protected override void WndProc(ref Message m) { if (m.Msg == WM_INPUT) Read(m.LParam); base.WndProc(ref m); }
    private void Register() { var d = new RAWINPUTDEVICE { UsagePage = 1, Usage = 6, Flags = RIDEV_INPUTSINK, Target = Handle }; if (!RegisterRawInputDevices([d], 1, (uint)Marshal.SizeOf<RAWINPUTDEVICE>())) throw new System.ComponentModel.Win32Exception(); }
    private void Read(IntPtr handle)
    {
        uint size = 0; GetRawInputData(handle, RID_INPUT, IntPtr.Zero, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>());
        if (size == 0) return; var buffer = Marshal.AllocHGlobal((int)size);
        try { if (GetRawInputData(handle, RID_INPUT, buffer, ref size, (uint)Marshal.SizeOf<RAWINPUTHEADER>()) != size) return; var raw = Marshal.PtrToStructure<RAWINPUT>(buffer); if (raw.Header.Type != RIM_TYPEKEYBOARD || raw.Keyboard.Message is 0x0101 or 0x0105) return; KeyReceived?.Invoke(DeviceName(raw.Header.Device), (Keys)raw.Keyboard.VKey); }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    public static IReadOnlyList<string> Devices()
    {
        uint count = 0; GetRawInputDeviceList(null, ref count, (uint)Marshal.SizeOf<RAWINPUTDEVICELIST>()); if (count == 0) return [];
        var list = new RAWINPUTDEVICELIST[count]; GetRawInputDeviceList(list, ref count, (uint)Marshal.SizeOf<RAWINPUTDEVICELIST>());
        return list.Where(x => x.Type == RIM_TYPEKEYBOARD).Select(x => DeviceName(x.Device)).Where(x => x.Length > 0).Distinct().ToList();
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
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUTDEVICE { public ushort UsagePage, Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUTDEVICELIST { public IntPtr Device; public uint Type; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUTHEADER { public uint Type, Size; public IntPtr Device, WParam; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWKEYBOARD { public ushort MakeCode, Flags, Reserved, VKey; public uint Message, ExtraInformation; }
    [StructLayout(LayoutKind.Sequential)] private struct RAWINPUT { public RAWINPUTHEADER Header; public RAWKEYBOARD Keyboard; }
    [DllImport("user32", SetLastError = true)] private static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
    [DllImport("user32")] private static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32")] private static extern uint GetRawInputDeviceList([Out] RAWINPUTDEVICELIST[]? list, ref uint count, uint size);
    [DllImport("user32", CharSet = CharSet.Unicode)] private static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder? data, ref uint size);
}
