namespace Vela.Windows;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--av-report") { AvReport.Write(args[1]); return; }
        ApplicationConfiguration.Initialize();
        try
        {
            Application.Run(new MainWindow());
        }
        catch (Exception error)
        {
            MessageBox.Show($"Vela could not start. {error.GetType().Name}", "Vela",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
