using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace ScannerAgent;

internal static class Storage
{
    private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WarehouseScannerAgent");
    private static readonly string ConfigPath = Path.Combine(Folder, "config.json");
    private static readonly string MachineFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WarehouseScanner");
    private static readonly string MachineConfigPath = Path.Combine(MachineFolder, "config.json");
    private static readonly string TokenPath = Path.Combine(MachineFolder, "api-token.dpapi");
    private static readonly string SessionPath = Path.Combine(Folder, "employee-session.dpapi");
    private static readonly ScanQueue Queue = new(Folder);
    private const string CredentialTarget = "WarehouseScannerAgent/ApiToken";
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };

    public static AgentConfig? LoadConfig()
    {
        if (File.Exists(MachineConfigPath))
        {
            var machine = Read<AgentConfig>(MachineConfigPath);
            if (File.Exists(ConfigPath)) { var old = Read<AgentConfig>(ConfigPath); if (old is not null) AtomicWrite(ConfigPath, JsonSerializer.SerializeToUtf8Bytes(old, Json)); }
            return machine;
        }
        var legacy = Read<AgentConfig>(ConfigPath);
        if (legacy is null) return null;
        legacy.Fingerprint = ScannerFingerprint.Read(legacy.ScannerDevice);
        SaveConfig(legacy, LoadLegacyToken());
        // Remove the old cleartext PIN; the employee signs in once after upgrading.
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(legacy, Json));
        AgentLog.Info("legacy machine configuration migrated; employee PIN omitted");
        return legacy;
    }
    public static void SaveConfig(AgentConfig config, string token)
    {
        Directory.CreateDirectory(MachineFolder);
        AtomicWrite(TokenPath, WindowsSecret.Protect(Encoding.UTF8.GetBytes(token), true));
        SaveMachine(config);
    }
    public static void SaveMachine(AgentConfig config) { Directory.CreateDirectory(MachineFolder); AtomicWrite(MachineConfigPath, JsonSerializer.SerializeToUtf8Bytes(config, Json)); }
    public static EmployeeSession? LoadEmployee() => File.Exists(SessionPath) ? JsonSerializer.Deserialize<EmployeeSession>(WindowsSecret.Unprotect(File.ReadAllBytes(SessionPath)), Json) : null;
    public static void SaveEmployee(EmployeeSession employee) { Directory.CreateDirectory(Folder); AtomicWrite(SessionPath, WindowsSecret.Protect(JsonSerializer.SerializeToUtf8Bytes(employee, Json), false)); }
    public static void ClearEmployee() { if (File.Exists(SessionPath)) File.Delete(SessionPath); }
    public static List<ScanEvent> LoadQueue() => Queue.Load();
    public static void Enqueue(ScanEvent item) => Queue.Enqueue(item);
    public static ScanEvent? PeekQueue() => Queue.Load().FirstOrDefault();
    public static void RemoveFromQueue(Guid eventId) => Queue.Remove(eventId);
    private static void AtomicWrite(string path, byte[] bytes) { var temporary = path + ".tmp"; using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None)) { file.Write(bytes); file.Flush(true); } File.Move(temporary, path, true); }
    private static T? Read<T>(string path) => File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Json) : default;

    public static string LoadToken()
        => File.Exists(TokenPath) ? Encoding.UTF8.GetString(WindowsSecret.Unprotect(File.ReadAllBytes(TokenPath))) : "";

    private static string LoadLegacyToken()
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
