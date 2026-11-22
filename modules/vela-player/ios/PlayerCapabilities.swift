// What this device's AetherEngine plays, declared to the server (packages/player-api PlayerCapabilities,
// vocabulary in packages/protocol/README.md). The server's HLS may carry only what VideoToolbox decodes in
// hardware; an original file may also use AetherEngine's software decoders where they keep up in real time
// (AV1 does not at 4K on an Apple TV, so AV1 is claimed only with a hardware decoder). Audio and subtitles
// are all decoded on the device.
import AetherEngine
import AVFoundation
#if os(macOS)
import AppKit
#endif
import CoreMedia
import VideoToolbox

enum PlayerCapabilities {
    /// Software decoders for codecs whose content tops out at 1080p, which AetherEngine decodes in real time.
    static let softwareVideo = ["mpeg2video", "mpeg4", "vc1", "wmv3", "vp8", "h263", "mpeg1video", "msmpeg4v3", "theora"]
    static let audioDecoders = [
        "aac", "ac3", "eac3", "dts", "truehd", "mlp", "flac", "alac", "opus", "vorbis", "mp3", "mp2", "mp1",
        "pcm_s16le", "pcm_s16be", "pcm_s24le", "pcm_s24be", "pcm_s32le", "pcm_f32le", "pcm_bluray", "pcm_dvd",
        "pcm_alaw", "pcm_mulaw", "wmav2", "wmapro", "wmalossless",
    ]

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
        #if os(macOS)
        let hdrDisplay = NSScreen.screens.contains { $0.maximumPotentialExtendedDynamicRangeColorComponentValue > 1 }
        var hdr: [String] = hdrDisplay ? ["hdr10", "hlg"] : []
        let dolbyVision = false
        #else
        let modes = AVPlayer.availableHDRModes
        let hdrModes: [(AVPlayer.HDRMode, String)] = [(.hdr10, "hdr10"), (.hlg, "hlg"), (.dolbyVision, "dv")]
        var hdr = hdrModes.filter { modes.contains($0.0) }.map(\.1)
        let dolbyVision = modes.contains(.dolbyVision)
        #endif
        // HDR10+ metadata reaches the display with the stream; a panel without HDR10+ shows its HDR10 base.
        if hdr.contains("hdr10") { hdr.insert("hdr10+", at: 1) }
        var out: [String: Any] = [
            // What the server's HLS may carry when an original cannot be played.
            "containers": ["mp4"],
            "videoCodecs": video,
            "audioCodecs": ["aac", "ac3", "eac3"],
            "subtitleFormats": ["webvtt", "srt", "ass", "ssa", "pgs", "tx3g", "dvbsub", "dvdsub"],
            "hdr": hdr,
            "hls": true,
            "mse": false,
            "originalPlayback": [
                "version": 1,
                "range": true,
                "webgpu": false,
                "demuxContainers": ["mkv", "webm", "mp4", "mov", "mpegts", "m2ts", "avi", "ogg", "flv", "asf", "rm", "mpegps"],
                "videoDecoders": video + softwareVideo,
                "audioDecoders": audioDecoders,
            ],
            "audioOutput": audioOutput(),
        ]
        // Profile 7 is converted to 8.1 by the engine. Without a Dolby Vision display, AVPlayer still composes
        // Profile 5 (it has no other base layer), and the Mac applies every RPU to its EDR output.
        if dolbyVision {
            out["dolbyVisionProfiles"] = ["5", "7", "8.1", "8.4"]
        } else {
            #if os(macOS)
            out["dolbyVisionReshape"] = ["5", "7", "8.1", "8.4"]
            #else
            out["dolbyVisionReshape"] = ["5"]
            #endif
        }
        return out
    }

    /// The viewer's delivery choices at probe time decide what is lossless and what keeps its heights.
    private static func audioOutput() -> [String: Any] {
        let preferences = PlaybackPreferences.current
        let objects = PlaybackPreferences.objectAudioBuiltIn && preferences.immersive == .on
        var immersive = ["eac3-joc"]
        if objects {
            if AetherEngine.OptionalComponent.trueHDObjectAudio.isBuiltIn { immersive.append("truehd-atmos") }
            if AetherEngine.OptionalComponent.dtsxObjectAudio.isBuiltIn { immersive.append("dtsx") }
        }
        let ceiling = objects ? preferences.speakerLayout.speakers.count : 8
        // Not clamped to the route: before the audio session is active it reports stereo, and the system folds
        // multichannel down itself (spatial audio on iPhone, the receiver's own map on HDMI).
        #if os(macOS)
        let passthrough: [String] = []
        #else
        // AVPlayer hands Dolby bitstreams to the system, which forwards them (E-AC-3 JOC as Dolby MAT).
        let passthrough = ["ac3", "eac3", "eac3-joc"]
        #endif
        return [
            "passthrough": passthrough,
            "immersive": immersive,
            "maxChannels": ceiling,
            "lossless": preferences.surround == .lossless,
        ]
    }
}
