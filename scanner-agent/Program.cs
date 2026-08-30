namespace ScannerAgent;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, "WarehouseScannerAgent.SingleInstance", out var first);
        if (!first) { MessageBox.Show("Складской scanner-agent уже запущен."); return; }
        ApplicationConfiguration.Initialize();
        Application.Run(new AgentContext());
    }
}
