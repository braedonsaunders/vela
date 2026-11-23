using System.Text.Json;
namespace Vela.Windows;

/// <summary>A live stream's window on the axis of the reported position (mpv time-pos + the path's timeline
/// origin). <see cref="Start"/> is null when nothing behind the edge can be played.</summary>
internal sealed record LiveWindow(double? Start, double? Edge, double Latency, double Segment, string Source);

/// <summary>Live timeshift arithmetic for the snapshot and the commands: the same rules as the web player
/// (modules/vela-player/web/engine/live-behind.ts, host/live.ts), the Apple player (ios/PlayerState.swift
/// LiveTimeline) and the Linux host (apps/vela-desktop/linux/logic.js). Live stays at rate 1 and is never
/// moved by the host on its own; only the viewer's seek, catchUp and play commands move it.</summary>
internal static class LiveTimeline
{
    static JsonElement Get(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) ? v : default;
    static double? Number(JsonElement e, string k) => Get(e, k).ValueKind == JsonValueKind.Number && Get(e, k).TryGetDouble(out var n) && double.IsFinite(n) ? n : null;

    /// <summary>A live channel, or a Start over plan (<c>live.mode: "startOver"</c>, a growing EVENT playlist from 0).</summary>
    internal static bool IsLive(JsonElement plan) =>
        Get(plan, "channelId").ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null) || Get(plan, "live").ValueKind == JsonValueKind.Object;
    internal static bool IsStartOver(JsonElement plan) =>
        Get(Get(plan, "live"), "mode") is { ValueKind: JsonValueKind.String } mode && mode.GetString() == "startOver";

    /// <summary>mpv's demuxer cache for a plan, set before its loadfile. On-demand keeps 400 MiB ahead and
    /// 100 MiB behind. Live has a smaller budget of 320 MiB in all: 192 MiB ahead and 128 MiB behind. At the
    /// edge little is ahead, and mpv's buffer donation lets the back buffer use the unused forward part, so the
    /// timeshift window mpv can seek in (demuxer-cache-state seekable-ranges) reaches about 5 minutes at
    /// 8 Mbit/s, 10 at 4 Mbit/s. The forward part is how far a pause or a rewind can fall behind while mpv keeps
    /// reading the stream (about 3 minutes at 8 Mbit/s); past that the reader waits, and a server whose
    /// playlist dropped those segments meanwhile continues from its oldest one. Start over reads its EVENT playlist from its first segment (FFmpeg otherwise joins
    /// three segments from the end), so position 0 is the programme's start.</summary>
    internal static IEnumerable<KeyValuePair<string, string>> DemuxerOptions(JsonElement plan)
    {
        bool live = IsLive(plan);
        yield return new("demuxer-max-bytes", live ? "192MiB" : "400MiB");
        yield return new("demuxer-max-back-bytes", live ? "128MiB" : "100MiB");
        yield return new("demuxer-lavf-o", IsStartOver(plan) ? "live_start_index=0" : "");
    }

    /// <summary>How far behind the edge live normally plays: the plan's target (else 6 s), and never closer than
    /// the three segments FFmpeg joins behind the newest one, or a normal lag would be told as a delay.</summary>
    internal static double Latency(JsonElement plan, double? targetDuration)
    {
        double wanted = Number(Get(plan, "livePolicy"), "targetLatencySeconds") is double t && t > 0 ? t : 6;
        return targetDuration is double target && target > 0 ? Math.Max(wanted, 3 * target) : wanted;
    }

    /// <summary>The live window, or null while unknown. A channel's is what mpv holds and can seek in: the newest
    /// of its cached seekable ranges. Start over's starts at the programme's start; its edge is the plan's, grown
    /// in real time since the plan arrived, or the cache's when newer.</summary>
    internal static LiveWindow? Read(JsonElement plan, JsonElement? cacheState, double origin, DateTime receivedAt, DateTime now, double? targetDuration)
    {
        if (!IsLive(plan)) return null;
        double latency = Latency(plan, targetDuration), segment = targetDuration is double d && d > 0 ? d : 2;
        (double Start, double End)? newest = null;
        if (cacheState is JsonElement state && Get(state, "seekable-ranges") is { ValueKind: JsonValueKind.Array } ranges)
            foreach (var range in ranges.EnumerateArray())
                if (Number(range, "start") is double start && Number(range, "end") is double end && end >= start && (newest == null || end > newest.Value.End))
                    newest = (start, end);
        if (IsStartOver(plan))
        {
            var live = Get(plan, "live");
            double? planned = Number(live, "liveEdgeSeconds") is double edge ? edge + Math.Max(0, (now - receivedAt).TotalSeconds) : null;
            double? cached = newest is { } n ? n.End + origin : null;
            if (planned == null && cached == null) return null;
            bool server = cached == null || planned >= cached;
            return new(Number(live, "windowStartSeconds") ?? 0, server ? planned : cached, latency, segment, server ? "server" : "seekable");
        }
        return newest is { } r ? new(r.Start + origin, r.End + origin, latency, segment, "seekable") : null;
    }

    /// <summary>Seconds playback trails its usual live position, or null when that cannot be told: no edge, or a
    /// position before the window (where the player is about to be put).</summary>
    internal static double? Lag(LiveWindow window, double position)
    {
        if (window.Edge is not double edge || !double.IsFinite(position)) return null;
        if (window.Start is double start && position < start - 1) return null;
        return Math.Max(0, edge - window.Latency - position);
    }

    /// <summary>Behind live enough to tell the viewer: at least 10 s (or two segments), held until back within 3 s.</summary>
    internal static bool Behind(double? lag, bool wasBehind, double segment) =>
        lag is double l && (wasBehind ? l > 3 : l >= Math.Max(10, 2 * segment));

    /// <summary>Where catching up lands: the edge less the latency, inside the window; null when that is not
    /// ahead of <paramref name="position"/>, so there is nothing newer to go to.</summary>
    internal static double? CatchUpTarget(LiveWindow window, double position)
    {
        if (window.Edge is not double edge) return null;
        double target = edge - window.Latency;
        if (window.Start is double start)
        {
            if (edge - start < 0.25) return null;
            target = Math.Max(start + 0.05, target);
        }
        return target > position + 0.25 ? Math.Min(target, edge - 0.1) : null;
    }

    /// <summary>A seek target held inside the window, a second short of the edge; null without a window to seek in.</summary>
    internal static double? Clamp(LiveWindow window, double seconds)
    {
        if (!double.IsFinite(seconds) || window.Start is not double start || window.Edge is not double edge || edge < start) return null;
        return Math.Min(Math.Max(seconds, start), Math.Max(start, edge - 1));
    }

    /// <summary>Where a paused live stream resumes when the window slid past its position meanwhile: a little
    /// inside its start, so the next slide does not take it again at once. Null when still inside.</summary>
    internal static double? ResumeTarget(LiveWindow window, double position)
    {
        if (window.Start is not double start || window.Edge is not double edge || !(position < start)) return null;
        return start + Math.Min(5, Math.Max(0, edge - 1 - start));
    }

    /// <summary>The snapshot's model.ts LiveSnapshot, and the behind-live verdict to hold for the next one.</summary>
    internal static (Dictionary<string, object?> Live, bool Behind) Snapshot(LiveWindow? window, double position, bool wasBehind, bool reconnecting)
    {
        double? lag = window == null ? null : Lag(window, position);
        bool behind = window != null && Behind(lag, wasBehind, window.Segment) && CatchUpTarget(window, position) != null;
        return (new Dictionary<string, object?>
        {
            ["edgeSeconds"] = window?.Edge, ["windowStartSeconds"] = window?.Start,
            ["driftSeconds"] = behind ? lag : 0, ["edgeSource"] = window?.Source,
            ["reconnecting"] = reconnecting, ["delivery"] = window?.Edge != null && !reconnecting ? "available" : "unknown",
            ["canCatchUp"] = behind,
        }, behind);
    }
}
