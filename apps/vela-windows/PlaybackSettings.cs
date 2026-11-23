using System.Text.Json;

namespace Vela.Windows;

/// <summary>Output preferences for the native player, read from playback.json in the data folder
/// (beside window.txt). Every field is optional; a missing or unreadable file means the defaults.</summary>
internal sealed record PlaybackSettings
{
    /// <summary>Bitstreams to send to the receiver: "auto" (what the endpoint accepts), "off", or a list
    /// of ac3, eac3, dts, dts-hd, truehd. Only formats the endpoint accepts are ever attempted.</summary>
    public JsonElement? Passthrough { get; init; }
    /// <summary>WASAPI exclusive mode for PCM: bit-perfect at the source's own rate, no system mixer,
    /// other apps silent while playing. Passthrough is always exclusive.</summary>
    public bool Exclusive { get; init; }
    /// <summary>Switch the display to the film's frame rate (23.976 stays 23.976) while fullscreen.</summary>
    public bool MatchFrameRate { get; init; } = true;
    /// <summary>Turn Windows HDR on for HDR and Dolby Vision, off for SDR, while fullscreen.</summary>
    public bool MatchDynamicRange { get; init; } = true;
    /// <summary>A WASAPI endpoint id from mpv's audio-device-list; empty is the system default.</summary>
    public string AudioDevice { get; init; } = "";

    internal static readonly string[] PassthroughCodecs = { "ac3", "eac3", "dts", "dts-hd", "truehd" };

    /// <summary>The bitstreams wanted before the endpoint is consulted.</summary>
    internal IReadOnlyList<string> WantedPassthrough()
    {
        if (Passthrough is not JsonElement value || value.ValueKind == JsonValueKind.String && value.GetString() == "auto")
            return PassthroughCodecs;
        if (value.ValueKind == JsonValueKind.Array)
            return value.EnumerateArray().Where(v => v.ValueKind == JsonValueKind.String)
                .Select(v => v.GetString()!).Where(PassthroughCodecs.Contains).Distinct().ToArray();
        return Array.Empty<string>();
    }

    internal static PlaybackSettings Load(string dataPath)
    {
        try
        {
            var text = File.ReadAllText(Path.Combine(dataPath, "playback.json"));
            return JsonSerializer.Deserialize<PlaybackSettings>(text, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { return new(); }
    }
}
