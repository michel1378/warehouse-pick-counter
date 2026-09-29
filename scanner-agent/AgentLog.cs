using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
namespace ScannerAgent;
internal static class AgentLog
{
    private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WarehouseScanner", "logs");
    private static readonly Channel<string> Lines = Channel.CreateBounded<string>(new BoundedChannelOptions(4096) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
    private static readonly Task Writer = Task.Run(async () => {
        await foreach (var line in Lines.Reader.ReadAllAsync()) {
            try {
                Directory.CreateDirectory(Folder); var path = Path.Combine(Folder,"scanner-agent.log");
                if (File.Exists(path) && new FileInfo(path).Length > 5_000_000) File.Move(path,path+".1",true);
                await File.AppendAllTextAsync(path,line+Environment.NewLine);
            } catch { /* Logging never interrupts capture/delivery. */ }
        }
    });
    public static string Version => Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.3.0";
    public static void Info(string message) => Write("info", message);
    public static void Error(string message, Exception? error = null) => Write("error", message + " exception_type=" + error?.GetType().Name);
    private static void Write(string level,string message) {
        var fields = new Dictionary<string,object?> { ["at"] = DateTimeOffset.UtcNow, ["level"] = level, ["message"] = message };
        foreach (Match m in Regex.Matches(message,@"(?<key>[a-z_]+)=(?<value>[^\s]+)")) fields[m.Groups["key"].Value] = m.Groups["value"].Value;
        Lines.Writer.TryWrite(JsonSerializer.Serialize(fields));
    }
    public static async Task Complete() { Lines.Writer.TryComplete(); await Writer; }
}
