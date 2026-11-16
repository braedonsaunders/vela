using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Vela.Windows;

internal sealed class MainWindow : Form
{
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly PlayerPanel player = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly Label status = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 250 };
    private readonly string settingsPath;
    private Uri? server;
    private Playback? playback;
    private string playerId = "";
    private string? mediaOrigin;
    private string? mediaPrefix;
    private Dictionary<string, string> mediaHeaders = new();
    private bool fullscreen;
    private Rectangle previousBounds;
    private FormWindowState previousState;
    private readonly string? requestedAddress;

    internal MainWindow(string? address)
    {
        requestedAddress = address;
        Text = "Vela";
        BackColor = Color.FromArgb(9, 11, 14);
        ForeColor = Color.White;
        Size = new Size(1280, 800);
        MinimumSize = new Size(1080, 650);
        StartPosition = FormStartPosition.CenterScreen;
        settingsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Vela", "server.txt");
        Controls.Add(browser);
        Controls.Add(player);
        Controls.Add(status);
        status.Text = "Starting Vela…";
        player.BackRequested += ClosePlayback;
        player.FullscreenRequested += ToggleFullscreen;
        player.CommandRequested += (kind, value) => playback?.LocalCommand(kind, value);
        timer.Tick += (_, _) => playback?.Tick();
        Shown += async (_, _) => await InitializeAsync();
        FormClosed += (_, _) =>
        {
            timer.Stop();
            timer.Dispose();
            playback?.Dispose();
            browser.Dispose();
            mediaHeaders.Clear();
        };
    }

    private async Task InitializeAsync()
    {
        try
        {
            string address = requestedAddress ?? (File.Exists(settingsPath) ? File.ReadAllText(settingsPath) : "");
            if (!TryAddress(address, out server))
            {
                using var setup = new ServerDialog();
                if (setup.ShowDialog(this) != DialogResult.OK) { Close(); return; }
                if (!TryAddress(setup.Address, out server)) throw new InvalidOperationException("Invalid server");
            }
            Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
            File.WriteAllText(settingsPath, server!.ToString());
            var profile = Path.Combine(Path.GetDirectoryName(settingsPath)!, "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await browser.EnsureCoreWebView2Async(environment);
            browser.DefaultBackgroundColor = BackColor;
            browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            browser.CoreWebView2.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("VELA_DEVTOOLS") == "1";
            browser.CoreWebView2.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            browser.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
            browser.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Trusted(e.Uri)) e.Cancel = true;
            };
            browser.CoreWebView2.WebMessageReceived += Receive;
            browser.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            browser.CoreWebView2.WebResourceRequested += (_, e) => BundledUi.Serve(environment, server, e);
            browser.CoreWebView2.ProcessFailed += (_, _) => ShowError("The app stopped. Close and reopen Vela.");
            browser.CoreWebView2.NavigationCompleted += (_, e) =>
            {
                if (!e.IsSuccess) ShowError("Could not connect to your Ether server. Check its address and connection.");
                else status.Visible = false;
            };
            string origin = JsonSerializer.Serialize(server.GetLeftPart(UriPartial.Authority));
            await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                $"if (window === window.top && location.origin === {origin} && " +
                "(location.pathname === '/vela' || location.pathname.startsWith('/vela/'))) { " +
                "Object.defineProperty(window, '__VELA_WINDOWS__', { value: Object.freeze({version:1}) }); }");
            browser.Source = server;
            timer.Start();
        }
        catch (Exception error)
        {
            ShowError($"Could not start Vela ({error.GetType().Name}). Check that WebView2 is installed.");
        }
    }

    private static bool TryAddress(string address, out Uri? uri)
    {
        uri = null;
        if (!Uri.TryCreate(address.Trim(), UriKind.Absolute, out var parsed)
            || parsed.Scheme is not ("http" or "https") || parsed.UserInfo.Length != 0
            || parsed.Query.Length != 0 || parsed.Fragment.Length != 0) return false;
        uri = new Uri(parsed.GetLeftPart(UriPartial.Authority) + "/vela/");
        return true;
    }

    private bool Trusted(string address) => server != null && Uri.TryCreate(address, UriKind.Absolute, out var target)
        && target.GetLeftPart(UriPartial.Authority) == server.GetLeftPart(UriPartial.Authority)
        && (target.AbsolutePath == "/vela" || target.AbsolutePath.StartsWith("/vela/", StringComparison.Ordinal));

    private void Receive(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Trusted(e.Source)) return;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var message = document.RootElement;
            string? kind = TextOf(message, "kind");
            if (kind == "capabilities")
            {
                Post(new { kind, requestId = TextOf(message, "requestId"), value = Capabilities.Value });
                return;
            }
            if (kind == "media-access")
            {
                string? origin = TextOf(message, "origin");
                if (origin != null && (server == null || new Uri(origin).GetLeftPart(UriPartial.Authority)
                    != server.GetLeftPart(UriPartial.Authority))) throw new InvalidOperationException("Untrusted media origin");
                mediaOrigin = origin;
                mediaPrefix = TextOf(message, "pathPrefix");
                mediaHeaders = message.TryGetProperty("headers", out var headers)
                    ? JsonSerializer.Deserialize<Dictionary<string, string>>(headers.GetRawText()) ?? new() : new();
                playback?.SetAccess(mediaOrigin, mediaPrefix, mediaHeaders);
                return;
            }
            string? id = TextOf(message, "id");
            if (kind == "dispose" && id == playerId)
            {
                DisposePlayback();
                return;
            }
            if (kind is not ("mount" or "update") || string.IsNullOrEmpty(id)) return;
            if (kind == "mount")
            {
                DisposePlayback();
                playerId = id;
                player.Visible = true;
                player.BringToFront();
                playback = new Playback(player.VideoHandle, Emit);
                playback.SetAccess(mediaOrigin, mediaPrefix, mediaHeaders);
            }
            if (id != playerId || playback == null) return;
            var props = message.GetProperty("props");
            if (props.TryGetProperty("metadata", out var metadata))
                player.SetMetadata(TextOf(metadata, "title") ?? "Now playing");
            if (props.TryGetProperty("plan", out var plan) && plan.ValueKind == JsonValueKind.Object)
                player.SetPlan(plan);
            playback.Update(props);
        }
        catch (Exception error)
        {
            Emit("error", new { kind = "source", message = $"Native player could not start ({error.GetType().Name}).",
                recoverable = false });
        }
    }

    private void Emit(string kind, object value)
    {
        if (IsDisposed) return;
        if (kind == "snapshot") player.UpdateState(JsonSerializer.SerializeToElement(value));
        Post(new { kind = "event", id = playerId, @event = kind, value });
    }

    private void Post(object value)
    {
        if (browser.CoreWebView2 != null && Trusted(browser.Source?.ToString() ?? ""))
            browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(value));
    }

    private void ClosePlayback()
    {
        playback?.Stop();
        Emit("close", new { });
        DisposePlayback();
    }

    private void DisposePlayback()
    {
        playback?.Dispose();
        playback = null;
        playerId = "";
        player.Visible = false;
        browser.BringToFront();
        if (fullscreen) ToggleFullscreen();
    }

    private void ToggleFullscreen()
    {
        if (!fullscreen)
        {
            previousBounds = Bounds;
            previousState = WindowState;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = Screen.FromControl(this).Bounds;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = previousBounds;
            WindowState = previousState;
        }
        fullscreen = !fullscreen;
    }

    private void ShowError(string message)
    {
        status.Text = message;
        status.Visible = true;
        status.BringToFront();
    }

    private static string? TextOf(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
