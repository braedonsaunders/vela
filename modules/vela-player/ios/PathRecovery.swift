// Recovery uses the server's existing generation-aware session commands.
import Foundation

struct PathRecovery {
    private var session = ""
    private var refused = Set<String>()
    private var requested = Set<String>()
    private var prepared = false

    mutating func next(_ plan: VelaPlan, at position: Double) -> [String: Any]? {
        if session != plan.sessionId {
            self = PathRecovery()
            session = plan.sessionId
        }
        refused.insert(plan.selectedPathId)
        let candidates = plan.paths.filter {
            !refused.contains($0.id) && !requested.contains($0.id) &&
            ($0.readiness == "ready" || $0.readiness == "on-demand")
        }
        if let path = candidates.first(where: { $0.kind == "transcode" }) ?? candidates.first {
            requested.insert(path.id)
            return ["kind": "switch", "pathId": path.id, "atSeconds": max(0, position)]
        }
        if !prepared, plan.fallback?.state == "idle" {
            prepared = true
            return ["kind": "prepare-fallback", "maxBitrate": 20_000_000]
        }
        return nil
    }

    func awaitsFallback(_ plan: VelaPlan) -> Bool {
        session == plan.sessionId && prepared && refused.contains(plan.selectedPathId)
    }
}
