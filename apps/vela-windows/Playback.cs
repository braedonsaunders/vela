using System.Globalization;
using System.Text.Json;
namespace Vela.Windows;

internal sealed class Playback : IDisposable
{
    readonly Mpv mpv;
    MediaProxy proxy = new();
    readonly Action<string, object> emit;
    readonly IntPtr window;
    readonly PlaybackSettings settings;
    readonly DisplayMatch display = new();
    AudioEndpointInfo endpoint;
    Uri? origin;
    JsonElement plan;
    string source = "", seek = "", phase = "idle", subtitleAppearance = "";
    long lastCommand = -1;
    double offset;
    long sequence;
    DateTime observed, described;
    bool disposed, fullscreen;
    double? pendingSeek;
    string appliedAudio = "", appliedSubtitle = "", matchedSource = "";
    object? facts, output;
    static JsonElement Get(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) ? v : default;
    static string? Str(JsonElement e, string k) => Get(e,k).ValueKind == JsonValueKind.String ? Get(e,k).GetString() : null;
    static double Num(JsonElement e,string k) => Get(e,k).TryGetDoubleSafe();
    static string Format(double n) => n.ToString(CultureInfo.InvariantCulture);

    /// <summary>libmpv's video and audio outputs for a home-theatre PC. gpu-next over Direct3D 11 with
    /// D3D11VA decoding; HDR goes to the display as HDR10 when Windows HDR is on (target-colorspace-hint)
    /// and is tone-mapped by libplacebo otherwise; Dolby Vision RPUs are applied by libplacebo. Audio is
    /// WASAPI: bitstreams the receiver accepts pass through (exclusive, IEC 61937), PCM is shared or, when
    /// asked, exclusive at the source's own rate and bit depth.</summary>
    static IEnumerable<KeyValuePair<string, string>> Options(PlaybackSettings settings, AudioEndpointInfo endpoint)
    {
        var options = new Dictionary<string, string>
        {
            ["vo"] = "gpu-next", ["gpu-api"] = "d3d11", ["gpu-context"] = "d3d11",
            ["hwdec"] = Environment.GetEnvironmentVariable("VELA_HWDEC") ?? "auto-safe",
            ["target-colorspace-hint"] = "auto", ["deinterlace"] = "auto",
            ["ao"] = "wasapi", ["audio-spdif"] = Spdif(settings, endpoint),
            ["audio-exclusive"] = settings.Exclusive ? "yes" : "no",
            ["audio-channels"] = settings.Exclusive ? "auto" : "auto-safe",
            ["keep-open"] = "yes", ["idle"] = "yes", ["osd-level"] = "0", ["osd-bar"] = "no",
            ["cursor-autohide"] = "no", ["input-cursor"] = "no", ["sub-auto"] = "no", ["audio-file-auto"] = "no",
            ["ytdl"] = "no", ["cache"] = "yes", ["demuxer-max-bytes"] = "400MiB", ["demuxer-max-back-bytes"] = "100MiB",
            ["network-timeout"] = "20",
        };
        if (settings.AudioDevice.Length > 0) options["audio-device"] = settings.AudioDevice;
        return options;
    }

    /// <summary>The wanted bitstreams the endpoint accepts. mpv decodes anything else, losslessly for lossless codecs.</summary>
    static string Spdif(PlaybackSettings settings, AudioEndpointInfo endpoint) =>
        string.Join(',', settings.WantedPassthrough().Where(endpoint.Passthrough.Contains));

    public Playback(IntPtr videoHandle, Action<string, object> emit, PlaybackSettings settings)
    {
        this.emit = emit; this.settings = settings; window = videoHandle;
        endpoint = AudioEndpointInfo.Probe(settings.AudioDevice);
        mpv = new(videoHandle, Options(settings, endpoint));
    }

    /// <summary>Frame-rate and range matching apply only while the window fills the screen.</summary>
    public bool Fullscreen
    {
        set
        {
            if (fullscreen == value) return;
            fullscreen = value; matchedSource = "";
            if (!value) display.Restore();
        }
    }

