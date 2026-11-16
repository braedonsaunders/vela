// What vela-player tells Contract, in the web engine's message shapes (client/player/model.ts
// EngineEvent, protocol.ts observation): snapshots, at most one observation a second, errors and
// the session commands the foundation forwards to the server.
import Foundation

final class VelaPlayerReport {
    private let events: ExactNativeEvents
    private var plan: VelaPlan?
    private var sequence = 0
    private var lastObservation = Date.distantPast
    private var endedReported = ""
    private var failureReported = ""

    /// The path playing, and the viewer's track choices (client-only when switched on the device).
    var pathId = ""
    var audioTrackId: String?
    var subtitleTrackId: String?
    var audioClientOnly = false
    var subtitleClientOnly = false
    var subtitleStyle = VelaSubtitleStyle()

    init(events: ExactNativeEvents) {
        self.events = events
    }

    /// A newer plan: the server's track choices unless the viewer made their own here.
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

    // MARK: Messages

    func sessionCommand(_ fields: [String: Any]) {
        guard let plan else {
            return
        }
        var command = fields
        command["sourceGeneration"] = plan.sourceGeneration
        command["seekGeneration"] = plan.seekGeneration
        command["idempotencyKey"] = UUID().uuidString.lowercased()
        emit(["type": "session-command", "sessionId": plan.sessionId, "command": command])
    }

    func actionFailed(_ message: String) {
        emitError(kind: "action", message: message, recoverable: true)
    }

    func publish(_ readout: VelaReadout, backend: String?, seekTarget: Double?, volume: Float, muted: Bool) {
        guard let plan else {
            return
        }
        emit(["type": "snapshot", "snapshot": snapshot(plan, readout, backend, seekTarget, volume, muted)])
        if let failure = readout.failure {
            let key = "\(plan.sessionId):\(plan.sourceGeneration):\(plan.seekGeneration):\(failure)"
            if key != failureReported {
                failureReported = key
                emitError(kind: readout.failureKind, message: failure, recoverable: false)
                observe(plan, readout, force: true)
            }
        }
        observe(plan, readout, force: false)
    }

    // MARK: Snapshot

    private func snapshot(
        _ plan: VelaPlan, _ readout: VelaReadout, _ backend: String?,
        _ seekTarget: Double?, _ volume: Float, _ muted: Bool
    ) -> [String: Any] {
        let position = readout.position
        let loadingSeek = seekTarget != nil && readout.state == .loading
        var out: [String: Any] = [
            "sessionId": plan.sessionId,
            "sourceGeneration": plan.sourceGeneration,
            "seekGeneration": plan.seekGeneration,
            "state": loadingSeek ? "buffering" : readout.state.rawValue,
            "capabilities": ["pip": false, "fullscreen": false, "audioSwitch": true],
            "qualityIds": [String](),
            "renditions": [Any](),
            "audioTracks": plan.audioTracks.map(\.snapshot),
            "subtitleTracks": plan.subtitleTracks.map(\.snapshot),
            "audioTrackIds": plan.audioTracks.map(\.id),
            "chapters": (plan.chapters ?? []).map(\.snapshot),
            "throughputHistory": readout.throughputBps.map { [$0] } ?? [],
            "speed": 1,
            "speeds": [1],
            "subtitleStyleAvailable": true,
            "subtitleStyle": subtitleStyle.snapshot,
            "subtitleClientOnly": subtitleClientOnly,
            "audioClientOnly": audioClientOnly,
            "diagnostics": [
                "implementation": "vela-native-tvos",
                "metadataDiscrepancies": [String](),
                "audioRoute": readout.audioRoute ?? "",
            ],
            "waiting": readout.state == .loading || readout.state == .buffering,
            "volume": volume,
            "muted": muted,
            "position": seekTarget ?? position,
            "playable": playable(readout).map { ["start": $0.start, "end": $0.end] },
        ]
        let optional: [String: Any?] = [
            "sourceId": pathId.isEmpty ? nil : pathId,
            "strategy": plan.paths.first { $0.id == pathId }?.kind,
            "backend": backend,
            "renditionId": nil,
            "lockedQuality": nil,
            "video": video(readout),
            "currentBitrateBps": nil,
            "requiredBandwidthBps": nil,
            "bufferAheadSeconds": readout.bufferedEnd.map { max(0, $0 - position) },
            "pendingSubtitleTrackId": nil,
            "subtitleError": nil,
            "live": nil,
            "seekTarget": seekTarget,
            "preparation": readout.preparation,
            "duration": readout.duration,
            "throughputBps": readout.throughputBps,
            "droppedFrames": nil,
            "totalFrames": nil,
            "audioTrackId": audioTrackId,
            "pendingAudioTrackId": nil,
            "subtitleTrackId": subtitleTrackId,
            "failure": readout.failure.map { ["kind": readout.failureKind, "message": $0, "recoverable": false] },
        ]
        for (key, value) in optional {
            out[key] = value ?? NSNull()
        }
        return out
    }

    private func video(_ readout: VelaReadout) -> [String: Any]? {
        guard let codec = readout.videoCodec, readout.width > 0 else {
            return nil
        }
        return [
            "width": readout.width,
            "height": readout.height,
            "codec": codec,
            "dynamicRange": readout.dynamicRange as Any? ?? NSNull(),
        ]
    }

    private func playable(_ readout: VelaReadout) -> [(start: Double, end: Double)] {
        guard let end = readout.bufferedEnd else {
            return []
        }
        return [(readout.position, max(readout.position, end))]
    }

    // MARK: Observation

    private func observe(_ plan: VelaPlan, _ readout: VelaReadout, force: Bool) {
        guard !pathId.isEmpty else {
            return
        }
        let ended = readout.state == .ended
        let generation = "\(plan.sessionId):\(plan.sourceGeneration):\(plan.seekGeneration)"
        if ended && endedReported == generation {
            return
        }
        let due = Date().timeIntervalSince(lastObservation) >= 1 && readout.state != .loading
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
            "positionSeconds": readout.position,
            "state": observedState(readout.state),
            "playableRanges": playable(readout).map { ["startSeconds": $0.start, "endSeconds": $0.end] },
            "selectedPathId": pathId,
        ]
        observation["throughputBps"] = readout.throughputBps
        observation["transferredBytes"] = readout.transferredBytes
        if !audioClientOnly {
            observation["audioTrackId"] = audioTrackId
        }
        if !subtitleClientOnly {
            observation["subtitleTrackId"] = subtitleTrackId as Any? ?? NSNull()
        }
        if let failure = readout.failure {
            observation["error"] = ["class": errorClass(readout.failureKind), "message": failure]
        }
        emit(["type": "observation", "sessionId": plan.sessionId, "observation": observation])
    }

    private func observedState(_ state: VelaReadout.State) -> String {
        switch state {
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

    // MARK: Events

    private func emitError(kind: String, message: String, recoverable: Bool) {
        let failure: [String: Any] = ["kind": kind, "message": message, "recoverable": recoverable]
        var value: [String: Any] = ["type": "error", "failure": failure]
        if let plan {
            value["sessionId"] = plan.sessionId
            value["sourceGeneration"] = plan.sourceGeneration
            value["seekGeneration"] = plan.seekGeneration
        }
        emit(value)
    }

    private func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else {
            return
        }
        events.message(String(decoding: data, as: UTF8.self))
    }
}
