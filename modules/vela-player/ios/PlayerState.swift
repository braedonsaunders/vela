// What mpv reports about the file playing, kept from its observed properties.
import Foundation
import Libmpv

struct PlayerState {
    enum Phase: String {
        case idle, loading, playing, paused, buffering, ended, failed
    }

    var loaded = false
    var position: Double = 0
    var duration: Double?
    var paused = true
    var pausedForCache = false
    var seeking = false
    var endReached = false
    /// Seconds of media read ahead of the position.
    var cacheAhead: Double?
    /// Bytes per second the cache fills at.
    var cacheSpeed: Int64?
    var droppedFrames: Int64?
    var tracks: [[String: Any]] = []
    var audioId: Int64?
    var subtitleId: Int64?
    var videoParams: [String: Any] = [:]
    var frameRate: Double?
    var videoCodec: String?
    var audioCodec: String?
    var failure: String?
    var failureKind = "source"

    var phase: Phase {
        if failure != nil {
            return .failed
        }
        if !loaded {
            return .loading
        }
        if endReached && atEnd {
            return .ended
        }
        if pausedForCache || seeking {
            return .buffering
        }
        return paused ? .paused : .playing
    }

    /// The position is at the file's end. mpv also raises `eof-reached` for a moment while it
    /// switches tracks on a network stream; reporting that as `ended` makes Ether end the session.
    var atEnd: Bool {
        guard let duration else {
            return false
        }
        return position >= duration - 1.5
    }

    /// Applies one observed property's new value.
    mutating func update(_ name: String, _ value: Any?) {
        switch name {
        case "time-pos": position = value as? Double ?? position
        case "duration": duration = value as? Double
        case "pause": paused = value as? Bool ?? paused
        case "paused-for-cache": pausedForCache = value as? Bool ?? false
        case "seeking": seeking = value as? Bool ?? false
        case "eof-reached": endReached = value as? Bool ?? false
        case "demuxer-cache-time": cacheAhead = (value as? Double).map { max(0, $0 - position) }
        case "cache-speed": cacheSpeed = value as? Int64
        case "frame-drop-count": droppedFrames = value as? Int64
        case "track-list": tracks = value as? [[String: Any]] ?? []
        case "aid": audioId = value as? Int64
        case "sid": subtitleId = value as? Int64
        case "video-params": videoParams = value as? [String: Any] ?? [:]
        case "container-fps": frameRate = value as? Double
        case "video-codec-name": videoCodec = value as? String
        case "audio-codec-name": audioCodec = value as? String
        default: break
        }
    }

    /// The mpv track id of a source stream (FFmpeg stream index), for `aid` and `sid`.
    func trackId(type: String, streamIndex: Int) -> Int64? {
        let track = tracks.first { track in
            track["type"] as? String == type && (track["ff-index"] as? Int64).map(Int.init) == streamIndex
        }
        return track?["id"] as? Int64
    }

    /// The source stream index (FFmpeg) of the selected mpv track.
    func streamIndex(type: String, id: Int64?) -> Int? {
        guard let id else {
            return nil
        }
        let track = tracks.first { $0["type"] as? String == type && $0["id"] as? Int64 == id }
        return (track?["ff-index"] as? Int64).map(Int.init)
    }

    /// sdr, hdr10, hlg or dv from the decoded video's parameters.
    var dynamicRange: String? {
        guard let gamma = videoParams["gamma"] as? String else {
            return nil
        }
        if videoParams["dovi"] != nil || (videoParams["light"] as? String) == "dolby-vision" {
            return "dv"
        }
        switch gamma {
        case "pq": return "hdr10"
        case "hlg": return "hlg"
        default: return "sdr"
        }
    }

    /// Properties the view observes, with the format each is read in.
    static let observed: [(name: String, format: mpv_format)] = [
        ("time-pos", MPV_FORMAT_DOUBLE),
        ("duration", MPV_FORMAT_DOUBLE),
        ("pause", MPV_FORMAT_FLAG),
        ("paused-for-cache", MPV_FORMAT_FLAG),
        ("seeking", MPV_FORMAT_FLAG),
        ("eof-reached", MPV_FORMAT_FLAG),
        ("demuxer-cache-time", MPV_FORMAT_DOUBLE),
        ("cache-speed", MPV_FORMAT_INT64),
        ("frame-drop-count", MPV_FORMAT_INT64),
        ("track-list", MPV_FORMAT_NODE),
        ("aid", MPV_FORMAT_INT64),
        ("sid", MPV_FORMAT_INT64),
        ("video-params", MPV_FORMAT_NODE),
        ("container-fps", MPV_FORMAT_DOUBLE),
        ("video-codec-name", MPV_FORMAT_STRING),
        ("audio-codec-name", MPV_FORMAT_STRING),
    ]
}
