namespace Vela.Windows;

internal static class Capabilities
{
    // Software decoding is available through libmpv; HDR output is deliberately not advertised.
    internal static object Value => new
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
        }
    };
}