    public void SetAccess(string? accessOrigin, string? prefix, Dictionary<string,string> headers)
    {
        Stop(); proxy.Dispose(); proxy = new(); origin = null;
        if (accessOrigin != null) { origin = new Uri(accessOrigin); proxy.SetAccess(accessOrigin,prefix ?? "/",headers); }
    }
    string Url(string url) => proxy.Register(new Uri(url, UriKind.RelativeOrAbsolute).IsAbsoluteUri ? url : new Uri(origin ?? throw new InvalidOperationException(),url).ToString()).ToString();
    public void Update(JsonElement props)
    {
        try
        {
            if (Get(props,"active").ValueKind == JsonValueKind.False) { Stop(); return; }
            if (Get(props,"serverError").ValueKind is JsonValueKind.Object or JsonValueKind.String) { Fail(); return; }
            ApplySubtitleAppearance(Get(props, "subtitleAppearance"));
            var next = Get(props,"plan"); if (next.ValueKind != JsonValueKind.Object) { Stop(); return; }
            if (Str(plan,"sessionId") == Str(next,"sessionId") && (Num(next,"sourceGeneration") < Num(plan,"sourceGeneration") || Num(next,"seekGeneration") < Num(plan,"seekGeneration"))) return;
            // Command ids keep rising across sessions; a session change must not replay the last one.
            if (Str(plan,"sessionId") != Str(next,"sessionId")) sequence = 0;
            plan = next.Clone();
            var path = SelectedPath();
            string key = $"{Str(plan,"sessionId")}:{Str(path,"id")}:{Num(plan,"sourceGeneration")}";
            string seekKey = $"{key}:{Num(plan,"seekGeneration")}";
            if (source != key)
            {
                if (!(Str(path,"transport") == "hls" || Str(path,"transport") == "file" && Get(path,"original").ValueKind == JsonValueKind.True)) throw new InvalidOperationException();
                offset = Num(path,"timelineOriginSeconds");
                // The receiver may have been switched or replaced since the last title.
                endpoint = AudioEndpointInfo.Probe(settings.AudioDevice);
                mpv.TrySet("audio-spdif", Spdif(settings, endpoint));
                source = key; phase = "loading"; appliedAudio = ""; appliedSubtitle = ""; matchedSource = ""; facts = null;
                // The server probed the original: switch the display before the first frame. A transcode's
                // range may differ from the original's, so it waits for the decoded stream.
                if (Get(path, "original").ValueKind == JsonValueKind.True) MatchDisplay(OriginalFrameRate(path), OriginalHdr(path));
                mpv.Command("loadfile",Url(Str(path,"url") ?? throw new InvalidOperationException()),"replace");
            }
            if (seek != seekKey) { pendingSeek = Math.Max(0,Num(plan,"positionSeconds")-offset); seek = seekKey; }

            var cmd = Get(props,"command");
            // Fullscreen and picture-in-picture belong to the page and the window, never the session.
            if (cmd.ValueKind == JsonValueKind.Object && Num(cmd, "id") is var id && id > lastCommand)
            {
                lastCommand = (long)id;
                string? type = Str(cmd, "type");
                bool ok = type switch
                {
                    "seek" or "seekBy" => Session(type, Get(cmd, "seconds")),
                    "audio" or "subtitle" => Session(type, Get(cmd, "trackId")),
                    "switchPath" => Session(type, Get(cmd, "pathId")),
                    "play" or "pause" => Session(type, default),
                    "volume" => mpv.TrySet("volume", Format(Math.Clamp(Num(cmd, "value"), 0, 1) * 100)),
                    "mute" => mpv.TrySet("mute", Get(cmd, "muted").ValueKind == JsonValueKind.True ? "yes" : "no"),
                    "speed" => mpv.TrySet("speed", Format(Live() ? 1 : Math.Clamp(Num(cmd, "value"), .25, 4))),
                    _ => false,
                };
                emit("command", ok ? new { id, ok } : new { id, ok, failure = new { kind = "unsupported", message = "Not supported by the native player", recoverable = false } });
            }
        }
        catch { Fail(); }
    }
    JsonElement SelectedPath() => Get(plan,"paths").ValueKind == JsonValueKind.Array
        ? Get(plan,"paths").EnumerateArray().FirstOrDefault(p => Str(p,"id") == Str(plan,"selectedPathId")) : default;
    bool Live() => Str(plan, "channelId") != null || Get(plan, "livePolicy").ValueKind == JsonValueKind.Object;

