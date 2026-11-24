// What the engine reports about the file playing, kept from its observed properties.
import Foundation

struct PlayerState {
    enum Phase: String {
        case idle, loading, playing, paused, buffering, ended, failed
    }

    var loaded = false
    var hasFrame = false
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
    /// Grows while loading gets somewhere (PlaybackClient.loadProgress).
    var loadProgress: Int64?
    var droppedFrames: Int64?
    var tracks: [[String: Any]] = []
    var audioId: Int64?
    var subtitleId: Int64?
    var videoParams: [String: Any] = [:]
    var frameRate: Double?
    var videoCodec: String?
    var audioCodec: String?
    /// Source → output facts (Snapshot.format).
    var format: [String: Any]?
    var subtitleOffset = 0.0
    /// A live stream's retained window (`live-window`), on the same axis as `position`.
    var live: LiveWindowReading?
    /// The connection to a live stream was lost and is being re-established (`reconnecting`).
    var reconnecting = false
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

    /// The position is at the file's end. the engine also raises `eof-reached` for a moment while it
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
        case "video-pts": hasFrame = value is Double
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
        case "format": format = value as? [String: Any]
        case "sub-delay": subtitleOffset = value as? Double ?? 0
        case "live-window": live = value as? LiveWindowReading
        case "reconnecting": reconnecting = value as? Bool ?? false
        default: break
        }
    }

    /// The the engine track id of a source stream (FFmpeg stream index), for `aid` and `sid`.
    func trackId(type: String, streamIndex: Int) -> Int64? {
        let track = tracks.first { track in
            track["type"] as? String == type && (track["ff-index"] as? Int64).map(Int.init) == streamIndex
        }
        return track?["id"] as? Int64
    }

    /// The source stream index (FFmpeg) of the selected the engine track.
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

}

/// A live stream's retained window as the engine reports it, on the same axis as `time-pos`.
struct LiveWindowReading: Equatable {
    /// The oldest position that can be played; nil when the stream keeps no history (live only).
    var start: Double?
    /// The newest position that can be played: the end of the seekable range.
    var edge: Double?
    /// How far behind the edge playback normally sits (the player's live latency target).
    var latency: Double
    /// The segment duration: the edge advances by about this much at a time.
    var segment: Double
    /// LiveSnapshot.edgeSource: `seekable` (AVPlayer's seekable ranges) or `playlist` (Aether's own window).
    var source: String
}

/// Live timeshift arithmetic for the snapshot and the commands. The same rules as the web player
/// (modules/vela-player/web/engine/live-behind.ts and host/live.ts).
enum LiveTimeline {
    /// Seconds playback trails its usual live position (the edge less the latency target), or nil when
    /// that cannot be told: no edge, or a position before the window (where the player is about to be put).
    static func lag(_ window: LiveWindowReading, position: Double) -> Double? {
        guard let edge = window.edge, position.isFinite else { return nil }
        if let start = window.start, position < start - 1 { return nil }
        return max(0, edge - window.latency - position)
    }

    /// Whether playback is behind live in a way the viewer should be told about: at least 10 s (or two
    /// segments when segments are longer), and once behind, until back within 3 s, so it cannot flicker.
    static func behind(lag: Double?, wasBehind: Bool, segment: Double) -> Bool {
        guard let lag else { return false }
        return wasBehind ? lag > 3 : lag >= max(10, 2 * segment)
    }

    /// Where catching up to live lands: the edge less the latency target, inside the window. Nil when
    /// that is not ahead of `position`, so there is nothing newer to go to.
    static func catchUpTarget(_ window: LiveWindowReading, position: Double) -> Double? {
        guard let edge = window.edge else { return nil }
        var target = edge - window.latency
        if let start = window.start {
            guard edge - start >= 0.25 else { return nil }
            target = max(start + 0.05, target)
        }
        return target > position + 0.25 ? min(target, edge - 0.1) : nil
    }

