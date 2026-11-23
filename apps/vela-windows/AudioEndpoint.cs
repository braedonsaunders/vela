using System.Runtime.InteropServices;

namespace Vela.Windows;

/// <summary>What the WASAPI render endpoint accepts in exclusive mode: the IEC 61937 bitstreams its
/// HDMI sink (receiver or TV) declares in its EDID, and the PCM channels and rates it takes. Windows
/// derives these from the sink, so a "yes" here is the receiver's own claim. Nothing is opened or played.</summary>
internal sealed record AudioEndpointInfo(string[] Passthrough, int MaxChannels, int MaxSampleRate, int MixSampleRate, string Route)
{
    internal static readonly AudioEndpointInfo Unknown = new(Array.Empty<string>(), 2, 0, 0, "");

    /// <summary>Probes the default console endpoint, or the one with this WASAPI id (mpv's "wasapi/{id}").</summary>
    internal static AudioEndpointInfo Probe(string deviceId = "")
    {
        string id = deviceId.StartsWith("wasapi/", StringComparison.Ordinal) ? deviceId[7..] : deviceId;
        // mpv names a render endpoint by the GUID half of its id ("{0.0.0.00000000}.{guid}").
        if (id.StartsWith('{') && !id.Contains("}.{", StringComparison.Ordinal)) id = "{0.0.0.00000000}." + id;
        try { return ProbeDevice(id); }
        catch (Exception error) when (error is COMException or InvalidCastException or ArgumentException) { return Unknown; }
    }

    private static AudioEndpointInfo ProbeDevice(string id)
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice? device = null;
        IAudioClient? client = null;
        try
        {
            Check(id.Length > 0 ? enumerator.GetDevice(id, out device) : enumerator.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out device));
            var audioClient = typeof(IAudioClient).GUID;
            Check(device!.Activate(ref audioClient, 0x17 /* CLSCTX_ALL */, IntPtr.Zero, out var activated));
            client = (IAudioClient)activated;
            var passthrough = new List<string>();
            foreach (var (token, subtype, channels, rate) in Bitstreams)
                if (Supported(client, Format(subtype, channels, rate, 16, 16))) passthrough.Add(token);
            var (mixChannels, mixRate) = MixFormat(client);
            int maxChannels = mixChannels;
            if (Supported(client, Format(Pcm, 8, 48000, 32, 24))) maxChannels = Math.Max(maxChannels, 8);
            else if (Supported(client, Format(Pcm, 6, 48000, 32, 24))) maxChannels = Math.Max(maxChannels, 6);
            int maxRate = new[] { 384000, 192000, 176400, 96000, 88200, 48000, 44100 }
                .FirstOrDefault(rate => Supported(client, Format(Pcm, 2, rate, 32, 24)) || Supported(client, Format(Pcm, 2, rate, 24, 24)));
            return new(passthrough.ToArray(), Math.Max(2, maxChannels), maxRate, mixRate, RouteOf(device));
        }
        finally
        {
            if (client != null) Marshal.ReleaseComObject(client);
            if (device != null) Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
    }

    // IEC 61937 subtypes (ksmedia.h) and the burst each needs: AC-3/DTS at 48 kHz stereo, E-AC-3 at
    // 4×48 kHz, TrueHD and DTS-HD as 8-channel 192 kHz high-bit-rate audio. These match mpv's ao_wasapi.
    private static readonly Guid Pcm = new("00000001-0000-0010-8000-00aa00389b71");
    private static readonly (string Token, Guid Subtype, int Channels, int Rate)[] Bitstreams =
    {
        ("ac3", new("00000092-0000-0010-8000-00aa00389b71"), 2, 48000),
        ("dts", new("00000008-0000-0010-8000-00aa00389b71"), 2, 48000),
        ("eac3", new("0000000a-0cea-0010-8000-00aa00389b71"), 2, 192000),
        ("dts-hd", new("0000000b-0cea-0010-8000-00aa00389b71"), 8, 192000),
        ("truehd", new("0000000c-0cea-0010-8000-00aa00389b71"), 8, 192000),
    };

    /// <summary>WAVEFORMATEXTENSIBLE, 40 bytes, packed as mmreg.h lays it out.</summary>
    private static byte[] Format(Guid subtype, int channels, int rate, int bits, int validBits)
    {
        int block = channels * bits / 8;
        uint mask = channels switch { 2 => 0x3, 6 => 0x60F, 8 => 0x63F, _ => 0 };
        using var stream = new MemoryStream(40);
        using var writer = new BinaryWriter(stream);
        writer.Write((ushort)0xFFFE); writer.Write((ushort)channels); writer.Write(rate); writer.Write(rate * block);
        writer.Write((ushort)block); writer.Write((ushort)bits); writer.Write((ushort)22);
        writer.Write((ushort)validBits); writer.Write(mask); writer.Write(subtype.ToByteArray());
        return stream.ToArray();
    }

    private static bool Supported(IAudioClient client, byte[] format)
    {
        var buffer = Marshal.AllocCoTaskMem(format.Length);
        try
        {
            Marshal.Copy(format, 0, buffer, format.Length);
            return client.IsFormatSupported(1 /* AUDCLNT_SHAREMODE_EXCLUSIVE */, buffer, IntPtr.Zero) == 0;
        }
        finally { Marshal.FreeCoTaskMem(buffer); }
    }

    /// <summary>The shared-mode mixer's channels and rate (what non-exclusive PCM is converted to).</summary>
    private static (int Channels, int Rate) MixFormat(IAudioClient client)
    {
        if (client.GetMixFormat(out var mix) != 0 || mix == IntPtr.Zero) return (2, 0);
        try { return (Marshal.ReadInt16(mix, 2), Marshal.ReadInt32(mix, 4)); }
        finally { Marshal.FreeCoTaskMem(mix); }
    }

    /// <summary>PKEY_AudioEndpoint_FormFactor as the shared route vocabulary.</summary>
    private static string RouteOf(IMMDevice device)
    {
        if (device.OpenPropertyStore(0 /* STGM_READ */, out var store) != 0) return "";
        try
        {
            var key = new PropertyKey { Format = new("1da5d803-d492-4edd-8c23-e0c0ffee7f0e"), Id = 0 };
            if (store.GetValue(ref key, out var value) != 0 || value.Type != 19 /* VT_UI4 */) return "";
            return value.Value.ToInt64() switch
            {
                1 => "speaker", 2 => "other", 3 => "headphones", 5 => "headphones", 8 => "spdif",
                9 => "hdmi", 7 => "other", _ => "other",
            };
        }
        finally { Marshal.ReleaseComObject(store); }
    }

    private static void Check(int result) { if (result < 0) Marshal.ThrowExceptionForHR(result); }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig] int Initialize(int mode, int flags, long duration, long period, IntPtr format, IntPtr session);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint frames);
        [PreserveSig] int IsFormatSupported(int mode, IntPtr format, IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
    }

    [StructLayout(LayoutKind.Sequential)] private struct PropertyKey { public Guid Format; public int Id; }
    [StructLayout(LayoutKind.Sequential)] private struct PropVariant { public ushort Type; public ushort Reserved1, Reserved2, Reserved3; public IntPtr Value; public IntPtr Extra; }
}
