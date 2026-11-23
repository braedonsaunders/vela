// Source → output facts for the info card (Snapshot.format, modules/vela-player/web/engine/format-info.ts),
// read from what AetherEngine, AVAudioSession and the display manager report. Nothing is inferred
// beyond what they say: an unknown stays out of the dictionary.
import AetherEngine
import AVFoundation
import Foundation

/// The display's matching state as the rendering host reads it (tvOS: AVDisplayManager).
struct DisplayMatch {
    /// The viewer's Match Content setting (tvOS combines frame rate and dynamic range in one flag).
    var enabled: Bool
    /// The engine asked the display for this content's mode.
    var requested: Bool
    var switching: Bool
}

@MainActor
enum PlaybackFormat {
    static func describe(_ engine: AetherEngine, preferences: PlaybackPreferences, display: DisplayMatch?) -> [String: Any] {
        [
            "video": videoSource(engine) as Any? ?? NSNull(),
            "videoOut": videoOutput(engine, preferences: preferences, display: display) as Any? ?? NSNull(),
            "audio": audioSource(engine) as Any? ?? NSNull(),
            "audioOut": audioOutput(engine, preferences: preferences) as Any? ?? NSNull(),
        ]
    }

    static func range(_ format: VideoFormat) -> String {
        switch format {
        case .sdr: return "sdr"
        case .hdr10: return "hdr10"
        case .hdr10Plus: return "hdr10+"
        case .dolbyVision: return "dv"
        case .hlg: return "hlg"
        }
    }

    private static func videoSource(_ engine: AetherEngine) -> [String: Any]? {
        guard let codec = engine.sourceVideoCodecName else { return nil }
        var out: [String: Any] = ["codec": codec]
        let stream = engine.sourceVideoStreamFormat
        if let profile = stream?.profile { out["profile"] = profile }
        if let depth = stream?.bitDepth { out["bitDepth"] = depth }
        if engine.sourceVideoWidth > 0, engine.sourceVideoHeight > 0 {
            out["width"] = Int(engine.sourceVideoWidth)
            out["height"] = Int(engine.sourceVideoHeight)
        }
        if let rate = engine.sourceVideoFrameRate, rate > 0 { out["frameRate"] = rate }
        // HDR10+ evidence latches on the published label while the source label keeps its primary format.
        var source = engine.sourceVideoFormat
        if source == .hdr10, engine.videoFormat == .hdr10Plus { source = .hdr10Plus }
        out["range"] = range(source)
        if let profile = engine.sourceDVProfile { out["dvProfile"] = String(profile) }
        switch engine.sourceVideoScan {
        case .interlaced: out["interlaced"] = true
        case .progressive: out["interlaced"] = false
        case .unknown: break
        }
        return out
    }

    private static func videoOutput(_ engine: AetherEngine, preferences: PlaybackPreferences, display: DisplayMatch?) -> [String: Any]? {
        guard engine.sourceVideoCodecName != nil, engine.playbackBackend != .audio else { return nil }
        var out: [String: Any] = ["range": range(engine.videoFormat)]
        if engine.sourceVideoFormat == .dolbyVision {
            if engine.videoFormat == .dolbyVision {
                if engine.dolbyVisionConversion == .profile7ToProfile81 {
                    out["dvProfile"] = "8.1"
                    out["dvConversion"] = "p7-to-8.1"
                } else if let profile = engine.sourceDVProfile {
                    out["dvProfile"] = String(profile)
                }
            } else {
                // The display or the viewer's choice took the HDR10/HLG base layer.
                out["dvConversion"] = "base-layer"
            }
        }
        switch engine.playbackBackend {
        case .software: out["decoder"] = "software"
        case .native, .aether: out["decoder"] = "hardware"
        default: break
        }
        if let label = engine.activeVideoDecoder {
            out["decoderName"] = label
            if label.hasSuffix("(SW)") { out["decoder"] = "software" } else if label.hasSuffix("(HW)") { out["decoder"] = "hardware" }
        }
        if engine.decodedVideoFormat?.deinterlace != nil { out["deinterlaced"] = true }
        if let display {
            let state = !display.enabled ? "off" : display.switching ? "unmatched" : display.requested ? "matched" : "unmatched"
            out["frameRateMatch"] = state
            out["rangeMatch"] = state
        } else {
            out["frameRateMatch"] = "unsupported"
            out["rangeMatch"] = "unsupported"
        }
        return out
    }

    private static func activeTrack(_ engine: AetherEngine) -> TrackInfo? {
        guard let index = engine.activeAudioTrackIndex else { return nil }
        return engine.audioTracks.first { $0.id == index }
    }

    private static func immersive(_ track: TrackInfo) -> String? {
        let profile = track.profile?.lowercased() ?? ""
        if track.isAtmos || track.trueHDAtmos == .atmos || profile.contains("atmos") { return "atmos" }
        if track.isDTSX || profile.contains("dts:x") { return "dtsx" }
        return nil
    }

    private static func audioSource(_ engine: AetherEngine) -> [String: Any]? {
        guard let track = activeTrack(engine) else { return nil }
        // libavcodec names DTS "dca"; the shared vocabulary says "dts".
        var out: [String: Any] = ["codec": track.codec == "dca" ? "dts" : track.codec]
        if let profile = track.profile { out["profile"] = profile } else if track.isAtmos { out["profile"] = "E-AC-3 + JOC" }
        if track.channels > 0 { out["channels"] = track.channels }
        if let layout = track.channelLayout { out["layout"] = layout }
        if track.sampleRate > 0 { out["sampleRate"] = track.sampleRate }
        if track.bitsPerSample > 0 { out["bitDepth"] = track.bitsPerSample }
        if let immersive = immersive(track) { out["immersive"] = immersive }
        if let language = track.language { out["language"] = language }
        return out
    }

