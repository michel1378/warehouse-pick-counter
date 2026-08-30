using System.Text.Json.Serialization;

namespace ScannerAgent;

internal sealed class AgentConfig
{
    public string BackendUrl { get; set; } = "";
    public string EmployeeIdentifier { get; set; } = "";
    public string ScannerDevice { get; set; } = "";
    public bool IsComplete => Uri.TryCreate(BackendUrl, UriKind.Absolute, out _) && !string.IsNullOrWhiteSpace(EmployeeIdentifier) && !string.IsNullOrWhiteSpace(ScannerDevice);
}

internal sealed record ScanEvent(
    [property: JsonPropertyName("event_id")] Guid EventId,
    [property: JsonPropertyName("barcode")] string Barcode,
    [property: JsonPropertyName("employee_identifier")] string EmployeeIdentifier,
    [property: JsonPropertyName("duration_ms")] int DurationMs,
    [property: JsonPropertyName("average_interval_ms")] double AverageIntervalMs,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("scanner_device")] string ScannerDevice,
    [property: JsonPropertyName("timestamp")] DateTimeOffset Timestamp,
    [property: JsonPropertyName("shift_id")] Guid? ShiftId);

internal sealed class ScanResponse
{
    public bool Success { get; set; }
    public string Result { get; set; } = "rejected";
    public int OrdersToday { get; set; }
    public decimal EarningsToday { get; set; }
    public string Message { get; set; } = "";
    public double? LastIntervalSeconds { get; set; }
    public double? MedianIntervalSeconds { get; set; }
    public int IntervalCount { get; set; }
}

internal sealed class ShiftState
{
    public Guid? Id { get; set; }
    public string EmployeeName { get; set; } = "—";
    public string Status { get; set; } = "none";
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public DateTimeOffset? PauseStartedAt { get; set; }
    public long ActiveSeconds { get; set; }
    public long TotalSeconds { get; set; }
    public long PauseSeconds { get; set; }
    public int PauseCount { get; set; }
    public int Orders { get; set; }
    public decimal Earnings { get; set; }
    public double? MedianIntervalSeconds { get; set; }
    public int IntervalCount { get; set; }
}
