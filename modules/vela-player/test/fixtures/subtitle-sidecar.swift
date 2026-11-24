// Compiled with ../../ios/PlaybackPlan.swift, PlayerReport.swift, PlayerState.swift and SubtitleAppearance.swift by
// subtitle-sidecar.test.ts. Output preferences need AetherEngine; the report only lists them.
import Foundation

struct PlaybackPreferences {
    static let current = PlaybackPreferences()
    static let available: [String] = []
    let values: [String: String] = [:]
}

func plan(session: String = "s", revision: Int = 1, selected: String? = "sidecar", audio: String = "english", path: String = "hls") -> VelaPlan {
    VelaPlan.decode([
        "sessionId": session, "revision": revision, "sourceGeneration": 1, "seekGeneration": 1,
        "positionSeconds": 0, "selectedPathId": path,
        "paths": [["id": "hls", "kind": "transcode", "transport": "hls", "readiness": "ready"],
                  ["id": "original", "kind": "direct", "transport": "file", "readiness": "ready", "original": true]],
        "audioTracks": [["id": "english", "name": "English", "streamIndex": 1], ["id": "spanish", "name": "Spanish", "streamIndex": 2],
                        ["id": "commentary", "name": "Commentary"]],
        "selectedAudioTrackId": audio,
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

/// Audio the same way: after the viewer's own pick in the original file, a track the server applies hands the choice
/// back to the server, whose answer is shown, while a choice made in the player stays across plans.
func audioAfterLocalPick() {
    let report = PlayerReport(snapshot: { _ in }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in })
    report.adopt(plan(path: "original"), newSession: true)
    precondition(report.audioTrackId == "english" && !report.audioClientOnly)
    report.chooseAudio("spanish")
    report.adopt(plan(revision: 2, path: "original"), newSession: false)
    precondition(report.audioTrackId == "spanish" && report.audioClientOnly)
    report.requestAudio("commentary")
    precondition(report.audioTrackId == "commentary" && !report.audioClientOnly)
    report.adopt(plan(revision: 3, audio: "commentary", path: "original"), newSession: false)
    precondition(report.audioTrackId == "commentary")
    // A refusal leaves the server's own choice, which is then shown.
    report.adopt(plan(revision: 4, audio: "english", path: "original"), newSession: false)
    precondition(report.audioTrackId == "english")
}

/// Choices made among the original file's own streams end when the plan moves to a server path, which plays what
/// the server selects; a sidecar choice (or Off for a sidecar) goes on, as the player draws sidecars on any path.
func localChoicesOnServerPath() {
    let report = PlayerReport(snapshot: { _ in }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in })
    report.adopt(plan(selected: "embedded", path: "original"), newSession: true)
    report.chooseAudio("spanish")
    report.chooseSubtitle(nil)
    report.adopt(plan(revision: 2, selected: "embedded", path: "original"), newSession: false)
    precondition(report.audioTrackId == "spanish" && report.subtitleTrackId == nil)
    // The switch to the server's HLS: its audio and its embedded subtitle are what plays and what the menu shows,
    // so choosing Spanish there is a new choice again, for the server.
    report.adopt(plan(revision: 3, selected: "embedded", path: "hls"), newSession: false)
    precondition(report.audioTrackId == "english" && !report.audioClientOnly)
    precondition(report.subtitleTrackId == "embedded" && !report.subtitleClientOnly)
    // An embedded track picked in the file does not carry over either.
    let picked = PlayerReport(snapshot: { _ in }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in })
    picked.adopt(plan(selected: nil, path: "original"), newSession: true)
    picked.chooseSubtitle("embedded")
    picked.adopt(plan(revision: 2, selected: nil, path: "hls"), newSession: false)
    precondition(picked.subtitleTrackId == nil && !picked.subtitleClientOnly)
    // The viewer's sidecar, and Off for the server's sidecar, stay theirs on the server path.
    let sidecar = PlayerReport(snapshot: { _ in }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in })
    sidecar.adopt(plan(selected: nil, path: "original"), newSession: true)
    sidecar.chooseSubtitle("found")
    sidecar.adopt(plan(revision: 2, selected: nil, path: "hls"), newSession: false)
    precondition(sidecar.subtitleTrackId == "found" && sidecar.subtitleClientOnly)
    sidecar.chooseSubtitle(nil)
    sidecar.adopt(plan(revision: 3, selected: "sidecar", path: "hls"), newSession: false)
    precondition(sidecar.subtitleTrackId == nil && sidecar.subtitleClientOnly)
}

@main struct Probe {
    static func main() {
        sidecarSteps()
        adoption()
        embeddedAfterSidecar()
        audioAfterLocalPick()
        localChoicesOnServerPath()
        print("subtitle sidecar passed")
    }
}
