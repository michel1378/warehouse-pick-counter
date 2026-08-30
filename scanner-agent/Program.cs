namespace ScannerAgent;

internal static class Program
{
    internal const string MutexName = "WarehouseScannerAgent.SingleInstance";
    internal const string ActivateEventName = "WarehouseScannerAgent.Activate";
    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var first);
        if (!first)
        {
            try { EventWaitHandle.OpenExisting(ActivateEventName).Set(); } catch { }
            MessageBox.Show("Складской scanner-agent уже запущен", "ScannerAgent", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new AgentContext());
    }
}
