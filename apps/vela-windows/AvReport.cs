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

    /// <summary><c>Vela.exe --av-play media report.json</c>: plays a local file or URL for ten seconds with
    /// the app's own player settings in mpv's own window, then records what mpv chose (decoder, output
    /// range, passthrough or PCM, exclusive), the same facts the info card shows.</summary>
    internal static void Play(string media, string path)
    {
        string dataPath = Environment.GetEnvironmentVariable("VELA_DATA_DIR") is { Length: > 0 } custom ? custom
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vela");
        var settings = PlaybackSettings.Load(dataPath);
        var endpoint = AudioEndpointInfo.Probe(settings.AudioDevice);
        var options = Playback.Options(settings, endpoint).ToList();
        using var mpv = new Mpv(IntPtr.Zero, options);
        mpv.TrySet("log-file", path + ".log");
        mpv.Command("loadfile", media, "replace");
        var samples = new List<object?>();
        for (int i = 0; i < 20; i++)
        {
            Thread.Sleep(500);
            if (i % 4 != 3) continue;
            samples.Add(new Dictionary<string, object?>
            {
                ["time-pos"] = mpv.Property("time-pos"), ["videoTrack"] = mpv.Node("current-tracks/video"),
                ["audioTrack"] = mpv.Node("current-tracks/audio"), ["video-params"] = mpv.Node("video-params"),
                ["video-target-params"] = mpv.Node("video-target-params"), ["audio-params"] = mpv.Node("audio-params"),
                ["audio-out-params"] = mpv.Node("audio-out-params"), ["hwdec-current"] = mpv.Property("hwdec-current"),
                ["current-vo"] = mpv.Property("current-vo"), ["current-ao"] = mpv.Property("current-ao"),
                ["container-fps"] = mpv.Property("container-fps"), ["frame-drop-count"] = mpv.Property("frame-drop-count"),
            });
        }
        File.WriteAllText(path, JsonSerializer.Serialize(new { options, skipped = mpv.Skipped, endpoint, samples },
            new JsonSerializerOptions { WriteIndented = true }));
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern IntPtr GetDesktopWindow();
}
