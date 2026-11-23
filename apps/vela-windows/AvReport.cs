using System.Text.Json;

namespace Vela.Windows;

/// <summary><c>Vela.exe --av-report report.json</c>: what this PC would tell the server and what libmpv
/// was built with, for support and hardware verification. It contains no server, account or media data.</summary>
internal static class AvReport
{
    internal static void Write(string path)
    {
        string dataPath = Environment.GetEnvironmentVariable("VELA_DATA_DIR") is { Length: > 0 } custom ? custom
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vela");
        var settings = PlaybackSettings.Load(dataPath);
        var report = new Dictionary<string, object?>
        {
            ["settings"] = settings,
            ["capabilities"] = Capabilities.Value(settings),
            ["audioEndpoint"] = AudioEndpointInfo.Probe(settings.AudioDevice),
            ["display"] = DisplayMatch.Current(GetDesktopWindow()),
            ["anyHdrDisplay"] = DisplayMatch.AnyHdrDisplay(),
        };
        try
        {
            using var mpv = new Mpv(IntPtr.Zero, new Dictionary<string, string> { ["vo"] = "null", ["ao"] = "null", ["idle"] = "yes" });
            report["libmpv"] = new
            {
                version = mpv.Property("mpv-version"), ffmpeg = mpv.Property("ffmpeg-version"),
                libass = mpv.Property("libass-version"), configuration = mpv.Property("mpv-configuration"),
                audioDevices = mpv.Node("audio-device-list"),
            };
            if (mpv.Node("audio-device-list") is JsonElement devices)
                report["endpoints"] = devices.EnumerateArray().Select(d => d.GetProperty("name").GetString()!)
                    .Where(name => name.StartsWith("wasapi/", StringComparison.Ordinal))
                    .ToDictionary(name => name, name => AudioEndpointInfo.Probe(name));
        }
        catch (Exception error) { report["libmpv"] = new { error = error.GetType().Name }; }
        File.WriteAllText(path, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern IntPtr GetDesktopWindow();
}
