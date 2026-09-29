using System.Net;
using System.Text;
using System.Text.Json;
using ScannerAgent;

// A fresh child process validates the actual persisted queue, not a reused object.
if (args.Length == 2 && args[0] == "--restart-queue") { Check(new ScanQueue(args[1]).Load().Count == 2, "fresh process queue"); return; }
foreach (var vector in JsonDocument.Parse(File.ReadAllText("tests/fixtures/barcodes.json")).RootElement.EnumerateArray()) {
    var normalized = BarcodePolicy.Normalize(vector[0].GetString()!);
    Check(normalized == vector[1].GetString(), "shared normalization vector");
    Check((BarcodePolicy.Type(normalized) != "invalid") == vector[2].GetBoolean(), "shared validity vector");
}
static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
foreach (var value in new[] { "0012345678", "12345678901234567890", "123456789012345678901" }) Check(BarcodePolicy.Type(value) == "numeric", "numeric compatibility");
Check(BarcodePolicy.Normalize(" p00 119280697\r\n") == "p00 119280697", "internal whitespace preserved");
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
var childStart = new System.Diagnostics.ProcessStartInfo("dotnet") { UseShellExecute = false, CreateNoWindow = true };
foreach (var argument in new[] { "--roll-forward", "Major", System.Reflection.Assembly.GetExecutingAssembly().Location, "--restart-queue", root }) childStart.ArgumentList.Add(argument);
using (var child = System.Diagnostics.Process.Start(childStart)!) { child.WaitForExit(); Check(child.ExitCode == 0, "queue survives full process restart"); }

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

// Startup recovery and auth/schema backoff.
var policy = new RecoveryPolicy();
foreach (var delay in new[] { 1, 2, 5, 10, 15, 15 }) Check(policy.Fail(new HttpRequestException()) == delay, "reconnect backoff");
policy.Ready(); Check(policy.Fail(new HttpRequestException()) == 1, "reset after recovery");
Check(policy.Fail(new AgentApiException("schema", HttpStatusCode.ServiceUnavailable, "schema_mismatch")) == 60, "configuration cooldown");
handler.Delay = false; handler.Body = "{\"ready\":true,\"scanReady\":true,\"version\":2}";
await api.PingAsync(config);
handler.Body = "{\"ok\":true}";
try { await api.PingAsync(config); throw new Exception("liveness accepted as readiness"); } catch (AgentApiException) { }
// Same production delivery code: 500 retains all events; acknowledged rejection drains and archives.
queue.Enqueue(first);
foreach (var status in new[] { HttpStatusCode.InternalServerError, HttpStatusCode.ServiceUnavailable, HttpStatusCode.TooManyRequests, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound, HttpStatusCode.UnprocessableEntity }) {
    handler.Status = status;
    try { await QueueDelivery.Deliver(first, e => api.SendAsync(config,e), (e,r) => { queue.Acknowledge(e,r); return Task.CompletedTask; }); throw new Exception("HTTP failure removed event"); } catch (HttpRequestException) { }
    Check(queue.Load().Count == 2, "failure preserves queue: " + status);
}
handler.Status = HttpStatusCode.OK;
handler.Body = JsonSerializer.Serialize(new { acknowledged = true, eventId = Guid.NewGuid(), result = "counted", reason = "counted" });
try { await QueueDelivery.Deliver(first,e=>api.SendAsync(config,e),(e,r)=>{queue.Acknowledge(e,r);return Task.CompletedTask;}); throw new Exception("wrong event acknowledged"); } catch (HttpRequestException) { }
Check(queue.Load().Count == 2,"unmatched acknowledgement retains pending");
foreach (var item in queue.Load()) {
    handler.Body = JsonSerializer.Serialize(new { eventId = item.EventId, acknowledged = true, result = item == second ? "rejected" : "counted", reason = item == second ? "employee_inactive" : "counted" });
    await QueueDelivery.Deliver(item,e=>api.SendAsync(config,e),(e,r)=>{queue.Acknowledge(e,r);return Task.CompletedTask;});
}
Check(queue.Load().Count == 0 && Directory.GetFiles(Path.Combine(root,"receipts")).Length == 2, "business result retained, queue continues");
foreach (var transition in new[] { ("start", "active"), ("pause", "paused"), ("resume", "active"), ("finish", "none") }) {
    handler.Body = JsonSerializer.Serialize(new { employeeName = "Worker", status = transition.Item2, id = Guid.NewGuid() });
    using (var cancel = new CancellationTokenSource(20)) {
        handler.Delay = true;
        try { await api.ShiftActionAsync(config,transition.Item1,Guid.NewGuid(),cancel.Token); throw new Exception("timeout missing"); } catch (HttpRequestException) { }
    }
    handler.Delay = false;
    Check((await ShiftRecovery.Fetch(()=>api.GetShiftAsync(config))).Status == transition.Item2, "timeout reconciles " + transition.Item1);
}
// Decoder: every terminated scanner packet, including malformed and overflow, produces a result.
using(var raw = new RawInput(false)) {
    var packets = new List<RawScan>(); raw.ScanReceived += packets.Add;
    foreach(var key in new[]{Keys.D1,Keys.D2,Keys.OemQuestion,Keys.D3,Keys.Enter}) raw.ProcessKey("fixture",key);
    Check(packets.Count == 1 && packets[0].Error is not null,"unsupported character is not silently dropped");
    for(var i=0;i<514;i++) raw.ProcessKey("fixture",Keys.D1); raw.ProcessKey("fixture",Keys.Enter);
    Check(packets.Count == 2 && packets[1].Error is not null,"overflow feedback");
    raw.ProcessKey("fixture",Keys.Enter); Check(packets.Count == 3,"empty completion feedback");
    raw.ProcessKey("fixture",Keys.D1); raw.ExpireCaptures(Environment.TickCount64 + 3000);
    Check(packets.Count == 4 && packets[3].Error is not null,"unterminated packet feedback");
}
var machine = new AgentConfig { Fingerprint = fingerprint, ScannerDevice = "saved" };
EmployeeSwitch.Apply(machine, new EmployeeSession { Id = first.EmployeeIdentifier }, 0);
EmployeeSwitch.Apply(machine, new EmployeeSession { Id = second.EmployeeIdentifier }, 0);
try { EmployeeSwitch.Apply(machine,new EmployeeSession { Id = "blocked" },1); throw new Exception("pending switch allowed"); } catch (InvalidOperationException) { }
Check(machine.Fingerprint == fingerprint && machine.ScannerDevice == "saved", "employee switch preserves machine fingerprint");