    static double? OriginalFrameRate(JsonElement path) => Num(Get(path, "originalVideo"), "frameRate") is var fps && fps > 0 ? fps : null;
    static bool? OriginalHdr(JsonElement path)
    {
        var video = Get(path, "originalVideo");
        if (Get(video, "dvProfile").ValueKind == JsonValueKind.Number) return true;
        return Str(video, "colorTransfer") is string transfer ? transfer is "smpte2084" or "pq" or "arib-std-b67" or "hlg" : null;
    }

    void MatchDisplay(double? fps, bool? hdr)
    {
        if (!fullscreen || source.Length == 0 || matchedSource == source || fps == null && hdr == null) return;
        display.Apply(window, fps, hdr, settings);
        if (fps != null && hdr != null) matchedSource = source;
    }

    void ApplyTrack(string kind,string? id)
    {
        if (kind == "audio" && appliedAudio == id || kind == "subtitle" && appliedSubtitle == (id ?? "none")) return;
        string property = kind == "audio" ? "aid" : "sid";
        if (id == null) { if (kind == "subtitle") { mpv.Command("set",property,"no"); appliedSubtitle = "none"; } return; }
        var list = Get(plan,kind == "audio" ? "audioTracks" : "subtitleTracks");
        if (list.ValueKind != JsonValueKind.Array) return;
        var track = list.EnumerateArray().FirstOrDefault(t => Str(t,"id") == id);
        var native = mpv.Node("track-list");
        if (native is JsonElement items && items.ValueKind == JsonValueKind.Array)
            foreach (var item in items.EnumerateArray())
                if (Str(item,"type") == (kind == "audio" ? "audio" : "sub") && Num(item,"ff-index") == Num(track,"streamIndex")) { mpv.Command("set",property,Format(Num(item,"id"))); if (kind == "audio") appliedAudio=id; else appliedSubtitle=id; return; }
        var delivery = Get(track,"delivery");
        if (kind == "subtitle" && Str(delivery,"kind") == "external" && (Str(delivery,"url") ?? Str(track,"url")) is string url) { mpv.Command("sub-add",Url(url),"select"); appliedSubtitle=id; }
    }

    /// <summary>The page's subtitle preferences as libmpv styles them. Text subtitles (SRT, WebVTT) take
    /// all of them; styled ASS keeps its own look and takes only the size; bitmaps (PGS, VobSub) are drawn as authored.</summary>
    void ApplySubtitleAppearance(JsonElement appearance)
    {
        if (appearance.ValueKind != JsonValueKind.Object) return;
        string raw = appearance.GetRawText();
        if (raw == subtitleAppearance) return;
        subtitleAppearance = raw;
        mpv.TrySet("sub-scale", Str(appearance, "subtitleSize") switch { "small" => "0.8", "large" => "1.25", "xl" => "1.5", _ => "1" });
        mpv.TrySet("sub-color", Str(appearance, "subtitleColor") == "yellow" ? "#FFFFE14D" : "#FFFFFFFF");
        mpv.TrySet("sub-pos", Str(appearance, "subtitlePosition") == "raised" ? "88" : "100");
        switch (Str(appearance, "subtitleBackground"))
        {
            case "box": mpv.TrySet("sub-border-style", "background-box"); mpv.TrySet("sub-back-color", "#B0000000"); mpv.TrySet("sub-shadow-offset", "0"); break;
            case "none": mpv.TrySet("sub-border-style", "outline-and-shadow"); mpv.TrySet("sub-shadow-offset", "0"); mpv.TrySet("sub-border-size", "1.5"); break;
            default: mpv.TrySet("sub-border-style", "outline-and-shadow"); mpv.TrySet("sub-shadow-offset", "1.5"); mpv.TrySet("sub-border-size", "2.5"); break;
        }
        if (Get(appearance, "offsetSeconds").ValueKind == JsonValueKind.Number) mpv.TrySet("sub-delay", Format(Num(appearance, "offsetSeconds")));
    }