    /// A seek target held inside the window, short of the edge by a second; nil without a window to seek in.
    static func clamp(_ seconds: Double, in window: LiveWindowReading) -> Double? {
        guard seconds.isFinite, let start = window.start, let edge = window.edge, edge >= start else { return nil }
        return min(max(seconds, start), max(start, edge - 1))
    }

    /// Where a paused live stream resumes when the window slid past its position meanwhile: a little
    /// inside the window's start, so the next slide does not take it again at once. Nil when still inside.
    static func resumeTarget(_ window: LiveWindowReading, position: Double) -> Double? {
        guard let start = window.start, let edge = window.edge, position < start else { return nil }
        return start + min(5, max(0, edge - 1 - start))
    }
}

/// Whether what the engine calls playing is moving on screen, and the position to report. The engine's
/// clock is not proof: the software route's synchronizer keeps its rate through a starved queue, so the
/// clock runs on over a frozen picture (a 40 kbit/s start reported 12 s → 67 s over a picture stuck at
/// 12.25 s), and a clock can stand still while the engine still says it plays. Starved, playback is
/// reported as buffering at the picture's position, so the session's stall policy sees no movement and
/// counts only the bytes that keep arriving (loadProgress) and frames that are presented.
struct PresentationProgress {
    /// How far the clock may run past the newest decoded frame before the picture counts as frozen.
    static let frameSlack = 0.75
    /// How long a clock that claims to play may stand still before it counts as starved.
    static let stillSeconds = 1.5

    struct Reading {
        /// The engine's clock (`time-pos`, the display axis) and the same instant on the source axis.
        var clock: Double
        var sourceClock: Double
        /// Wall-clock seconds.
        var now: Double
        /// The engine is playing, not paused, ended or idle.
        var playing: Bool
        var seeking: Bool
        /// The engine itself says it is waiting (buffering, reconnecting, reloading).
        var waiting: Bool
        /// The route reports its video frames (software and loopback; not remote HLS or audio only).
        var framesExpected: Bool
        /// The newest video frame decoded for the current run (source axis), or nil before the first.
        var newestFrame: Double?
    }

    private var lastClock: Double?
    private var clockMovedAt: Double?
    /// Where this run's clock started, for a picture that has not shown a first frame yet.
    private var startClock: Double?
    /// The position last reported.
    private(set) var position: Double?

    /// A new source or a reload: nothing is known about its picture. A reload keeps the position it
    /// reports until its picture moves.
    mutating func reset(keepingPosition: Bool = false) {
        let kept = keepingPosition ? position : nil
        self = Self()
        position = kept
    }

    /// Starved, and the position to report: where the picture is, never ahead of it and never back.
    mutating func observe(_ reading: Reading) -> (starved: Bool, position: Double) {
        let clock = reading.clock
        guard clock.isFinite else { return (reading.waiting, position ?? 0) }
        defer { lastClock = clock }
        if !reading.playing || reading.seeking {
            // Paused, ended or seeking: the clock is the position (a seek's target), and the next
            // run's wait starts when it plays again.
            clockMovedAt = reading.now
            startClock = nil
            position = clock
            return (reading.waiting && reading.playing, clock)
        }
        if lastClock == nil || abs(clock - (lastClock ?? clock)) > 0.01 || clockMovedAt == nil { clockMovedAt = reading.now }
        if startClock == nil { startClock = reading.sourceClock }
        let still = reading.now - (clockMovedAt ?? reading.now) >= Self.stillSeconds
        // On the clock's own axis: the picture shows the newest frame decoded, at most the clock.
        let shift = clock - reading.sourceClock
        var picture: Double?
        var frozen = false
        if reading.framesExpected {
            if let frame = reading.newestFrame, frame.isFinite {
                frozen = reading.sourceClock > frame + Self.frameSlack
                picture = min(clock, frame + shift)
            } else if let start = startClock {
                frozen = reading.sourceClock > start + Self.frameSlack
                picture = start + shift
            }
        }
        let starved = reading.waiting || still || frozen
        guard starved else {
            position = clock
            return (false, clock)
        }
        let held = position ?? picture ?? clock
        let next = max(held, min(picture ?? held, clock))
        position = next
        return (true, next)
    }
}
