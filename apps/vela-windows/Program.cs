namespace Vela.Windows;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
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
