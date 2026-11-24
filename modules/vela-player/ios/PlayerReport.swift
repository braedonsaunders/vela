// The contract's events in modules/vela-player/web/engine/model.ts shapes: snapshots (at most four a second, and on
// every state change), observations (at most one a second, at least one every ten), errors and command results.
import Foundation

final class PlayerReport {
    var pathId = ""
    var audioTrackId: String?
    var subtitleTrackId: String?
    var audioClientOnly = false
    var subtitleClientOnly = false
    var backend: String?
    var volume: Double = 1
    var muted = false
    var waitForFrame = false
    /// A picture-in-picture window can be opened for the playing title (PictureInPicture.available).
    var pip = false
    /// The viewer's playback speed, kept across sources as the web player keeps it; live reports 1×.
    var speed: Double = 1
    /// The web player's speeds (modules/vela-player/web/engine/host/telemetry.ts): AetherEngine caps video at 2×.
    static let speeds: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

    private let emitSnapshot: ([String: Any]) -> Void
    private let emitObservation: ([String: Any]) -> Void
    private let emitError: ([String: Any]) -> Void
    private let emitSessionCommand: ([String: Any]) -> Void
    private var plan: VelaPlan?
    private var sequence = 0
    private var lastSnapshot = Date.distantPast
    private var lastPhase = ""
    private var lastObservation = Date.distantPast
    private var endedReported = ""
    private var failureReported = ""
    /// Playback is behind live enough to tell the viewer (LiveTimeline.behind), held between snapshots.
    private var liveBehind = false

    init(
        snapshot: @escaping ([String: Any]) -> Void,
        observation: @escaping ([String: Any]) -> Void,
        error: @escaping ([String: Any]) -> Void,
        sessionCommand: @escaping ([String: Any]) -> Void
    ) {
        emitSnapshot = snapshot
        emitObservation = observation
        emitError = error
        emitSessionCommand = sessionCommand
    }

    /// Asks the playback controller to apply a session command (packages/protocol SessionCommand) for the
    /// current generations; it answers with a newer plan.
    func sessionCommand(_ fields: [String: Any]) {
        guard let plan else {
            return
        }
        var command = fields
        command["sourceGeneration"] = plan.sourceGeneration
        command["seekGeneration"] = plan.seekGeneration
        command["idempotencyKey"] = UUID().uuidString.lowercased()
        emitSessionCommand(["sessionId": plan.sessionId, "command": command])
    }

    /// A newer plan: the server's track choices, unless the viewer made their own on the device.
    func adopt(_ plan: VelaPlan, newSession: Bool) {
        self.plan = plan
        if newSession {
            audioClientOnly = false
            subtitleClientOnly = false
            sequence = 0
            liveBehind = false
        }
        if !audioClientOnly {
            audioTrackId = plan.selectedAudioTrackId
        }
        if !subtitleClientOnly {
            subtitleTrackId = plan.selectedSubtitleTrackId
        }
    }

    /// The viewer's own subtitle choice, applied in the player: later plans of this session keep it.
    func chooseSubtitle(_ id: String?) {
        subtitleTrackId = id
        subtitleClientOnly = true
    }

    /// A subtitle choice the server applies (a track it delivers over its HLS, or one the file does not carry):
    /// shown as chosen meanwhile, and from here on the report follows the server's selection again, not a choice
    /// the viewer made on the device before.
    func requestSubtitle(_ id: String?) {
        subtitleTrackId = id
        subtitleClientOnly = false
    }

    func failure(kind: String, message: String, recoverable: Bool) {
        emitError(["kind": kind, "message": message, "recoverable": recoverable])
    }

    /// Reports the state: a snapshot when due or when the phase changed, an observation when due.
    func publish(_ state: PlayerState, seekTarget: Double?, force: Bool = false) {
        guard let plan else {
            return
        }
        let phase = waitForFrame && state.phase == .playing && !state.hasFrame ? "loading"
            : seekTarget != nil && state.phase == .loading ? "buffering" : state.phase.rawValue
        let changed = phase != lastPhase
        if force || changed || Date().timeIntervalSince(lastSnapshot) >= 0.25 {
            lastSnapshot = Date()
            lastPhase = phase
            emitSnapshot(snapshot(plan, state, phase: phase, seekTarget: seekTarget))
        }
        if let failure = state.failure {
            let key = "\(plan.sessionId):\(plan.sourceGeneration):\(plan.seekGeneration):\(failure)"
            if key != failureReported {
                failureReported = key
                self.failure(kind: state.failureKind, message: failure, recoverable: false)
                observe(plan, state, force: true)
                return
            }
        }
        observe(plan, state, force: false)
    }

    // MARK: Snapshot

