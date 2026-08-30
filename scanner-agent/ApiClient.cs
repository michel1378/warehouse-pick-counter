using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace ScannerAgent;

internal sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    public Task<ScanResponse> SendAsync(AgentConfig config, ScanEvent item, CancellationToken ct = default) => Send<ScanResponse>(config, HttpMethod.Post, "api/scanner-agent/scan", item, ct);
    public Task<ShiftState> GetShiftAsync(AgentConfig config, CancellationToken ct = default) => Send<ShiftState>(config, HttpMethod.Get, $"api/scanner-agent/shift?employee_identifier={Uri.EscapeDataString(config.EmployeeIdentifier)}", null, ct);
    public Task<ShiftState> ShiftActionAsync(AgentConfig config, string action, CancellationToken ct = default) => Send<ShiftState>(config, HttpMethod.Post, "api/scanner-agent/shift", new { employee_identifier = config.EmployeeIdentifier, action }, ct);

    private async Task<T> Send<T>(AgentConfig config, HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, new Uri(new Uri(config.BackendUrl.TrimEnd('/') + "/"), path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Storage.LoadToken());
        if (body is not null) request.Content = JsonContent.Create(body);
        using var response = await _http.SendAsync(request, ct);
        var result = await response.Content.ReadFromJsonAsync<T>(cancellationToken: ct);
        if (result is null) throw new HttpRequestException("Сервер вернул пустой ответ.");
        if (!response.IsSuccessStatusCode && response.StatusCode is not System.Net.HttpStatusCode.BadRequest and not System.Net.HttpStatusCode.Forbidden) throw new HttpRequestException($"HTTP {(int)response.StatusCode}");
        return result;
    }
    public void Dispose() => _http.Dispose();
}
