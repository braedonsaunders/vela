using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Vela.Windows;

internal sealed class MainWindow : Form
{
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    // libmpv draws here, behind the transparent WebView, so the page's player chrome lies over the picture.
    private readonly Panel video = new() { Dock = DockStyle.Fill, BackColor = Color.Black, Visible = false };
    private readonly Label status = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 250 };
    private readonly string settingsPath;
    private readonly string windowPath;
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
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = Color.FromArgb(9, 11, 14);
        ForeColor = Color.White;
        MinimumSize = new Size(960, 600);
        // VELA_DATA_DIR keeps a second copy (a test run) apart from the installed app's server,
        // window placement and WebView profile.
        string data = Environment.GetEnvironmentVariable("VELA_DATA_DIR") is { Length: > 0 } custom ? custom
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vela");
        settingsPath = Path.Combine(data, "server.txt");
        windowPath = Path.Combine(Path.GetDirectoryName(settingsPath)!, "window.txt");
        PlaceWindow();
        Controls.Add(browser);
        Controls.Add(video);
        Controls.Add(status);
        status.Text = "Starting Vela…";
        timer.Tick += (_, _) => playback?.Tick();
        Shown += async (_, _) => await InitializeAsync();
        FormClosing += (_, _) => SaveWindow();
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
            browser.DefaultBackgroundColor = Color.Transparent;
            browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            browser.CoreWebView2.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("VELA_DEVTOOLS") == "1";
            // An app, not a browser tab: no page zoom, reload or find keys, swipe history or form autofill.
            browser.CoreWebView2.Settings.IsZoomControlEnabled = false;
            browser.CoreWebView2.Settings.IsPinchZoomEnabled = false;
            browser.CoreWebView2.Settings.IsSwipeNavigationEnabled = false;
            browser.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            browser.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
            browser.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
            browser.CoreWebView2.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            browser.CoreWebView2.NewWindowRequested += (_, e) => e.Handled = true;
            browser.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Trusted(e.Uri)) e.Cancel = true;
            };
            browser.CoreWebView2.WebMessageReceived += Receive;
            browser.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            browser.CoreWebView2.WebResourceRequested += (_, e) => BundledUi.Serve(environment, server, e);
            browser.CoreWebView2.ContainsFullScreenElementChanged += (_, _) =>
                SetFullscreen(browser.CoreWebView2.ContainsFullScreenElement);
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
            await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(WindowKeys);
            browser.Source = server;
            timer.Start();
        }
        catch (Exception error)
        {
            ShowError($"Could not start Vela ({error.GetType().Name}). Check that WebView2 is installed.");
        }
    }

    // A dark title bar in Vela's page colour (Windows 10 20H1 and later; caption colours on Windows 11).
    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int on = 1, caption = 0x000E0B09, text = 0x00E9F1F5;
        DwmSetWindowAttribute(Handle, 20, ref on, sizeof(int));
        DwmSetWindowAttribute(Handle, 35, ref caption, sizeof(int));
        DwmSetWindowAttribute(Handle, 36, ref text, sizeof(int));
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    /// <summary>The last window placement, or one that fits the screen's height at 16:10.</summary>
    private void PlaceWindow()
    {
        StartPosition = FormStartPosition.Manual;
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        try
        {
            var parts = File.ReadAllText(windowPath).Split(',').Select(int.Parse).ToArray();
            var saved = new Rectangle(parts[0], parts[1], parts[2], parts[3]);
            if (parts.Length == 5 && Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(saved)))
            {
                Bounds = saved;
                if (parts[4] == 1) WindowState = FormWindowState.Maximized;
                return;
            }
        }
        catch (Exception) { }
        int height = Math.Max(MinimumSize.Height, (int)(area.Height * 0.9));
        int width = Math.Min((int)(area.Width * 0.9), height * 16 / 10);
        Bounds = new Rectangle(area.X + (area.Width - width) / 2, area.Y + (area.Height - height) / 2, width, height);
    }

    private void SaveWindow()
    {
        var state = fullscreen ? previousState : WindowState;
        var bounds = fullscreen ? previousBounds : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(windowPath)!);
            File.WriteAllText(windowPath, string.Join(',', bounds.X, bounds.Y, bounds.Width, bounds.Height,
                state == FormWindowState.Maximized ? 1 : 0));
        }
        catch (IOException) { }
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
            if (kind == "window-key")
            {
                SetFullscreen(TextOf(message, "key") == "F11" && !fullscreen);
                return;
            }
            if (kind == "capabilities")
            {
                Post(new { kind, requestId = TextOf(message, "requestId"), value = Capabilities.Value });
                return;
            }
            if (kind == "media-access")
            {
                string? origin = TextOf(message, "origin");
                // The selected server may be Ether or one added in the app's server switcher (Jellyfin,
                // Emby, Plex); the message comes from the bundled page, so any web origin is accepted.
                if (origin != null && !(Uri.TryCreate(origin, UriKind.Absolute, out var media)
                    && media.Scheme is ("http" or "https") && media.UserInfo.Length == 0))
                    throw new InvalidOperationException("Invalid media origin");
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
                video.Visible = true;
                browser.BringToFront();
                playback = new Playback(video.Handle, Emit);
                playback.SetAccess(mediaOrigin, mediaPrefix, mediaHeaders);
            }
            if (id != playerId || playback == null) return;
            playback.Update(message.GetProperty("props"));
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
        Post(new { kind = "event", id = playerId, @event = kind, value });
    }

    private void Post(object value)
    {
        if (browser.CoreWebView2 != null && Trusted(browser.Source?.ToString() ?? ""))
            browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(value));
    }

    private void DisposePlayback()
    {
        playback?.Dispose();
        playback = null;
        playerId = "";
        video.Visible = false;
    }

    // F11 fills the screen anywhere in the app; Escape leaves it before the page sees it. Fullscreen
    // the page asked for (the player's button or F) is left through the page so it hears the change.
    private const string WindowKeys = """
        if (window === window.top && window.chrome && window.chrome.webview) {
          let full = false;
          window.chrome.webview.addEventListener('message', e => {
            if (e.data && e.data.kind === 'window-fullscreen') full = e.data.value === true;
          });
          window.addEventListener('keydown', e => {
            if (e.key !== 'F11' && !(e.key === 'Escape' && (full || document.fullscreenElement))) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.repeat) return;
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else window.chrome.webview.postMessage({ kind: 'window-key', key: e.key });
          }, true);
        }
        """;

    private void SetFullscreen(bool on)
    {
        if (on == fullscreen) return;
        if (on)
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
        fullscreen = on;
        Post(new { kind = "window-fullscreen", value = on });
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