    private func snapshot(_ plan: VelaPlan, _ state: PlayerState, phase: String, seekTarget: Double?) -> [String: Any] {
        var out: [String: Any] = [
            "sessionId": plan.sessionId,
            "sourceGeneration": plan.sourceGeneration,
            "seekGeneration": plan.seekGeneration,
            "state": phase,
            "capabilities": ["pip": pip, "fullscreen": false, "audioSwitch": true],
            "qualityIds": [String](),
            "renditions": [Any](),
            "audioTracks": plan.audioTracks.map(\.snapshot),
            "subtitleTracks": plan.subtitleTracks.map(\.snapshot) + state.tracks.compactMap { track -> [String: Any]? in
                guard plan.selectedPath?.isOriginalFile == true, track["type"] as? String == "sub", track["external"] as? Bool != true,
                      let id = track["id"] as? Int64 else { return nil }
                let index = (track["ff-index"] as? Int64).map(Int.init)
                if let index, plan.subtitleTracks.contains(where: { $0.streamIndex == index }) { return nil }
                return ["id": "mpv-sub-\(id)", "label": track["title"] as? String ?? track["lang"] as? String ?? "Subtitle \(id)",
                        "language": track["lang"] as? String ?? "und", "codec": track["codec"] as? String ?? ""]
            },
            "audioTrackIds": plan.audioTracks.map(\.id),
            "chapters": (plan.chapters ?? []).map(\.snapshot),
            "throughputHistory": state.cacheSpeed.map { [Double($0 * 8)] } ?? [],
            // Live speed is managed by the player, as on the web: no choices, always 1×.
            "speed": plan.isLive ? 1 : speed,
            "speeds": plan.isLive ? [Double]() : Self.speeds,
            "subtitleStyleAvailable": SubtitleAppearance.honoured,
            "subtitleClientOnly": subtitleClientOnly,
            "audioClientOnly": audioClientOnly,
            "outputPreferences": PlaybackPreferences.current.values,
            "outputPreferencesAvailable": PlaybackPreferences.available,
            "diagnostics": [
                "implementation": "vela-aether",
                "metadataDiscrepancies": [String](),
            ],
            "waiting": phase == "loading" || phase == "buffering",
            "volume": volume,
            "muted": muted,
            "position": seekTarget ?? state.position,
            "playable": playable(state).map { ["start": $0.start, "end": $0.end] },
        ]
        let observedAudio = plan.audioTracks.first { $0.streamIndex != nil && $0.streamIndex == state.streamIndex(type: "audio", id: state.audioId) }?.id
        let optional: [String: Any?] = [
            "sourceId": pathId.isEmpty ? nil : pathId,
            "strategy": plan.paths.first { $0.id == pathId }?.kind,
            "backend": backend,
            "renditionId": nil,
            "lockedQuality": nil,
            "video": video(state),
            "format": state.format,
            "currentBitrateBps": nil,
            "requiredBandwidthBps": nil,
            "bufferAheadSeconds": state.cacheAhead,
            "loadProgress": state.loadProgress,
            "pendingSubtitleTrackId": nil,
            "subtitleError": nil,
            "subtitleStyle": SubtitleAppearance.current.snapshot.merging(["offsetSeconds": state.subtitleOffset]) { $1 },
            "live": plan.isLive ? live(state, seekTarget: seekTarget) : nil,
            "seekTarget": seekTarget,
            "preparation": phase == "loading" ? (state.tracks.isEmpty ? "media-metadata" : "initial-buffer") : nil,
            "duration": plan.isLive ? nil : state.duration,
            "throughputBps": state.cacheSpeed.map { Double($0 * 8) },
            "droppedFrames": state.droppedFrames,
            "totalFrames": nil,
            "audioTrackId": audioTrackId ?? observedAudio,
            "pendingAudioTrackId": nil,
            "subtitleTrackId": subtitleTrackId,
            "failure": state.failure.map { ["kind": state.failureKind, "message": $0, "recoverable": false] },
        ]
        for (key, value) in optional {
            out[key] = value ?? NSNull()
        }
        return out
    }

    /// The model.ts LiveSnapshot: the window on the axis of `position`, and how far behind live that is.
    private func live(_ state: PlayerState, seekTarget: Double?) -> [String: Any] {
        let position = seekTarget ?? state.position
        let window = state.live
        let lag = window.flatMap { LiveTimeline.lag($0, position: position) }
        liveBehind = window.map {
            LiveTimeline.behind(lag: lag, wasBehind: liveBehind, segment: $0.segment)
                && LiveTimeline.catchUpTarget($0, position: position) != nil
        } ?? false
        // A stall while playing is the connection, not a seek or a pause.
        let reconnecting = state.reconnecting
            || (state.loaded && state.pausedForCache && !state.paused && !state.seeking && seekTarget == nil)
        let out: [String: Any?] = [
            "edgeSeconds": window?.edge,
            "windowStartSeconds": window?.start,
            "driftSeconds": liveBehind ? lag : 0,
            "edgeSource": window?.source,
            "reconnecting": reconnecting,
            "delivery": window?.edge != nil && !reconnecting ? "available" : "unknown",
            "canCatchUp": liveBehind,
        ]
        return out.mapValues { $0 ?? NSNull() }
    }

