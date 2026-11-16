namespace Vela.Windows;

internal sealed class ServerDialog : Form
{
    private readonly TextBox address = new() { Dock = DockStyle.Top, PlaceholderText = "https://your-ether-server" };
    internal string Address => address.Text;

    internal ServerDialog()
    {
        Text = "Connect Vela to Ether";
        ClientSize = new Size(480, 160);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        Padding = new Padding(20);
        var description = new Label { Text = "Enter your Ether server address. Sign in on the next screen.",
            Dock = DockStyle.Top, Height = 40 };
        var connect = new Button { Text = "Connect", Dock = DockStyle.Bottom, DialogResult = DialogResult.OK };
        Controls.Add(address);
        Controls.Add(description);
        Controls.Add(connect);
        AcceptButton = connect;
    }
}
