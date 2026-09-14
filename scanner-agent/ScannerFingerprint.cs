using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace ScannerAgent;

internal sealed record ScannerFingerprint(int Vid, int Pid, int UsagePage = 1, int Usage = 6,
    string? Product = null, string? Manufacturer = null, string? Serial = null, string? Collection = null)
{
    public bool Matches(ScannerFingerprint other) => Vid == other.Vid && Pid == other.Pid &&
        UsagePage == other.UsagePage && Usage == other.Usage &&
        (string.IsNullOrEmpty(Serial) || string.Equals(Serial, other.Serial, StringComparison.OrdinalIgnoreCase)) &&
        (string.IsNullOrEmpty(Collection) || string.Equals(Collection, other.Collection, StringComparison.OrdinalIgnoreCase));

    public static ScannerFingerprint? Read(string path)
    {
        var ids = Regex.Match(path, @"VID_([0-9A-F]{4})&PID_([0-9A-F]{4})", RegexOptions.IgnoreCase);
        if (!ids.Success) return null; // Never bind a generic/RDP keyboard as the scanner.
        var collection = Regex.Match(path, @"&COL[0-9A-F]{2}", RegexOptions.IgnoreCase).Value;
        using var handle = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        string? ReadString(Func<SafeFileHandle, StringBuilder, int, bool> read)
        {
            if (handle.IsInvalid) return null;
            var value = new StringBuilder(256);
            return read(handle, value, 512) && value.Length > 0 ? value.ToString() : null;
        }
        // These are Raw Input keyboard collections, whose usage is Generic Desktop/Keyboard.
        return new(Convert.ToInt32(ids.Groups[1].Value, 16), Convert.ToInt32(ids.Groups[2].Value, 16),
            Product: ReadString(HidD_GetProductString), Manufacturer: ReadString(HidD_GetManufacturerString),
            Serial: ReadString(HidD_GetSerialNumberString), Collection: collection);
    }

    public static string? Resolve(ScannerFingerprint saved, IEnumerable<(string Path, ScannerFingerprint Fingerprint)> devices)
    {
        var matches = devices.Where(d => saved.Matches(d.Fingerprint)).ToArray();
        // Identical devices without serials cannot safely be distinguished by VID/PID alone.
        return matches.Length == 1 ? matches[0].Path : null;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("hid.dll", CharSet = CharSet.Unicode)] private static extern bool HidD_GetProductString(SafeFileHandle handle, StringBuilder value, int length);
    [DllImport("hid.dll", CharSet = CharSet.Unicode)] private static extern bool HidD_GetManufacturerString(SafeFileHandle handle, StringBuilder value, int length);
    [DllImport("hid.dll", CharSet = CharSet.Unicode)] private static extern bool HidD_GetSerialNumberString(SafeFileHandle handle, StringBuilder value, int length);
}
