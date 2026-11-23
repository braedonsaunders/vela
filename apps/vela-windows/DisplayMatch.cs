using System.Runtime.InteropServices;

namespace Vela.Windows;

/// <summary>The monitor under the player window: its mode (with the exact rational refresh rate) and
/// Windows HDR state, and frame-rate / dynamic-range matching that is undone afterwards. Refresh
/// changes use CDS_FULLSCREEN, which Windows itself reverts if Vela exits; the HDR toggle is undone
/// by <see cref="Restore"/>.</summary>
internal sealed class DisplayMatch
{
    internal sealed record Mode(int Width, int Height, double RefreshRate, bool HdrSupported, bool HdrOn, string Device);

    private string? switchedDevice;
    private (Luid Adapter, uint Id, bool WasOn)? switchedHdr;
    internal string FrameRateState { get; private set; } = "off";
    internal string RangeState { get; private set; } = "off";

    /// <summary>The current mode of the monitor showing this window, or null when Windows does not say.</summary>
    internal static Mode? Current(IntPtr window)
    {
        try
        {
            var device = MonitorDevice(window);
            if (device == null) return null;
            var mode = NewDevMode();
            if (!EnumDisplaySettingsExW(device, EnumCurrentSettings, ref mode, 0)) return null;
            var target = Target(device);
            double refresh = target is { Refresh: var r } && r > 0 ? r : mode.dmDisplayFrequency;
            var (supported, on) = target is { } t ? Hdr(t.Adapter, t.Id) : (false, false);
            return new((int)mode.dmPelsWidth, (int)mode.dmPelsHeight, Math.Round(refresh, 3), supported, on, device);
        }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException) { return null; }
    }

    /// <summary>Any connected monitor can show HDR (Windows HDR is on or can be switched on).</summary>
    internal static bool AnyHdrDisplay()
    {
        try { return Targets().Any(t => Hdr(t.Adapter, t.Id).Supported); }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException) { return false; }
    }

    /// <summary>Puts the window's monitor in the content's frame rate and range, where allowed.</summary>
    internal void Apply(IntPtr window, double? frameRate, bool? hdrContent, PlaybackSettings settings)
    {
        var device = MonitorDevice(window);
        if (device == null) { FrameRateState = RangeState = "unsupported"; return; }
        FrameRateState = !settings.MatchFrameRate ? "off" : frameRate is double fps && fps > 0 ? MatchRefresh(device, fps) : FrameRateState;
        RangeState = !settings.MatchDynamicRange ? "off" : hdrContent is bool hdr ? MatchRange(device, hdr) : RangeState;
    }

    private string MatchRefresh(string device, double fps)
    {
        var current = NewDevMode();
        if (!EnumDisplaySettingsExW(device, EnumCurrentSettings, ref current, 0)) return "unsupported";
        double now = Target(device)?.Refresh is double exact && exact > 0 ? exact : ActualRate((int)current.dmDisplayFrequency);
        if (Multiple(now, fps) == 1) return "matched";
        var candidates = new List<(int Frequency, int Multiple)>();
        var mode = NewDevMode();
        for (int i = 0; EnumDisplaySettingsExW(device, i, ref mode, 0); i++)
        {
            if (mode.dmPelsWidth != current.dmPelsWidth || mode.dmPelsHeight != current.dmPelsHeight ||
                mode.dmBitsPerPel != current.dmBitsPerPel || (mode.dmDisplayFlags & 2 /* DM_INTERLACED */) != 0) continue;
            int multiple = Multiple(ActualRate((int)mode.dmDisplayFrequency), fps);
            if (multiple > 0) candidates.Add(((int)mode.dmDisplayFrequency, multiple));
        }
        // The film's own rate, so a TV can apply its cadence processing; otherwise the fastest exact multiple.
        if (Multiple(now, fps) > 1 && !candidates.Any(c => c.Multiple == 1)) return "matched";
        var choice = candidates.OrderBy(c => c.Multiple == 1 ? 0 : 1).ThenByDescending(c => c.Frequency).FirstOrDefault();
        if (choice.Frequency == 0) return "unmatched";
        var next = current;
        next.dmDisplayFrequency = (uint)choice.Frequency;
        next.dmFields = DmDisplayFrequency | DmPelsWidth | DmPelsHeight;
        if (ChangeDisplaySettingsExW(device, ref next, IntPtr.Zero, CdsFullscreen, IntPtr.Zero) != 0) return "unmatched";
        switchedDevice = device;
        return "matched";
    }

    private string MatchRange(string device, bool hdr)
    {
        if (Target(device) is not { } target) return "unsupported";
        var (supported, on) = Hdr(target.Adapter, target.Id);
        if (!supported) return "unsupported";
        if (on == hdr) return "matched";
        if (!SetHdr(target.Adapter, target.Id, hdr)) return "unmatched";
        switchedHdr ??= (target.Adapter, target.Id, on);
        return "matched";
    }

    /// <summary>Back to the user's own mode and HDR setting.</summary>
    internal void Restore()
    {
        if (switchedDevice != null) { ChangeDisplaySettingsExW(switchedDevice, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero); switchedDevice = null; }
        if (switchedHdr is { } hdr) { SetHdr(hdr.Adapter, hdr.Id, hdr.WasOn); switchedHdr = null; }
        if (FrameRateState == "matched") FrameRateState = "off";
        if (RangeState == "matched") RangeState = "off";
    }

    /// <summary>Windows lists NTSC-family modes by their integer part: 23 is 24000/1001 Hz, 59 is 60000/1001 Hz.</summary>
    internal static double ActualRate(int frequency) =>
        frequency is 23 or 29 or 47 or 59 or 71 or 95 or 119 or 143 or 239 ? (frequency + 1) * 1000.0 / 1001 : frequency;

    /// <summary>k when the display shows each frame exactly k times (within 0.05 %), else 0.</summary>
    internal static int Multiple(double refresh, double fps)
    {
        if (fps <= 0 || refresh <= 0) return 0;
        int k = (int)Math.Round(refresh / fps);
        return k >= 1 && Math.Abs(refresh - k * fps) / (k * fps) < 0.0005 ? k : 0;
    }

    private static string? MonitorDevice(IntPtr window)
    {
        var monitor = MonitorFromWindow(window, 2 /* MONITOR_DEFAULTTONEAREST */);
        var info = new MonitorInfoEx { Size = Marshal.SizeOf<MonitorInfoEx>() };
        return monitor != IntPtr.Zero && GetMonitorInfoW(monitor, ref info) ? info.Device : null;
    }

    private record struct DisplayTarget(Luid Adapter, uint Id, string Device, double Refresh);

    private static DisplayTarget? Target(string device) => Targets().Cast<DisplayTarget?>().FirstOrDefault(t => t!.Value.Device == device);

    private static List<DisplayTarget> Targets()
    {
        var targets = new List<DisplayTarget>();
        if (GetDisplayConfigBufferSizes(QdcOnlyActivePaths, out uint pathCount, out uint modeCount) != 0) return targets;
        var paths = new PathInfo[pathCount];
        var modes = new byte[modeCount * 64];
        if (QueryDisplayConfig(QdcOnlyActivePaths, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero) != 0) return targets;
        foreach (var path in paths.Take((int)pathCount))
        {
            var name = new SourceName { Header = new() { Type = 1, Size = (uint)Marshal.SizeOf<SourceName>(), Adapter = path.SourceAdapter, Id = path.SourceId } };
            if (DisplayConfigGetDeviceInfo(ref name) != 0) continue;
            double refresh = path.RefreshDenominator > 0 ? (double)path.RefreshNumerator / path.RefreshDenominator : 0;
            targets.Add(new(path.TargetAdapter, path.TargetId, name.Device, refresh));
        }
        return targets;
    }

    /// <summary>HDR support and state; Windows 11 24H2's HDR-specific query first, then advanced colour.</summary>
    private static (bool Supported, bool On) Hdr(Luid adapter, uint id)
    {
        var info2 = new AdvancedColor2 { Header = new() { Type = 15, Size = (uint)Marshal.SizeOf<AdvancedColor2>(), Adapter = adapter, Id = id } };
        if (DisplayConfigGetDeviceInfo(ref info2) == 0) return ((info2.Value & 0x10) != 0, info2.ActiveColorMode == 2);
        var info = new AdvancedColor { Header = new() { Type = 9, Size = (uint)Marshal.SizeOf<AdvancedColor>(), Adapter = adapter, Id = id } };
        return DisplayConfigGetDeviceInfo(ref info) == 0 ? ((info.Value & 1) != 0 && (info.Value & 8) == 0, (info.Value & 2) != 0) : (false, false);
    }

    private static bool SetHdr(Luid adapter, uint id, bool on)
    {
        var state = new SetState { Header = new() { Type = 16, Size = (uint)Marshal.SizeOf<SetState>(), Adapter = adapter, Id = id }, Value = on ? 1u : 0 };
        if (DisplayConfigSetDeviceInfo(ref state) == 0) return true;
        state.Header.Type = 10;
        return DisplayConfigSetDeviceInfo(ref state) == 0;
    }

    private static DevMode NewDevMode() => new() { dmSize = (ushort)Marshal.SizeOf<DevMode>() };
    private const int EnumCurrentSettings = -1;
    private const uint CdsFullscreen = 4, QdcOnlyActivePaths = 2;
    private const uint DmPelsWidth = 0x80000, DmPelsHeight = 0x100000, DmDisplayFrequency = 0x400000;

    [StructLayout(LayoutKind.Sequential)] internal struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] private struct Header { public uint Type, Size; public Luid Adapter; public uint Id; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct SourceName { public Header Header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device; }
    [StructLayout(LayoutKind.Sequential)] private struct AdvancedColor { public Header Header; public uint Value, ColorEncoding, BitsPerColorChannel; }
    [StructLayout(LayoutKind.Sequential)] private struct AdvancedColor2 { public Header Header; public uint Value, ColorEncoding, BitsPerColorChannel, ActiveColorMode; }
    [StructLayout(LayoutKind.Sequential)] private struct SetState { public Header Header; public uint Value; }

    /// <summary>DISPLAYCONFIG_PATH_INFO, 72 bytes.</summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct PathInfo
    {
        public Luid SourceAdapter; public uint SourceId, SourceModeIndex, SourceStatus;
        public Luid TargetAdapter; public uint TargetId, TargetModeIndex, Technology, Rotation, Scaling;
        public uint RefreshNumerator, RefreshDenominator, ScanLineOrdering; public int TargetAvailable; public uint TargetStatus;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public int Size; public Rect Monitor, Work; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DevMode
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public ushort dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public uint dmFields;
        public int dmPositionX, dmPositionY; public uint dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public ushort dmLogPixels; public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public uint dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfoEx info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplaySettingsExW(string device, int mode, ref DevMode devMode, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettingsExW(string device, ref DevMode devMode, IntPtr window, uint flags, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettingsExW(string device, IntPtr devMode, IntPtr window, uint flags, IntPtr parameter);
    [DllImport("user32.dll")] private static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")] private static extern int QueryDisplayConfig(uint flags, ref uint pathCount, [Out] PathInfo[] paths, ref uint modeCount, [Out] byte[] modes, IntPtr topology);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref SourceName info);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref AdvancedColor info);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(ref AdvancedColor2 info);
    [DllImport("user32.dll")] private static extern int DisplayConfigSetDeviceInfo(ref SetState info);
}
