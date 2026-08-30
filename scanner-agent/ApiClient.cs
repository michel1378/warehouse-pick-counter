using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace ScannerAgent;

internal sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    public async Task<ScanResponse> SendAsync(AgentConfig config, ScanEvent item, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(config.BackendUrl.TrimEnd('/') + "/"), "api/scanner-agent/scan"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Storage.LoadToken());
        request.Content = JsonContent.Create(item);
        using var response = await _http.SendAsync(request, ct);
        var result = await response.Content.ReadFromJsonAsync<ScanResponse>(cancellationToken: ct);
        if (result is null) throw new HttpRequestException("Сервер вернул пустой ответ.");
        if (!response.IsSuccessStatusCode && response.StatusCode != System.Net.HttpStatusCode.BadRequest && response.StatusCode != System.Net.HttpStatusCode.Forbidden)
            throw new HttpRequestException($"HTTP {(int)response.StatusCode}");
        return result;
    }
    public void Dispose() => _http.Dispose();
}