Exception? uiFailure = null;
var uiThread = new Thread(() => {
 try {
    using var form = new WorkerForm();
    var packet = new RawScan("fixture",8,"12345678",100,10);
    foreach(var rejection in new[]{
        ScanFeedback.Rejection(packet,true,false,false,true),
        ScanFeedback.Rejection(packet,false,true,false,true),
        ScanFeedback.Rejection(packet,false,false,true,true),
        ScanFeedback.Rejection(packet,false,false,false,false),
        ScanFeedback.Rejection(packet with { Barcode="bad" },false,false,false,true),
        ScanFeedback.Rejection(packet with { Error="overflow" },false,false,false,true) }) {
        Check(!string.IsNullOrEmpty(rejection),"each rejected physical packet has feedback"); form.SetNotice(rejection!,true);Check(form.NoticeText==rejection,"feedback reaches UI");
    }
    Check(ScanFeedback.Rejection(packet,false,false,false,true) is null,"valid packet saved path");
    form.SetShift(new ShiftState { Status="active", Id=Guid.NewGuid() });
    form.SetBusy(true); Check(!form.PauseEnabled,"busy disables shift actions");
    form.SetShiftChecking(); form.SetBusy(false); form.UpdateTimer(new ShiftState { Status="active" });
    Check(form.ShiftText=="Проверяем…" && !form.PauseEnabled,"uncertain state survives timer and busy reset");
    form.SetShift(new ShiftState { Status="paused", Id=Guid.NewGuid() });
    Check(!form.PauseEnabled && form.ShiftText.StartsWith("Пауза"),"reconciliation restores appropriate buttons");
    form.SetPending(0);Check(form.PendingText=="Все данные синхронизированы","zero pending synced");
    form.SetPending(2);Check(form.PendingText.Contains("2"),"pending count visible");
    form.SetServerState(ConnectionState.ServerUnavailable);Check(form.PendingText.Contains("2"),"connection cannot overwrite pending");
    foreach(var result in new[]{"counted","duplicate","rejected"}){form.SetScan(new ScanResponse {Result=result,Message="Rejected: shift inactive"});Check(!string.IsNullOrEmpty(form.NoticeText),"business acknowledgement feedback");}
 }catch(Exception ex){uiFailure=ex;}
});uiThread.SetApartmentState(ApartmentState.STA);uiThread.Start();uiThread.Join();if(uiFailure is not null)throw uiFailure;
Console.WriteLine("PASS: production delivery, full child-process restart, readiness/retry, business receipts, timeout reconciliation, raw decoder and UI feedback, employee switch");
File.WriteAllBytes(Path.Combine(root, "pending-scans.dpapi"), [1, 2, 3]);
try { queue.Enqueue(first); throw new Exception("Corrupt queue overwritten"); } catch (System.ComponentModel.Win32Exception) { }
Console.WriteLine("PASS: barcode, HID fingerprint/reconnect/ambiguity, DPAPI, legacy queue migration, restart, identity/timestamp preservation, retryable HTTP failures and 3-second health timeout.");

internal sealed class FakeHttp : HttpMessageHandler
{
    public HttpStatusCode Status = HttpStatusCode.OK;
    public bool Delay;
    public string? LastBody;
    public string Body = "{\"result\":\"counted\",\"success\":true}";
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (Delay) await Task.Delay(Timeout.Infinite, cancellationToken);
        LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        return new(Status) { Content = new StringContent(Body) };
    }
}
namespace ScannerAgent
{
    internal static class Storage { public static string LoadToken() => "test-token"; }
    internal static class AgentLog { public static string Version => "test"; public static void Info(string message) { } }
}
