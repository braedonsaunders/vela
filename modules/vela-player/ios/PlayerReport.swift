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
        }
        if !audioClientOnly {
            audioTrackId = plan.selectedAudioTrackId
        }
        if !subtitleClientOnly {
            subtitleTrackId = plan.selectedSubtitleTrackId
        }
    }

    func failure(kind: String, message: String, recoverable: Bool) {
        emitError(["kind": kind, "message": message, "recoverable": recoverable])
    }

    /// Reports the state: a snapshot when due or when the phase changed, an observation when due.
    func publish(_ state: PlayerState, seekTarget: Double?, force: Bool = false) {
        guard let plan else {
            return
        }
        let phase = seekTarget != nil && state.phase == .loading ? "buffering" : state.phase.rawValue
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
            "capabilities": ["pip": false, "fullscreen": false, "audioSwitch": true],
            "qualityIds": [String](),
            "renditions": [Any](),
            "audioTracks": plan.audioTracks.map(\.snapshot),
            "subtitleTracks": plan.subtitleTracks.map(\.snapshot),
            "audioTrackIds": plan.audioTracks.map(\.id),
            "chapters": (plan.chapters ?? []).map(\.snapshot),
            "throughputHistory": state.cacheSpeed.map { [Double($0 * 8)] } ?? [],
            "speed": 1,
            "speeds": [1],
            "subtitleStyleAvailable": false,
            "subtitleClientOnly": subtitleClientOnly,
            "audioClientOnly": audioClientOnly,
            "diagnostics": [
                "implementation": "vela-mpv",
                "metadataDiscrepancies": [String](),
            ],
            "waiting": phase == "loading" || phase == "buffering",
            "volume": volume,
            "muted": muted,
            "position": seekTarget ?? state.position,
            "playable": playable(state).map { ["start": $0.start, "end": $0.end] },
        ]
        let optional: [String: Any?] = [
            "sourceId": pathId.isEmpty ? nil : pathId,
            "strategy": plan.paths.first { $0.id == pathId }?.kind,
            "backend": backend,
            "renditionId": nil,
            "lockedQuality": nil,
            "video": video(state),
            "currentBitrateBps": nil,
            "requiredBandwidthBps": nil,
            "bufferAheadSeconds": state.cacheAhead,
            "pendingSubtitleTrackId": nil,
            "subtitleError": nil,
            "subtitleStyle": nil,
            "live": nil,
            "seekTarget": seekTarget,
            "preparation": phase == "loading" ? (state.tracks.isEmpty ? "media-metadata" : "initial-buffer") : nil,
            "duration": state.duration,
            "throughputBps": state.cacheSpeed.map { Double($0 * 8) },
            "droppedFrames": state.droppedFrames,
            "totalFrames": nil,
            "audioTrackId": audioTrackId,
            "pendingAudioTrackId": nil,
            "subtitleTrackId": subtitleTrackId,
            "failure": state.failure.map { ["kind": state.failureKind, "message": $0, "recoverable": false] },
        ]
        for (key, value) in optional {
            out[key] = value ?? NSNull()
        }
        return out
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
