using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace ScannerAgent;

internal static class Storage
{
    private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WarehouseScannerAgent");
    private static readonly string ConfigPath = Path.Combine(Folder, "config.json");
    private static readonly string QueuePath = Path.Combine(Folder, "pending-scans.json");
    private const string CredentialTarget = "WarehouseScannerAgent/ApiToken";
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };

    public static AgentConfig? LoadConfig() => Read<AgentConfig>(ConfigPath);
    public static void SaveConfig(AgentConfig config, string token) { Directory.CreateDirectory(Folder); File.WriteAllText(ConfigPath, JsonSerializer.Serialize(config, Json)); SaveToken(token); }
    public static List<ScanEvent> LoadQueue() => Read<List<ScanEvent>>(QueuePath) ?? [];
    public static void SaveQueue(List<ScanEvent> queue) { Directory.CreateDirectory(Folder); File.WriteAllText(QueuePath, JsonSerializer.Serialize(queue, Json)); }
    private static T? Read<T>(string path) { try { return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json) : default; } catch { return default; } }

    public static string LoadToken()
    {
        if (!CredRead(CredentialTarget, 1, 0, out var ptr)) return "";
        try { var c = Marshal.PtrToStructure<CREDENTIAL>(ptr); return c.CredentialBlobSize == 0 ? "" : Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2) ?? ""; }
        finally { CredFree(ptr); }
    }

    private static void SaveToken(string token)
    {
        var bytes = Encoding.Unicode.GetBytes(token);
        var blob = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new CREDENTIAL { Type = 1, TargetName = CredentialTarget, CredentialBlobSize = (uint)bytes.Length, CredentialBlob = blob, Persist = 2, UserName = Environment.UserName };
            if (!CredWrite(ref credential, 0)) throw new InvalidOperationException("Не удалось сохранить токен в Windows Credential Manager.");
        }
        finally { Marshal.FreeCoTaskMem(blob); }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string? Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string? TargetAlias; public string UserName; }
    [DllImport("advapi32", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
    [DllImport("advapi32", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32")] private static extern void CredFree(IntPtr buffer);
}
