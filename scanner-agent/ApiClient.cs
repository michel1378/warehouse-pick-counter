using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace ScannerAgent;

internal sealed class AgentApiException(string message, System.Net.HttpStatusCode statusCode, string? code = null) : HttpRequestException(message, null, statusCode) { public string? Code { get; } = code; }

internal sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    public ApiClient(HttpMessageHandler? handler = null) { _http = handler is null ? new HttpClient(new SocketsHttpHandler { ConnectTimeout = TimeSpan.FromSeconds(3), PooledConnectionLifetime = TimeSpan.FromMinutes(5) }) : new HttpClient(handler); _http.Timeout = TimeSpan.FromSeconds(10); }
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };
    public Task<EmployeeSession> ResolveEmployeeAsync(AgentConfig config, string pin, CancellationToken ct = default) => Send<EmployeeSession>(config, HttpMethod.Post, "api/scanner-agent/employee", new { pin }, false, ct);
    public async Task PingAsync(AgentConfig config, CancellationToken ct = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        var ready = await Send<ReadinessResponse>(config, HttpMethod.Get, "api/scanner-agent/scan?readiness=1", null, false, timeout.Token);
        if (!ready.Ready || !ready.ScanReady || ready.Version != 2)
            throw new AgentApiException("Backend readiness/schema mismatch", System.Net.HttpStatusCode.ServiceUnavailable, "schema_mismatch");
    }
    public Task<ScanResponse> SendAsync(AgentConfig config, ScanEvent item, CancellationToken ct = default) => Send<ScanResponse>(config, HttpMethod.Post, "api/scanner-agent/scan", item, allowErrorResponse: false, ct);
    public Task<ShiftState> GetShiftAsync(AgentConfig config, CancellationToken ct = default) => Send<ShiftState>(config, HttpMethod.Get, $"api/scanner-agent/shift?employee_identifier={Uri.EscapeDataString(config.EmployeeIdentifier)}", null, false, ct);
    public async Task<ShiftState> ShiftActionAsync(AgentConfig config, string action, Guid? shiftId = null, CancellationToken ct = default)
    {
        var state = await Send<ShiftState>(config, HttpMethod.Post, "api/scanner-agent/shift", new { employee_identifier = config.EmployeeIdentifier, action, operation_id = Guid.NewGuid(), shift_id = action == "start" ? null : shiftId }, false, ct);
        if (action == "start" && (state.Id is null || state.Status is not ("active" or "paused"))) throw new AgentApiException("Backend не вернул активную смену после запуска.", System.Net.HttpStatusCode.BadGateway);
        return state;
    }

    private async Task<T> Send<T>(AgentConfig config, HttpMethod method, string path, object? body, bool allowErrorResponse, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, new Uri(new Uri(config.BackendUrl.TrimEnd('/') + "/"), path));
        var requestId = Guid.NewGuid();
        request.Headers.Add("x-request-id", requestId.ToString());
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await Task.Run(Storage.LoadToken, ct));
        if (body is not null) request.Content = JsonContent.Create(body);
        var timer = Stopwatch.StartNew();
        HttpResponseMessage response;
        try { response = await _http.SendAsync(request, ct); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { AgentLog.Info($"request_id={requestId} endpoint={request.RequestUri?.AbsolutePath} result=network_timeout latency_ms={timer.ElapsedMilliseconds}"); throw new HttpRequestException("Нет ответа от сервера", ex); }
        using (response)
        {
        var responseBody = await response.Content.ReadAsStringAsync(ct);
        AgentLog.Info($"request_id={requestId} endpoint={request.RequestUri?.AbsolutePath} http_status={(int)response.StatusCode} latency_ms={timer.ElapsedMilliseconds}");
        // Retry transport, authorization and rate-limit failures; never silently remove them from the queue.
        if (!response.IsSuccessStatusCode && (!allowErrorResponse || response.StatusCode != System.Net.HttpStatusCode.BadRequest))
        {
            var message = TryMessage(responseBody) ?? $"Backend вернул HTTP {(int)response.StatusCode}";
            throw new AgentApiException(message, response.StatusCode, TryCode(responseBody));
        }
        T? result;
        try { result = JsonSerializer.Deserialize<T>(responseBody, Json); }
        catch (JsonException ex) { throw new HttpRequestException("Backend вернул некорректный JSON.", ex, response.StatusCode); }
        if (result is null) throw new HttpRequestException("Backend вернул пустой ответ.", null, response.StatusCode);
        return result;
        }
    }
    private static string? TryCode(string body) { try { using var json = JsonDocument.Parse(body); return json.RootElement.TryGetProperty("code", out var value) ? value.GetString() : null; } catch (JsonException) { return null; } }
    private static string? TryMessage(string body)
    {
        try { using var json = JsonDocument.Parse(body); return json.RootElement.TryGetProperty("message", out var value) ? value.GetString() : null; }
        catch (JsonException) { return null; }
    }
    public void Dispose() => _http.Dispose();
}
