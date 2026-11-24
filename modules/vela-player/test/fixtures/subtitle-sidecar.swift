// Compiled with ../../ios/PlaybackPlan.swift, PlayerReport.swift, PlayerState.swift and SubtitleAppearance.swift by
// subtitle-sidecar.test.ts. Output preferences need AetherEngine; the report only lists them.
import Foundation

struct PlaybackPreferences {
    static let current = PlaybackPreferences()
    static let available: [String] = []
    let values: [String: String] = [:]
}

func plan(session: String = "s", revision: Int = 1, selected: String? = "sidecar") -> VelaPlan {
    VelaPlan.decode([
        "sessionId": session, "revision": revision, "sourceGeneration": 1, "seekGeneration": 1,
        "positionSeconds": 0, "selectedPathId": "hls",
        "paths": [["id": "hls", "kind": "transcode", "transport": "hls", "readiness": "ready"]],
        "audioTracks": [],
        "subtitleTracks": [
            ["id": "sidecar", "name": "English", "delivery": ["kind": "external", "url": "https://media.example/en.vtt"]],
            ["id": "found", "name": "Dutch", "delivery": ["kind": "external", "url": "https://media.example/nl.vtt"]],
            ["id": "embedded", "name": "French", "streamIndex": 3, "delivery": ["kind": "embedded"]],
        ],
        "selectedSubtitleTrackId": selected as Any? ?? NSNull(),
    ])!
}

let url = URL(string: "https://media.example/en.vtt")!

func sidecarSteps() {
    let p = plan()
    let sidecar = p.subtitleTrack("sidecar"), embedded = p.subtitleTrack("embedded")
    var added = SidecarSubtitle()
    // The plan's sidecar waits for the media, then is added once: later plans of the same source keep it.
    precondition(added.step(sidecar, url: url, loaded: false) == .keep)
    precondition(added.step(sidecar, url: url, loaded: true) == .add(url))
    precondition(added.added == "sidecar")
    precondition(added.step(sidecar, url: url, loaded: true) == .keep)
    // Another sidecar replaces it; a selection that moves away from sidecars turns it off, once.
    let dutch = URL(string: "https://media.example/nl.vtt")!
    precondition(added.step(p.subtitleTrack("found"), url: dutch, loaded: true) == .add(dutch))
    precondition(added.step(embedded, url: nil, loaded: true) == .clear)
    precondition(added.step(nil, url: nil, loaded: true) == .keep)
    // Off forgets it, so choosing it again adds it again; so does a new load.
    precondition(added.step(sidecar, url: url, loaded: true) == .add(url))
    added.forget()
    precondition(added.step(sidecar, url: url, loaded: true) == .add(url))
    // An external track whose file cannot be resolved adds nothing.
    var unresolved = SidecarSubtitle()
    precondition(unresolved.step(sidecar, url: nil, loaded: true) == .keep)
    // Off is the player's own for a sidecar on any path and for anything on the original file.
    precondition(SidecarSubtitle.offIsLocal(playsOriginal: false, current: sidecar))
    precondition(!SidecarSubtitle.offIsLocal(playsOriginal: false, current: embedded))
    precondition(!SidecarSubtitle.offIsLocal(playsOriginal: false, current: nil))
    precondition(SidecarSubtitle.offIsLocal(playsOriginal: true, current: embedded))
}

func adoption() {
    var snapshots: [[String: Any]] = []
    let report = PlayerReport(snapshot: { snapshots.append($0) }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in })
    // The plan's choice (a default or remembered subtitle) is the report's until the viewer chooses.
    report.adopt(plan(), newSession: true)
    precondition(report.subtitleTrackId == "sidecar" && !report.subtitleClientOnly)
    report.adopt(plan(revision: 2, selected: nil), newSession: false)
    precondition(report.subtitleTrackId == nil)
    report.adopt(plan(revision: 3), newSession: false)
    // Off in the player: later plans of the session, which still select the sidecar, do not bring it back,
    // and the menu shows Off.
    report.chooseSubtitle(nil)
    report.adopt(plan(revision: 4), newSession: false)
    precondition(report.subtitleTrackId == nil && report.subtitleClientOnly)
    report.publish(PlayerState(), seekTarget: nil, force: true)
    precondition(snapshots.last?["subtitleTrackId"] is NSNull)
    // Chosen again, it stays chosen across a plan that selects nothing.
    report.chooseSubtitle("sidecar")
    report.adopt(plan(revision: 5, selected: nil), newSession: false)
    precondition(report.subtitleTrackId == "sidecar")
    report.publish(PlayerState(), seekTarget: nil, force: true)
    precondition(snapshots.last?["subtitleTrackId"] as? String == "sidecar")
    // A new session takes its plan's choice again.
    report.adopt(plan(session: "next"), newSession: true)
    precondition(report.subtitleTrackId == "sidecar" && !report.subtitleClientOnly)
    // The server deselects the sidecar in a later plan of the same source: adopted, and the sidecar goes.
    var added = SidecarSubtitle()
    _ = added.step(plan().subtitleTrack("sidecar"), url: url, loaded: true)
    report.adopt(plan(session: "next", revision: 2, selected: nil), newSession: false)
    precondition(report.subtitleTrackId == nil)
    precondition(added.step(plan().subtitleTrack(report.subtitleTrackId), url: nil, loaded: true) == .clear)
}

/// The viewer's sidecar, then a track only the server delivers (over its HLS): the sidecar goes at once, the menu
/// shows the request, and the report follows the server from then on instead of keeping the sidecar for the next source.
func embeddedAfterSidecar() {
    let report = PlayerReport(snapshot: { _ in }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in })
    report.adopt(plan(selected: nil), newSession: true)
    var added = SidecarSubtitle()
    report.chooseSubtitle("sidecar")
    precondition(added.step(plan().subtitleTrack(report.subtitleTrackId), url: url, loaded: true) == .add(url))
    report.requestSubtitle("embedded")
    precondition(report.subtitleTrackId == "embedded" && !report.subtitleClientOnly)
    precondition(added.step(plan().subtitleTrack(report.subtitleTrackId), url: nil, loaded: true) == .clear)
    // The answer (a new source) selects it; a refusal leaves the server's own choice, which is shown instead.
    report.adopt(plan(revision: 2, selected: "embedded"), newSession: false)
    precondition(report.subtitleTrackId == "embedded")
    report.adopt(plan(revision: 3, selected: nil), newSession: false)
    precondition(report.subtitleTrackId == nil)
    // Off for a track the server delivers is the server's too, and its answer is adopted the same way.
    report.chooseSubtitle("sidecar")
    report.requestSubtitle(nil)
    report.adopt(plan(revision: 4, selected: "embedded"), newSession: false)
    precondition(report.subtitleTrackId == "embedded")
}

@main struct Probe {
    static func main() {
        sidecarSteps()
        adoption()
        embeddedAfterSidecar()
        print("subtitle sidecar passed")
    }
}
