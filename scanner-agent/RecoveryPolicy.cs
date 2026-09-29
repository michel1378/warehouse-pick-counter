namespace ScannerAgent;
internal sealed class RecoveryPolicy
{
    private int _attempt;
    public bool EverReady { get; private set; }
    public void Ready() { EverReady = true; _attempt = 0; }
    public int Attempt => _attempt;
    public static bool Configuration(HttpRequestException ex) => ex.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.UnprocessableEntity || ex is AgentApiException { Code: "schema_mismatch" };
    public int Fail(HttpRequestException ex) => Configuration(ex) ? 60 : new[] { 1, 2, 5, 10, 15 }[Math.Min(_attempt++, 4)];
}
internal static class QueueDelivery
{
    public static async Task Deliver(ScanEvent item, Func<ScanEvent,Task<ScanResponse>> send, Func<ScanEvent,ScanResponse,Task> acknowledge) {
        var response = await send(item);
        if (!response.Acknowledged || response.EventId != item.EventId || response.Result is not ("counted" or "duplicate" or "rejected") || string.IsNullOrEmpty(response.Reason)) throw new HttpRequestException("Некорректное подтверждение скана");
        await acknowledge(item, response);
    }
}

internal static class ShiftRecovery
{
    public static async Task<ShiftState> Fetch(Func<Task<ShiftState>> fetch) {
        var state = await fetch();
        if (state.Status is not ("none" or "active" or "paused" or "finished") || (state.Status is "active" or "paused" && state.Id is null)) throw new HttpRequestException("Invalid shift state");
        return state;
    }
}

internal static class ScanFeedback
{
    public static string? Rejection(RawScan scan, bool dialogOpen, bool uncertain, bool busy, bool active) {
        if (scan.Error is not null) return "Ошибка сканера: " + scan.Error;
        if (dialogOpen) return "Отклонён: закройте окно входа/настроек";
        if (BarcodePolicy.Type(scan.Barcode) == "invalid") return "Отклонён: недопустимый формат штрихкода";
        if (uncertain) return "Отклонён: состояние смены проверяется. Повторите после восстановления связи";
        if (scan.RawCharCount < 2 || scan.ElapsedMs > 1500 || scan.AverageIntervalMs > 50) return "Отклонён: ручной ввод";
        if (busy || !active) return "Отклонён: сначала начните или продолжите смену";
        return null;
    }
}
internal static class EmployeeSwitch
{
    public static ShiftState Apply(AgentConfig machine, EmployeeSession employee, int pending) {
        if (pending != 0) throw new InvalidOperationException("Pending scans must synchronize before employee change");
        machine.EmployeeIdentifier = employee.Id;
        return new ShiftState { EmployeeName = employee.Name };
    }
}