    /// <summary>A command the session must apply: the server answers with a new plan.</summary>
    bool Session(string type, JsonElement value)
    {
        var payload = new Dictionary<string, object?>
        {
            ["kind"] = type switch { "play" => "resume", "audio" or "subtitle" => "tracks", "seekBy" => "seek", "switchPath" => "switch", _ => type },
            ["sourceGeneration"] = Num(plan, "sourceGeneration"), ["seekGeneration"] = Num(plan, "seekGeneration"),
            ["idempotencyKey"] = Guid.NewGuid().ToString(),
        };
        double now = Read("time-pos") + offset;
        switch (type)
        {
            case "play": mpv.Command("set", "pause", "no"); break;
            case "pause": mpv.Command("set", "pause", "yes"); break;
            case "seek": case "seekBy":
                double target = Math.Max(0, (type == "seekBy" ? now : 0) + value.TryGetDoubleSafe());
                payload["positionSeconds"] = target; pendingSeek = Math.Max(0, target - offset); break;
            case "audio": payload["audioTrackId"] = value.ValueKind == JsonValueKind.String ? value.GetString() : null; break;
            case "subtitle": payload["subtitleTrackId"] = value.ValueKind == JsonValueKind.String ? value.GetString() : null; break;
            case "switchPath": payload["pathId"] = value.ValueKind == JsonValueKind.String ? value.GetString() : null; payload["atSeconds"] = now; break;
        }
        emit("session-command", new { sessionId = Str(plan, "sessionId"), command = payload });
        return true;
    }

    double Read(string property) => double.TryParse(mpv.Property(property),NumberStyles.Float,CultureInfo.InvariantCulture,out var n) && double.IsFinite(n) ? n : 0;
    double? Maybe(string property) => double.TryParse(mpv.Property(property),NumberStyles.Float,CultureInfo.InvariantCulture,out var n) && double.IsFinite(n) ? n : null;

    /// <summary>mpv's own description of the stream and both outputs, for the info card
    /// (modules/vela-player/src/windows/mpv-format.ts maps it). Read once a second.</summary>
    void Describe()
    {
        if ((DateTime.UtcNow - described).TotalSeconds < 1 && facts != null) return;
        described = DateTime.UtcNow;
        var videoTrack = mpv.Node("current-tracks/video");
        var videoParams = mpv.Node("video-params");
        double? fps = Maybe("container-fps");
        bool? hdr = videoTrack is JsonElement track && Get(track, "dolby-vision-profile").ValueKind == JsonValueKind.Number ? true
            : videoParams is JsonElement vp && Str(vp, "gamma") is string gamma ? gamma is "pq" or "hlg" : null;
        MatchDisplay(fps, hdr);
        var audioOut = mpv.Node("audio-out-params");
        bool passthrough = audioOut is JsonElement ao && Str(ao, "format")?.StartsWith("spdif-", StringComparison.Ordinal) == true;
        facts = new Dictionary<string, object?>
        {
            ["videoTrack"] = videoTrack, ["audioTrack"] = mpv.Node("current-tracks/audio"),
            ["video-params"] = videoParams, ["video-target-params"] = mpv.Node("video-target-params"),
            ["audio-params"] = mpv.Node("audio-params"), ["audio-out-params"] = audioOut,
            ["hwdec-current"] = mpv.Property("hwdec-current"), ["container-fps"] = fps,
            ["deinterlace-active"] = mpv.Property("deinterlace-active") is string d ? d == "yes" : null,
            ["volume"] = Maybe("volume"), ["speed"] = Maybe("speed"),
        };
        var mode = DisplayMatch.Current(window);
        // What the panel shows now against the content, whether or not Vela switched it.
        string? frameRateMatch = !settings.MatchFrameRate ? "off" : mode == null || fps == null ? null
            : DisplayMatch.Multiple(mode.RefreshRate, fps.Value) > 0 ? "matched" : display.FrameRateState == "unsupported" ? "unsupported" : "unmatched";
        string? rangeMatch = !settings.MatchDynamicRange ? "off" : mode == null || hdr == null ? null
            : !mode.HdrSupported ? "unsupported" : mode.HdrOn == hdr ? "matched" : "unmatched";
        output = new Dictionary<string, object?>
        {
            ["display"] = mode == null ? null : new { width = mode.Width, height = mode.Height, refreshRate = mode.RefreshRate, hdr = mode.HdrOn },
            ["frameRateMatch"] = frameRateMatch,
            ["rangeMatch"] = rangeMatch,
            ["exclusive"] = passthrough || settings.Exclusive,
            ["route"] = endpoint.Route.Length > 0 ? endpoint.Route : null,
        };
    }