    private static let losslessCodecs: Set<String> = ["truehd", "mlp", "flac", "alac", "wavpack", "tta", "ape"]

    private static func isLossless(_ track: TrackInfo) -> Bool {
        if losslessCodecs.contains(track.codec) || track.codec.hasPrefix("pcm_") { return true }
        // DTS-HD Master Audio (and DTS:X, which rides on it); core, ES, 96/24 and High Resolution are lossy.
        return ["dts", "dca"].contains(track.codec) && (track.profile?.contains("MA") ?? false)
    }

    private static func audioOutput(_ engine: AetherEngine, preferences: PlaybackPreferences) -> [String: Any]? {
        guard let track = activeTrack(engine) else { return nil }
        var out: [String: Any] = [:]
        let route = currentRoute()
        if let kind = route.kind { out["route"] = kind }
        let objects = engine.liveTelemetry?.objectAudio
        if let layout = objects?.layout ?? renderedLayout(engine.activeAudioDecoder) {
            // TrueHD Atmos or DTS:X rendered into a bed with heights; tvOS carries it to the receiver as Dolby MAT.
            out["delivery"] = "rendered"
            out["codec"] = engine.activeAudioDecoder?.contains("APAC") == true || route.kind == "airplay" ? "apac" : "pcm"
            out["layout"] = layout.rawValue
            out["channels"] = layout.speakers.count
            out["sampleRate"] = 48_000
            out["bitDepth"] = 24
            out["immersive"] = immersive(track) ?? "atmos"
            if let objects { out["objectsActive"] = objects.activeObjects }
            out["lossless"] = false
        } else {
            switch engine.audioDelivery {
            case .streamCopy where ["ac3", "eac3"].contains(track.codec):
                // AVPlayer forwards the Dolby bitstream; tvOS decides whether it reaches HDMI as DD, DD+ or MAT.
                out["delivery"] = "passthrough"
                out["codec"] = track.codec
                if track.channels > 0 { out["channels"] = track.channels }
                if track.isAtmos { out["immersive"] = "atmos" }
                out["lossless"] = true
            case .streamCopy, .decoded:
                out["delivery"] = "decoded"
                out["codec"] = "pcm"
                if track.channels > 0 { out["channels"] = track.channels }
                if track.sampleRate > 0 { out["sampleRate"] = track.sampleRate }
                out["lossless"] = isLossless(track)
            case .bridged:
                if preferences.surround == .compatible && track.channels > 2 {
                    out["delivery"] = "transcoded"
                    out["codec"] = "eac3"
                    out["channels"] = min(track.channels, 6)
                    out["sampleRate"] = min(track.sampleRate > 0 ? track.sampleRate : 48_000, 48_000)
                    out["lossless"] = false
                    if track.channels > 6 { out["downmixed"] = true }
                    if track.sampleRate > 48_000 { out["resampled"] = true }
                } else {
                    // The FLAC bridge: bit-perfect up to 7.1 at the source rate, decoded to LPCM by the system.
                    out["delivery"] = "decoded"
                    out["codec"] = "pcm"
                    if track.channels > 0 { out["channels"] = min(track.channels, 8) }
                    if track.sampleRate > 0 { out["sampleRate"] = track.sampleRate }
                    if track.bitsPerSample > 0 { out["bitDepth"] = track.bitsPerSample }
                    out["lossless"] = isLossless(track)
                    if track.channels > 8 { out["downmixed"] = true }
                }
            case .playerManaged:
                out["delivery"] = "system"
            default:
                return nil
            }
        }
        if let label = engine.activeAudioDecoder { out["decoderName"] = label }
        // Only the OS's own word: a Dolby Atmos rendering mode on HDMI travels as Dolby MAT.
        if route.atmos {
            out["immersive"] = out["immersive"] ?? "atmos"
            if route.kind == "hdmi" { out["carrier"] = "mat" }
        }
        return out
    }

    /// The bed named by the engine's audio label ("TRUEHD Atmos → PCM 7.1.4"), for when the 1 Hz telemetry
    /// has no object activity yet (or is not sampling on this route).
    static func renderedLayout(_ label: String?) -> SpatialSpeakerLayout? {
        guard let label, let arrow = label.range(of: "→") else { return nil }
        let tail = label[arrow.upperBound...]
        guard tail.contains("PCM") || tail.contains("APAC") else { return nil }
        return SpatialSpeakerLayout.allCases.first { tail.hasSuffix($0.rawValue) || tail.contains(" \($0.rawValue)") }
    }

    private struct Route {
        var kind: String?
        var atmos = false
    }

    private static func currentRoute() -> Route {
        #if os(iOS) || os(tvOS)
        let session = AVAudioSession.sharedInstance()
        var route = Route()
        if let port = session.currentRoute.outputs.first?.portType {
            switch port {
            case .HDMI: route.kind = "hdmi"
            case .airPlay: route.kind = "airplay"
            case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP: route.kind = "bluetooth"
            case .builtInSpeaker, .builtInReceiver: route.kind = "speaker"
            case .headphones: route.kind = "headphones"
            case .usbAudio: route.kind = "usb"
            default: route.kind = "other"
            }
        }
        if #available(iOS 17.2, tvOS 17.2, *) { route.atmos = session.renderingMode == .dolbyAtmos }
        return route
        #else
        return Route()
        #endif
    }
}
