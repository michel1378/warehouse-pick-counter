using System.Reflection;

namespace ScannerAgent;

internal static class AgentLog
{
    private static readonly object Sync = new();
    private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WarehouseScanner", "logs");
    private static readonly string PathName = Path.Combine(Folder, "scanner-agent.log");
    public static string Version => Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.1.0";
    public static void Info(string message) => Write("INFO", message);
    public static void Error(string message, Exception? error = null) => Write("ERROR", error is null ? message : $"{message}: {error.GetType().Name}: {error.Message}");
    private static void Write(string level, string message)
    {
        try { lock (Sync) { Directory.CreateDirectory(Folder); File.AppendAllText(PathName, $"{DateTimeOffset.Now:O} [{level}] {message}{Environment.NewLine}"); } } catch { }
    }
}