    public void Tick()
    {
        if (disposed || source.Length == 0) return;
        try {
            string? time = mpv.Property("time-pos");
            if (time == null) { emit("snapshot", new { state = "loading" }); return; }
            if (pendingSeek is double target)
            {
                mpv.Command("seek", Format(target), "absolute+exact"); pendingSeek = null;
            }
            ApplyTrack("audio", Str(plan, "selectedAudioTrackId"));
            ApplyTrack("subtitle", Str(plan, "selectedSubtitleTrackId"));
            Describe();
            double position=Read("time-pos")+offset, ahead=Read("demuxer-cache-duration");
            string state=mpv.Property("eof-reached")=="yes" ? "ended" : mpv.Property("paused-for-cache")=="yes" ? "buffering" : mpv.Property("pause")=="yes" ? "paused" : "playing";
            Awake(state == "playing" || state == "buffering");
            emit("snapshot",new { sessionId=Str(plan,"sessionId"),sourceGeneration=Num(plan,"sourceGeneration"),seekGeneration=Num(plan,"seekGeneration"),
                state,position,duration=Read("duration")+offset,bufferAheadSeconds=ahead,volume=Read("volume")/100,muted=mpv.Property("mute")=="yes",
                speed=Read("speed"),speeds=Live() ? new[]{1.0} : new[]{.5,.75,1,1.25,1.5,2},droppedFrames=Read("frame-drop-count"),mpv=facts,output });
            if (state!=phase || (DateTime.UtcNow-observed).TotalSeconds>=1) {
                observed=DateTime.UtcNow; phase=state; sequence++;
                emit("observation",new {sessionId=Str(plan,"sessionId"),observation=new {idempotencyKey=$"{seek}:{sequence}",sourceGeneration=Num(plan,"sourceGeneration"),seekGeneration=Num(plan,"seekGeneration"),sequence,observedAt=observed.ToString("O"),positionSeconds=position,state,selectedPathId=Str(plan,"selectedPathId"),audioTrackId=Str(plan,"selectedAudioTrackId"),subtitleTrackId=Str(plan,"selectedSubtitleTrackId"),playableRanges=ahead>0 ? new[]{new {startSeconds=position,endSeconds=position+ahead}} : Array.Empty<object>(),throughputBps=Read("cache-speed")*8,droppedFrames=Read("frame-drop-count")}});
            }
        } catch { Fail(); }
    }
    void Fail() {
        emit("observation", new { sessionId = Str(plan, "sessionId"), observation = new {
            idempotencyKey = Guid.NewGuid().ToString(), sequence = ++sequence,
            sourceGeneration = Num(plan, "sourceGeneration"), seekGeneration = Num(plan, "seekGeneration"),
            observedAt = DateTime.UtcNow.ToString("O"), positionSeconds = Read("time-pos") + offset,
            state = "buffering", selectedPathId = Str(plan, "selectedPathId"), playableRanges = Array.Empty<object>(),
            error = new { @class = "source", message = "Native playback failed" }
        }});
        Stop(); emit("snapshot",new {state="failed",failure=new {message="Native playback failed",kind="source",recoverable=false}}); }
    public void Stop() { if (!disposed) { try {mpv.Command("stop");} catch {} } source="";seek="";phase="idle";matchedSource="";facts=null;display.Restore();Awake(false); }
    // No screensaver, display sleep or lock while a film plays (or buffers to play); released when
    // paused, ended or stopped. Called on the UI thread, which holds the execution state.
    [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
    const uint EsContinuous = 0x80000000, EsSystemRequired = 0x00000001, EsDisplayRequired = 0x00000002;
    bool awake;
    void Awake(bool on) {
        if (on == awake) return;
        awake = on;
        SetThreadExecutionState(on ? EsContinuous | EsSystemRequired | EsDisplayRequired : EsContinuous);
    }
    public void Dispose() { if(disposed)return; Stop();disposed=true;mpv.Dispose();proxy.Dispose(); }
}
internal static class PlaybackJson { internal static double TryGetDoubleSafe(this JsonElement e) => e.ValueKind==JsonValueKind.Number && e.TryGetDouble(out var n) && double.IsFinite(n) ? n : 0; }
