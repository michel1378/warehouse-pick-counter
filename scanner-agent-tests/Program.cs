using System.Net;
using System.Text;
using System.Text.Json;
using ScannerAgent;

static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
foreach (var value in new[] { "0012345678", "12345678901234567890", "123456789012345678901" }) Check(BarcodePolicy.Type(value) == "numeric", "numeric compatibility");
Check(BarcodePolicy.Normalize(" p00 119280697\r\n") == "P00119280697", "normalization");
Check(BarcodePolicy.Type("P00119280697") == "yandex", "yandex");
foreach (var value in new[] { "ABC123", "TEST123", "P1234567", "Р00119280697", "P1234567A", "１２３４５６７８" }) Check(BarcodePolicy.Type(value) == "invalid", "reject " + value);
var fingerprint = new ScannerFingerprint(0x1234, 0xabcd);
Check(ScannerFingerprint.Resolve(fingerprint, [("new-path", fingerprint)]) == "new-path", "changed Windows path");
Check(ScannerFingerprint.Resolve(fingerprint, []) is null, "unplug");
Check(ScannerFingerprint.Resolve(fingerprint, [("reconnected", fingerprint)]) == "reconnected", "replug");
Check(ScannerFingerprint.Resolve(fingerprint, [("a", fingerprint), ("b", fingerprint)]) is null, "ambiguous hardware");
Check(!(fingerprint with { Serial = "a" }).Matches(fingerprint with { Serial = "b" }), "physical serial isolation");
var root = Path.Combine(Directory.GetCurrentDirectory(), "scanner-agent-tests", "artifacts", Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var queue = new ScanQueue(root);
var first = new ScanEvent(Guid.NewGuid(), "P00119280697", Guid.NewGuid().ToString(), 100, "old-path", DateTimeOffset.UtcNow.AddHours(-2), new(10, "windows-agent"), Guid.NewGuid());
var second = first with { EventId = Guid.NewGuid(), Barcode = "0012345678", EmployeeIdentifier = Guid.NewGuid().ToString() };
File.WriteAllText(Path.Combine(root, "pending-scans.json"), JsonSerializer.Serialize(new[] { first }));
Check(queue.Load().Single() == first, "legacy migration preserves event/time/identity");
Check(!File.Exists(Path.Combine(root, "pending-scans.json")), "legacy plaintext removed after durable encryption");
queue.Enqueue(first); queue.Enqueue(second);
Check(new ScanQueue(root).Load().Count == 2, "offline restart and idempotent enqueue");
Check(!Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(root, "pending-scans.dpapi"))).Contains(first.Barcode), "queue encrypted");
var protectedToken = WindowsSecret.Protect(Encoding.UTF8.GetBytes("test-secret"), true);
Check(Encoding.UTF8.GetString(WindowsSecret.Unprotect(protectedToken)) == "test-secret", "machine DPAPI round trip");
var handler = new FakeHttp();
using var api = new ApiClient(handler);
var config = new AgentConfig { BackendUrl = "https://example.invalid", EmployeeIdentifier = second.EmployeeIdentifier };
foreach (var status in new[] { HttpStatusCode.InternalServerError, HttpStatusCode.TooManyRequests, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden })
{
    handler.Status = status;
    try { await api.SendAsync(config, first); throw new Exception("HTTP failure acknowledged"); } catch (HttpRequestException) { }
    Check(queue.Load().Count == 2, "failed send must retain queue");
}
handler.Status = HttpStatusCode.OK;
var response = await api.SendAsync(config, first);
Check(response.Result == "counted", "server acknowledgement");
using (var body = JsonDocument.Parse(handler.LastBody!))
{
    Check(body.RootElement.GetProperty("employee_identifier").GetString() == first.EmployeeIdentifier, "switch employee must not reassign pending scan");
    Check(body.RootElement.GetProperty("scanned_at").GetDateTimeOffset() == first.ScannedAt, "offline scanned_at preserved");
    Check(body.RootElement.GetProperty("barcode").GetString() == first.Barcode, "full Yandex barcode sent");
}
queue.Remove(first.EventId); Check(new ScanQueue(root).Load().Single() == second, "ack removes only one event");
handler.Status = HttpStatusCode.OK; handler.Delay = true;
var timer = System.Diagnostics.Stopwatch.StartNew();
try { await api.PingAsync(config); throw new Exception("Health timeout missing"); } catch (HttpRequestException) { }
Check(timer.Elapsed.TotalSeconds < 5, "health timeout must be independent of 30-second operation timeout");
File.WriteAllBytes(Path.Combine(root, "pending-scans.dpapi"), [1, 2, 3]);
try { queue.Enqueue(first); throw new Exception("Corrupt queue overwritten"); } catch (System.ComponentModel.Win32Exception) { }
Console.WriteLine("PASS: barcode, HID fingerprint/reconnect/ambiguity, DPAPI, legacy queue migration, restart, identity/timestamp preservation, retryable HTTP failures and 3-second health timeout.");

internal sealed class FakeHttp : HttpMessageHandler
{
    public HttpStatusCode Status = HttpStatusCode.OK;
    public bool Delay;
    public string? LastBody;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (Delay) await Task.Delay(Timeout.Infinite, cancellationToken);
        LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        return new(Status) { Content = new StringContent("{\"result\":\"counted\",\"success\":true}") };
    }
}
namespace ScannerAgent
{
    internal static class Storage { public static string LoadToken() => "test-token"; }
    internal static class AgentLog { public static void Info(string message) { } }
}
