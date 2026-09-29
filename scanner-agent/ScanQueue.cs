using System.Text.Json;

namespace ScannerAgent;

internal sealed class ScanQueue(string folder)
{
    private readonly object _sync = new();
    private readonly string _path = Path.Combine(folder, "pending-scans.dpapi");
    private readonly string _legacy = Path.Combine(folder, "pending-scans.json");
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public List<ScanEvent> Load() { lock (_sync) return Read(); }
    public void Enqueue(ScanEvent item) { lock (_sync) { var queue = Read(); if (queue.All(e => e.EventId != item.EventId)) queue.Add(item); Write(queue); } }
    public void Remove(Guid eventId) { lock (_sync) { var queue = Read(); queue.RemoveAll(e => e.EventId == eventId); Write(queue); } }
    public void Acknowledge(ScanEvent item, ScanResponse response) {
        if (!response.Acknowledged || response.EventId != item.EventId || response.Result is not ("counted" or "duplicate" or "rejected") || string.IsNullOrEmpty(response.Reason)) throw new HttpRequestException("Invalid event acknowledgement");
        lock (_sync) {
            var receipts = Path.Combine(folder, "receipts"); Directory.CreateDirectory(receipts);
            var target = Path.Combine(receipts, item.EventId + ".dpapi");
            var bytes = WindowsSecret.Protect(JsonSerializer.SerializeToUtf8Bytes(new { item, response, acknowledgedAt = DateTimeOffset.UtcNow }), false);
            using (var file = new FileStream(target + ".tmp", FileMode.Create, FileAccess.Write, FileShare.None)) { file.Write(bytes); file.Flush(true); }
            File.Move(target + ".tmp", target, true);
            Remove(item.EventId);
        }
    }
    private List<ScanEvent> Read()
    {
        if (File.Exists(_path)) return JsonSerializer.Deserialize<List<ScanEvent>>(WindowsSecret.Unprotect(File.ReadAllBytes(_path)), Json) ?? throw new InvalidDataException("Queue is corrupt");
        if (!File.Exists(_legacy)) return [];
        var queue = JsonSerializer.Deserialize<List<ScanEvent>>(File.ReadAllBytes(_legacy), Json) ?? throw new InvalidDataException("Legacy queue is corrupt");
        Write(queue); File.Delete(_legacy); return queue;
    }
    private void Write(List<ScanEvent> queue)
    {
        Directory.CreateDirectory(folder);
        var bytes = WindowsSecret.Protect(JsonSerializer.SerializeToUtf8Bytes(queue, Json), false);
        using (var file = new FileStream(_path + ".tmp", FileMode.Create, FileAccess.Write, FileShare.None)) { file.Write(bytes); file.Flush(true); }
        File.Move(_path + ".tmp", _path, true);
    }
}
