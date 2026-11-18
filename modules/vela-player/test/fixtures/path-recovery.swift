import Foundation

func plan(_ session: String = "session", selected: String = "original", fallback: String = "idle", paths: [(String, String, String)] = [("original", "direct", "ready")]) -> VelaPlan {
    VelaPlan.decode([
        "sessionId": session, "revision": 1, "sourceGeneration": 2, "seekGeneration": 3,
        "positionSeconds": 42, "selectedPathId": selected,
        "paths": paths.map { ["id": $0.0, "kind": $0.1, "readiness": $0.2, "transport": "hls"] },
        "audioTracks": [], "subtitleTracks": [], "fallback": ["state": fallback],
    ])!
}

@main struct Probe {
    static func main() {
        var recovery = PathRecovery()
        let available = [("original", "direct", "ready"), ("hls", "transcode", "on-demand")]
        let command = recovery.next(plan(paths: available), at: 123)!
        precondition(command["kind"] as? String == "switch")
        precondition(command["pathId"] as? String == "hls")
        precondition(command["atSeconds"] as? Double == 123)
        precondition(recovery.next(plan(selected: "hls", fallback: "unsupported", paths: available), at: 123) == nil)
        // A new session may try the same path IDs again.
        precondition(recovery.next(plan("new", paths: available), at: 0)?["pathId"] as? String == "hls")
        var lazy = PathRecovery()
        precondition(lazy.next(plan(), at: 0)?["kind"] as? String == "prepare-fallback")
        precondition(lazy.next(plan(), at: 0) == nil)
        precondition(lazy.awaitsFallback(plan(fallback: "preparing")))
        precondition(lazy.next(plan(fallback: "ready", paths: available), at: 42)?["pathId"] as? String == "hls")
        var unavailable = PathRecovery()
        precondition(unavailable.next(plan(fallback: "capacity"), at: 42) == nil)
        precondition(unavailable.next(plan(paths: [("original", "direct", "ready"), ("bad", "transcode", "unavailable")]), at: 42)?["kind"] as? String == "prepare-fallback")
        print("path recovery passed")
    }
}
