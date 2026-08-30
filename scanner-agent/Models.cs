using System.Text.Json.Serialization;

namespace ScannerAgent;

internal sealed class AgentConfig
{
    public string BackendUrl { get; set; } = "";
    public string EmployeeIdentifier { get; set; } = "";
    public string ScannerDevice { get; set; } = "";
}

internal sealed record ScanEvent(
    [property: JsonPropertyName("event_id")] Guid EventId,
    [property: JsonPropertyName("barcode")] string Barcode,
    [property: JsonPropertyName("employee_identifier")] string EmployeeIdentifier,
    [property: JsonPropertyName("duration_ms")] int DurationMs,
    [property: JsonPropertyName("average_interval_ms")] double AverageIntervalMs,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("scanner_device")] string ScannerDevice,
    [property: JsonPropertyName("timestamp")] DateTimeOffset Timestamp);

internal sealed class ScanResponse
{
    public bool Success { get; set; }
    public string Result { get; set; } = "rejected";
    public int OrdersToday { get; set; }
    public decimal EarningsToday { get; set; }
    public string Message { get; set; } = "";
}
