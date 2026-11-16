using System.Text.Json;

namespace Vela.Windows;

public sealed class PlayerPanel : UserControl
{
    private readonly Label title = new() { AutoSize = true, ForeColor = Color.White, Padding = new Padding(8) };
    private readonly Button play = new() { Text = "Pause", AutoSize = true };
    private readonly Label clock = new() { ForeColor = Color.White, AutoSize = true, Padding = new Padding(4, 8, 4, 0) };
    private readonly TrackBar seek = new() { Minimum = 0, Maximum = 1000, Width = 220, TickStyle = TickStyle.None };
    private readonly TrackBar volume = new() { Minimum = 0, Maximum = 100, Value = 100, Width = 100, TickStyle = TickStyle.None };
    private readonly ComboBox audio = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 150 };
    private readonly ComboBox subtitles = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 150 };
    private bool updating;
    private bool dragging;
    private bool playing = true;
    private double position;
    private double duration;

    public Panel VideoSurface { get; } = new() { Dock = DockStyle.Fill, BackColor = Color.Black };
    public IntPtr VideoHandle => VideoSurface.Handle;
    public event Action<string, object?>? CommandRequested;
    public event Action? BackRequested;
    public event Action? FullscreenRequested;

    public PlayerPanel()
    {
        BackColor = Color.Black;
        var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 42, BackColor = Color.FromArgb(32, 32, 32) };
        var back = new Button { Text = "Back", AutoSize = true };
        back.Click += (_, _) => BackRequested?.Invoke();
        top.Controls.Add(back);
        top.Controls.Add(title);
        var bottom = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom, Height = 46, BackColor = Color.FromArgb(32, 32, 32), WrapContents = false
        };
        var fullscreen = new Button { Text = "Fullscreen", AutoSize = true };
        fullscreen.Click += (_, _) => FullscreenRequested?.Invoke();
        play.Click += (_, _) => TogglePlayback();
        seek.MouseDown += (_, _) => dragging = true;
        seek.MouseUp += (_, _) => { if (dragging) { dragging = false; SeekToThumb(); } };
        seek.KeyUp += (_, _) => { if (!updating) SeekToThumb(); };
        volume.ValueChanged += (_, _) => { if (!updating) CommandRequested?.Invoke("volume", volume.Value / 100.0); };
        audio.SelectedIndexChanged += (_, _) =>
        {
            if (!updating && audio.SelectedItem is TrackOption option) CommandRequested?.Invoke("audio", option.Id);
        };
        subtitles.SelectedIndexChanged += (_, _) =>
        {
            if (!updating && subtitles.SelectedItem is TrackOption option) CommandRequested?.Invoke("subtitle", option.Id);
        };
        bottom.Controls.AddRange(new Control[] { play, clock, seek, volume, audio, subtitles, fullscreen });
        Controls.Add(VideoSurface);
        Controls.Add(bottom);
        Controls.Add(top);
        RefreshClock();
    }

    public void SetMetadata(string titleText) => title.Text = titleText;

    public void SetPlan(JsonElement plan)
    {
        updating = true;
        try
        {
            Populate(audio, plan, "audioTracks", "selectedAudioTrackId", false);
            Populate(subtitles, plan, "subtitleTracks", "selectedSubtitleTrackId", true);
        }
        finally { updating = false; }
    }

    public void UpdateState(JsonElement state)
    {
        updating = true;
        try
        {
            if (Number(state, "positionSeconds", out var p)) position = Math.Max(0, p);
            if (Number(state, "durationSeconds", out var d)) duration = Math.Max(0, d);
            if (Number(state, "volume", out var v)) volume.Value = Math.Clamp((int)Math.Round(v * 100), 0, 100);
            if (state.TryGetProperty("state", out var s) && s.ValueKind == JsonValueKind.String)
            {
                playing = s.GetString() == "playing";
                play.Text = playing ? "Pause" : "Play";
            }
            if (!dragging) seek.Value = duration > 0 ? Math.Clamp((int)(position / duration * 1000), 0, 1000) : 0;
            RefreshClock();
        }
        finally { updating = false; }
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        switch (keyData)
        {
            case Keys.Space: TogglePlayback(); return true;
            case Keys.Left: CommandRequested?.Invoke("seek", Math.Max(0, position - 10)); return true;
            case Keys.Right: CommandRequested?.Invoke("seek", duration > 0 ? Math.Min(duration, position + 10) : position + 10); return true;
            case Keys.Escape: BackRequested?.Invoke(); return true;
            default: return base.ProcessCmdKey(ref msg, keyData);
        }
    }

    private void TogglePlayback() => CommandRequested?.Invoke(playing ? "pause" : "play", null);
    private void SeekToThumb() { if (duration > 0) CommandRequested?.Invoke("seek", duration * seek.Value / 1000.0); }
    private void RefreshClock() => clock.Text = $"{FormatTime(position)} / {FormatTime(duration)}";
    private static string FormatTime(double seconds)
    {
        var time = TimeSpan.FromSeconds(Math.Max(0, seconds));
        return $"{(int)time.TotalHours:00}:{time.Minutes:00}:{time.Seconds:00}";
    }
    private static bool Number(JsonElement element, string name, out double value)
    {
        value = 0;
        return element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number
            && property.TryGetDouble(out value) && double.IsFinite(value);
    }
    private static void Populate(ComboBox combo, JsonElement plan, string tracks, string selected, bool allowNone)
    {
        combo.Items.Clear();
        if (allowNone) combo.Items.Add(new TrackOption(null, "Off"));
        if (plan.TryGetProperty(tracks, out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var track in list.EnumerateArray())
            {
                if (!track.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String) continue;
                var label = track.TryGetProperty("label", out var name) && name.ValueKind == JsonValueKind.String
                    ? name.GetString() : id.GetString();
                combo.Items.Add(new TrackOption(id.GetString(), label ?? id.GetString() ?? ""));
            }
        }
        var selectedId = plan.TryGetProperty(selected, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;
        for (var i = 0; i < combo.Items.Count; i++)
            if (((TrackOption)combo.Items[i]).Id == selectedId) { combo.SelectedIndex = i; break; }
    }
    private sealed record TrackOption(string? Id, string Label)
    {
        public override string ToString() => Label;
    }
}
