using System.Globalization;
using System.Text.Json;
namespace Vela.Windows;

internal sealed class Playback : IDisposable
{
    readonly Mpv mpv;
    MediaProxy proxy = new();
    readonly Action<string, object> emit;
    Uri? origin;
    JsonElement plan;
    string source = "", seek = "", phase = "idle", command = "";
    double offset;
    long sequence;
    DateTime observed;
    bool disposed;
    double? pendingSeek;
    string appliedAudio = "", appliedSubtitle = "";
    static JsonElement Get(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) ? v : default;
    static string? Str(JsonElement e, string k) => Get(e,k).ValueKind == JsonValueKind.String ? Get(e,k).GetString() : null;
    static double Num(JsonElement e,string k) => Get(e,k).TryGetDoubleSafe();
    string Format(double n) => n.ToString(CultureInfo.InvariantCulture);
    public Playback(IntPtr videoHandle, Action<string, object> emit)
    {
        this.emit = emit; mpv = new(videoHandle);
        mpv.Command("set", "hwdec", Environment.GetEnvironmentVariable("VELA_HWDEC") ?? "auto-safe");
        mpv.Command("set", "network-timeout", "20");
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
            var next = Get(props,"plan"); if (next.ValueKind != JsonValueKind.Object) { Stop(); return; }
            if (Str(plan,"sessionId") == Str(next,"sessionId") && (Num(next,"sourceGeneration") < Num(plan,"sourceGeneration") || Num(next,"seekGeneration") < Num(plan,"seekGeneration"))) return;
            if (Str(plan,"sessionId") != Str(next,"sessionId")) sequence = 0;
            plan = next.Clone(); var paths = Get(plan,"paths");
            var path = paths.EnumerateArray().FirstOrDefault(p => Str(p,"id") == Str(plan,"selectedPathId"));
            string key = $"{Str(plan,"sessionId")}:{Str(path,"id")}:{Num(plan,"sourceGeneration")}";
            string seekKey = $"{key}:{Num(plan,"seekGeneration")}";
            if (source != key)
            {
                if (!(Str(path,"transport") == "hls" || Str(path,"transport") == "file" && Get(path,"original").ValueKind == JsonValueKind.True)) throw new InvalidOperationException();
                offset = Num(path,"timelineOriginSeconds");
                mpv.Command("loadfile",Url(Str(path,"url") ?? throw new InvalidOperationException()),"replace");
                source = key; phase = "loading"; appliedAudio = ""; appliedSubtitle = "";
            }
            if (seek != seekKey) { pendingSeek = Math.Max(0,Num(plan,"positionSeconds")-offset); seek = seekKey; }
            
            var cmd = Get(props,"command"); string raw = cmd.ValueKind == JsonValueKind.Object ? cmd.GetRawText() : "";
            // Fullscreen and picture-in-picture belong to the page and the window, never the session.
            if (raw != command) { command = raw; if (Str(cmd,"type") is string type && type is not ("fullscreen" or "pip"))
                {
                    object? value = type switch {
                        "seek" or "seekBy" => Get(cmd,"seconds"),
                        "audio" or "subtitle" => Get(cmd,"trackId"),
                        "mute" => Get(cmd,"muted"), _ => Get(cmd,"value")
                    };
                    LocalCommand(type, value);
                } }
        }
        catch { Fail(); }
    }
    void ApplyTrack(string kind,string? id)
    {
        if (kind == "audio" && appliedAudio == id || kind == "subtitle" && appliedSubtitle == (id ?? "none")) return;
        string property = kind == "audio" ? "aid" : "sid";
        if (id == null) { if (kind == "subtitle") { mpv.Command("set",property,"no"); appliedSubtitle = "none"; } return; }
        var list = Get(plan,kind == "audio" ? "audioTracks" : "subtitleTracks");
        if (list.ValueKind != JsonValueKind.Array) return;
        var track = list.EnumerateArray().FirstOrDefault(t => Str(t,"id") == id);
        using var native = JsonDocument.Parse(mpv.Property("track-list") ?? "[]");
        foreach (var item in native.RootElement.EnumerateArray())
            if (Str(item,"type") == (kind == "audio" ? "audio" : "sub") && Num(item,"ff-index") == Num(track,"streamIndex")) { mpv.Command("set",property,Format(Num(item,"id"))); if (kind == "audio") appliedAudio=id; else appliedSubtitle=id; return; }
        var delivery = Get(track,"delivery");
        if (kind == "subtitle" && Str(delivery,"kind") == "external" && (Str(delivery,"url") ?? Str(track,"url")) is string url) { mpv.Command("sub-add",Url(url),"select"); appliedSubtitle=id; }
    }
    void ApplyCommand(string kind, JsonElement command)
    {
        switch (kind)
        {
            case "play": case "resume": mpv.Command("set", "pause", "no"); break;
            case "pause": mpv.Command("set", "pause", "yes"); break;
            case "seek": pendingSeek = Math.Max(0, Num(command, "positionSeconds") - offset); break;
            case "volume": mpv.Command("set", "volume", Format(Math.Clamp(Num(command, "volume"), 0, 1) * 100)); break;
            case "mute": mpv.Command("set", "mute", Get(command, "muted").ValueKind == JsonValueKind.True ? "yes" : "no"); break;
            case "stop": Stop(); break;
            case "speed": mpv.Command("set", "speed", Format(Math.Clamp(Num(command, "speed"), .25, 4))); break;
        }
    }
    public void LocalCommand(string kind, object? value = null)
    {
        try
        {
            var payload = new Dictionary<string, object?> { ["kind"] = kind is "audio" or "subtitle" ? "tracks" : kind == "play" ? "resume" : kind };
            string? field = kind switch
            {
                "seek" => "positionSeconds", "audio" => "audioTrackId", "subtitle" => "subtitleTrackId",
                "volume" => "volume", "mute" => "muted", "speed" => "speed", _ => null
            };
            if (field != null) payload[field] = value;
            if (kind == "seekBy") {
                payload["kind"] = "seek";
                payload["positionSeconds"] = Read("time-pos") + offset +
                    (value is JsonElement delta ? delta.TryGetDoubleSafe() : Convert.ToDouble(value));
            }
            var serialized = JsonSerializer.SerializeToElement(payload);
            ApplyCommand(kind == "seekBy" ? "seek" : kind, serialized);
            if (kind is "volume" or "mute" or "speed") return;
            payload["sourceGeneration"] = Num(plan, "sourceGeneration");
            payload["seekGeneration"] = Num(plan, "seekGeneration");
            payload["idempotencyKey"] = Guid.NewGuid().ToString();
            emit("session-command", new { sessionId = Str(plan, "sessionId"), command = payload });
        }
        catch { Fail(); }
    }
    double Read(string property) => double.TryParse(mpv.Property(property),NumberStyles.Float,CultureInfo.InvariantCulture,out var n) && double.IsFinite(n) ? n : 0;
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
            double position=Read("time-pos")+offset, ahead=Read("demuxer-cache-duration");
            string state=mpv.Property("eof-reached")=="yes" ? "ended" : mpv.Property("paused-for-cache")=="yes" ? "buffering" : mpv.Property("pause")=="yes" ? "paused" : "playing";
            Awake(state == "playing" || state == "buffering");
            emit("snapshot",new { state,position,duration=Read("duration")+offset,bufferAheadSeconds=ahead,volume=Read("volume")/100,muted=mpv.Property("mute")=="yes",speed=Read("speed"),droppedFrames=Read("frame-drop-count") });
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
    public void Stop() { if (!disposed) { try {mpv.Command("stop");} catch {} } source="";seek="";phase="idle";Awake(false); }
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
