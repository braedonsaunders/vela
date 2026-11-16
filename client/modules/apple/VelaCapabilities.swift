// What this Apple TV plays, declared to the server in the web probe's shape
// (client/player/media-capabilities.ts): the originals the native engine demuxes and decodes
// on the device, and what AVPlayer takes when the server must remux or convert.
import AVFoundation
import Foundation
import VideoToolbox

enum VelaCapabilities {
    /// Containers VelaMedia demuxes (Ether's family names).
    static let demuxContainers = ["mkv", "webm", "mp4", "mpegts"]
    /// Audio the engine renders: AC-3/E-AC-3 to tvOS compressed, the rest decoded by FFmpeg to PCM.
    static let audioDecoders = ["aac", "ac3", "eac3", "dts", "truehd", "mlp", "flac", "alac", "opus", "vorbis", "mp3", "mp2",
                                "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_s16be", "pcm_s24be", "pcm_f32le", "pcm_bluray", "pcm_dvd"]
    /// Subtitles the overlay draws: text (SubRip, WebVTT, tx3g, basic ASS) and bitmaps (PGS).
    static let subtitleFormats = ["webvtt", "ether-vtt-window", "srt", "ass", "ssa", "pgs", "tx3g"]

    static var videoDecoders: [String] {
        var codecs = ["h264"]
        if VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC) { codecs.append("hevc") }
        return codecs
    }

    static func json() -> String {
        let video = videoDecoders
        let value: [String: Any] = [
            "originalPlayback": [
                "version": 1, "range": true, "webgpu": false,
                "demuxContainers": demuxContainers, "videoDecoders": video, "audioDecoders": audioDecoders,
            ],
            // What AVPlayer plays from the server's HLS when an original cannot be used.
            "containers": ["mp4"],
            "videoCodecs": video,
            "audioCodecs": ["aac", "ac3", "eac3"],
            "subtitleFormats": subtitleFormats,
            "hls": true,
            "mse": false,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}
