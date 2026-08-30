using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace ScannerAgent;

internal sealed class AgentApiException(string message, System.Net.HttpStatusCode statusCode) : HttpRequestException(message, null, statusCode);

internal sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };
    public Task<ScanResponse> SendAsync(AgentConfig config, ScanEvent item, CancellationToken ct = default) => Send<ScanResponse>(config, HttpMethod.Post, "api/scanner-agent/scan", item, allowErrorResponse: true, ct);
    public Task<ShiftState> GetShiftAsync(AgentConfig config, CancellationToken ct = default) => Send<ShiftState>(config, HttpMethod.Get, $"api/scanner-agent/shift?employee_identifier={Uri.EscapeDataString(config.EmployeeIdentifier)}", null, false, ct);
    public async Task<ShiftState> ShiftActionAsync(AgentConfig config, string action, CancellationToken ct = default)
    {
        var state = await Send<ShiftState>(config, HttpMethod.Post, "api/scanner-agent/shift", new { employee_identifier = config.EmployeeIdentifier, action }, false, ct);
        if (action == "start" && (state.Id is null || state.Status != "active")) throw new AgentApiException("Backend не вернул активную смену после запуска.", System.Net.HttpStatusCode.BadGateway);
        return state;
    }

    private async Task<T> Send<T>(AgentConfig config, HttpMethod method, string path, object? body, bool allowErrorResponse, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, new Uri(new Uri(config.BackendUrl.TrimEnd('/') + "/"), path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Storage.LoadToken());
        if (body is not null) request.Content = JsonContent.Create(body);
        using var response = await _http.SendAsync(request, ct);
        var responseBody = await response.Content.ReadAsStringAsync(ct);
        Debug.WriteLine($"[ScannerAgent HTTP] {method} {request.RequestUri} -> {(int)response.StatusCode} {response.StatusCode}; body={responseBody}");
        if (!response.IsSuccessStatusCode && !allowErrorResponse)
        {
            var message = TryMessage(responseBody) ?? $"Backend вернул HTTP {(int)response.StatusCode}";
            throw new AgentApiException(message, response.StatusCode);
        }
        T? result;
        try { result = JsonSerializer.Deserialize<T>(responseBody, Json); }
        catch (JsonException ex) { throw new HttpRequestException("Backend вернул некорректный JSON.", ex, response.StatusCode); }
        if (result is null) throw new HttpRequestException("Backend вернул пустой ответ.", null, response.StatusCode);
        return result;
    }
    private static string? TryMessage(string body)
    {
        try { using var json = JsonDocument.Parse(body); return json.RootElement.TryGetProperty("message", out var value) ? value.GetString() : null; }
        catch (JsonException) { return null; }
    }
    public void Dispose() => _http.Dispose();
}
