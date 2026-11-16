namespace Vela.Windows;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        try
        {
            string? address = args.FirstOrDefault(arg => arg.StartsWith("--server="))?[9..];
            Application.Run(new MainWindow(address));
        }
        catch (Exception error)
        {
            MessageBox.Show($"Vela could not start. {error.GetType().Name}", "Vela",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