    private func video(_ state: PlayerState) -> [String: Any]? {
        guard let width = state.videoParams["w"] as? Int64, let height = state.videoParams["h"] as? Int64 else {
            return nil
        }
        return [
            "width": width,
            "height": height,
            "codec": state.videoCodec ?? "",
            "dynamicRange": state.dynamicRange as Any? ?? NSNull(),
        ]
    }

    private func playable(_ state: PlayerState) -> [(start: Double, end: Double)] {
        guard let ahead = state.cacheAhead else {
            return []
        }
        return [(state.position, state.position + ahead)]
    }

    // MARK: Observation

    /// The longest the server goes without an observation. Ether ends a session it has not heard from in two
    /// minutes, and a paused or stalled player changes nothing that would report.
    static let heartbeatInterval: TimeInterval = 10

    /// True while a seek the server applies is awaited: the old position is not reported meanwhile.
    var holdsObservations = false

    /// An observation when none was sent for `heartbeatInterval`, whatever the state.
    func heartbeat(_ state: PlayerState) {
        guard let plan, !holdsObservations, Date().timeIntervalSince(lastObservation) >= Self.heartbeatInterval else {
            return
        }
        observe(plan, state, force: true)
    }

    private func observe(_ plan: VelaPlan, _ state: PlayerState, force: Bool) {
        guard !pathId.isEmpty else {
            return
        }
        let ended = state.phase == .ended
        if holdsObservations && !force && !ended {
            return
        }
        let generation = "\(plan.sessionId):\(plan.sourceGeneration):\(plan.seekGeneration)"
        if ended && endedReported == generation {
            return
        }
        let due = Date().timeIntervalSince(lastObservation) >= 1 && state.phase != .loading
        guard force || ended || due else {
            return
        }
        lastObservation = Date()
        if ended {
            endedReported = generation
        }
        sequence += 1
        var observation: [String: Any] = [
            "idempotencyKey": "\(generation):\(sequence)",
            "sourceGeneration": plan.sourceGeneration,
            "seekGeneration": plan.seekGeneration,
            "sequence": sequence,
            "observedAt": ISO8601DateFormatter().string(from: Date()),
            "positionSeconds": state.position,
            "state": observedState(state.phase),
            "playableRanges": playable(state).map { ["startSeconds": $0.start, "endSeconds": $0.end] },
            "selectedPathId": pathId,
        ]
        observation["throughputBps"] = state.cacheSpeed.map { Double($0 * 8) }
        observation["droppedFrames"] = state.droppedFrames
        if !audioClientOnly {
            observation["audioTrackId"] = audioTrackId
        }
        if !subtitleClientOnly {
            observation["subtitleTrackId"] = subtitleTrackId as Any? ?? NSNull()
        }
        if let failure = state.failure {
            observation["error"] = ["class": errorClass(state.failureKind), "message": failure]
        }
        emitObservation(["sessionId": plan.sessionId, "observation": observation])
    }

    private func observedState(_ phase: PlayerState.Phase) -> String {
        switch phase {
        case .playing: return "playing"
        case .paused: return "paused"
        case .ended: return "ended"
        default: return "buffering"
        }
    }

    private func errorClass(_ kind: String) -> String {
        switch kind {
        case "decoder": return "decoder"
        case "network": return "transient"
        default: return "source"
        }
    }
}

/// The external subtitle (a sidecar) handed to this load's engine, by plan track id. A sidecar exists only in the
/// player, on any path: the engine draws it once it is added (`sub-add`). Remembering which one was added keeps it
/// on across later plans of the same source; a new load, Off and any other track forget it, so choosing it again
/// adds it again.
struct SidecarSubtitle {
    enum Step: Equatable {
        case keep
        /// Add this file to the engine and select it.
        case add(URL)
        /// Turn off the sidecar this load added: the selection moved away from it.
        case clear
    }

    private(set) var added: String?

    /// What the engine does for the selected subtitle (`url`: its file, resolved), once the media is loaded.
    mutating func step(_ selected: VelaPlanTrack?, url: URL?, loaded: Bool) -> Step {
        if let selected, selected.isExternal, let url {
            guard loaded, added != selected.id else { return .keep }
            added = selected.id
            return .add(url)
        }
        guard added != nil else { return .keep }
        added = nil
        return .clear
    }

    mutating func forget() {
        added = nil
    }

    /// Whether Off for the `current` subtitle is the player's own. An original file's tracks are, and so is a
    /// sidecar on any path, which only the player draws: asking the server would only start a new source.
    static func offIsLocal(playsOriginal: Bool, current: VelaPlanTrack?) -> Bool {
        playsOriginal || current?.isExternal == true
    }
}
