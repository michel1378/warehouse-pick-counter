using System.Reflection;

namespace ScannerAgent;

internal static class AgentLog
{
    private static readonly object Sync = new();
    private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WarehouseScanner", "logs");
    private static readonly string PathName = Path.Combine(Folder, "scanner-agent.log");
    public static string Version => Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.1.2";
    public static void Info(string message) => Write("INFO", message);
    public static void Error(string message, Exception? error = null) => Write("ERROR", error is null ? message : $"{message}: {error.GetType().Name}: {error.Message}");
    public static void Scan(RawScan scan, string validationResult) => Write("SCAN", $"device_path={scan.DevicePath} raw_char_count={scan.RawCharCount} normalized_barcode={scan.Barcode} barcode_length={scan.Barcode.Length} elapsed_input_ms={scan.ElapsedMs} validation_result={validationResult}");
    public static void RawInput(IntPtr deviceHandle, string devicePath, Keys key, bool keyDown, int bufferLength) => Write("RAW", $"device_handle=0x{deviceHandle.ToInt64():X} device_path={devicePath} raw_key={(int)key}({key}) key_state={(keyDown ? "down" : "up")} accumulated_buffer_length={bufferLength}");
    private static void Write(string level, string message)
    {
        try { lock (Sync) { Directory.CreateDirectory(Folder); File.AppendAllText(PathName, $"{DateTimeOffset.Now:O} [{level}] {message}{Environment.NewLine}"); } } catch { }
    }
}
