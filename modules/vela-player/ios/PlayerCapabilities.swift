// What this device's AetherEngine plays, declared to the server (packages/player-api PlayerCapabilities).
// Video is what VideoToolbox decodes in hardware (AetherEngine's software decoders could take the rest, but
// not at 4K in real time on an Apple TV); audio and subtitles are all decoded on the device.
import AVFoundation
#if os(macOS)
import AppKit
#endif
import CoreMedia
import VideoToolbox

enum PlayerCapabilities {
    static func probe() -> [String: Any] {
        var video = ["h264"]
        if VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC) {
            video.append("hevc")
        }
        if VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1) {
            video.append("av1")
        }
        if VTIsHardwareDecodeSupported(kCMVideoCodecType_VP9) {
            video.append("vp9")
        }
        let audio = [
            "aac", "ac3", "eac3", "dts", "truehd", "mlp", "flac", "alac", "opus", "vorbis", "mp3", "mp2",
            "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_bluray", "pcm_dvd",
        ]
        #if os(macOS)
        let hdr: [String] = NSScreen.screens.contains { $0.maximumPotentialExtendedDynamicRangeColorComponentValue > 1 } ? ["hdr10", "hlg"] : []
        #else
        let modes = AVPlayer.availableHDRModes
        let hdrModes: [(AVPlayer.HDRMode, String)] = [(.hdr10, "hdr10"), (.hlg, "hlg"), (.dolbyVision, "dv")]
        let hdr = hdrModes.filter { modes.contains($0.0) }.map(\.1)
        #endif
        return [
            // What the server's HLS may carry when an original cannot be played.
            "containers": ["mp4"],
            "videoCodecs": video,
            "audioCodecs": ["aac", "ac3", "eac3"],
            "subtitleFormats": ["webvtt", "srt", "ass", "ssa", "pgs", "tx3g"],
            "hdr": hdr,
            "hls": true,
            "mse": false,
            "originalPlayback": [
                "version": 1,
                "range": true,
                "webgpu": false,
                "demuxContainers": ["mkv", "webm", "mp4", "mpegts"],
                "videoDecoders": video,
                "audioDecoders": audio,
            ],
        ]
    }
}
