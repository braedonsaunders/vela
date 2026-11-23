namespace Vela.Windows;

internal static class Capabilities
{
    /// <summary>What this PC measured for negotiation: the page composes the codec lists from it
    /// (modules/vela-player/src/windows/mpv-format.ts). The flat fields remain for an older bundled page.</summary>
    internal static object Value(PlaybackSettings settings)
    {
        var audio = AudioEndpointInfo.Probe(settings.AudioDevice);
        var wanted = settings.WantedPassthrough();
        return new
        {
            containers = new[] { "mp4" },
            videoCodecs = new[] { "h264", "hevc", "vp9", "av1" },
            audioCodecs = new[] { "aac", "ac3", "eac3" },
            subtitleFormats = new[] { "webvtt", "srt", "ass", "ssa", "pgs", "tx3g" },
            hls = true,
            mse = false,
            originalPlayback = new
            {
                version = 1,
                range = true,
                webgpu = false,
                demuxContainers = new[] { "mkv", "webm", "mp4", "mpegts" },
                videoDecoders = new[] { "h264", "hevc", "vp9", "av1" },
                audioDecoders = new[] { "aac", "ac3", "eac3", "dts", "truehd", "flac", "alac", "opus",
                    "vorbis", "mp3", "mp2", "pcm_s16le", "pcm_s24le", "pcm_s32le" }
            },
            mpv = new
            {
                hdrDisplay = DisplayMatch.AnyHdrDisplay(),
                passthrough = audio.Passthrough.Where(wanted.Contains).ToArray(),
                maxChannels = audio.MaxChannels,
                // Shared mode resamples to the mixer's rate; exclusive mode opens the device at the source's own.
                maxSampleRate = (settings.Exclusive ? audio.MaxSampleRate : audio.MixSampleRate) is int rate && rate > 0 ? rate : (int?)null,
            }
        };
    }
}
