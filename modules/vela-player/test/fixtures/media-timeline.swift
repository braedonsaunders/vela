import Foundation

func plan(seek: Int = 3, origin: Double? = 90, transport: String = "hls", original: Bool = false, live: Bool = false, position: Double = 95) -> VelaPlan {
    var path: [String: Any] = ["id": "converted", "kind": original ? "direct" : "transcode", "transport": transport,
                               "readiness": "ready", "url": "/v1/media/one/index.m3u8", "original": original]
    if let origin { path["timelineOriginSeconds"] = origin }
    var plan: [String: Any] = [
        "sessionId": "session", "revision": 1, "sourceGeneration": 2, "seekGeneration": seek,
        "positionSeconds": position, "selectedPathId": "converted", "paths": [path],
        "audioTracks": [], "subtitleTracks": [],
    ]
    if live { plan["live"] = ["mode": "adaptive"] }
    return VelaPlan.decode(plan)!
}

func key(_ plan: VelaPlan) -> String { plan.sourceKey(plan.selectedPath!) }

@main struct Probe {
    static func main() {
        // A resume at title second 95 on a playlist that starts at 90: the item starts at 5.
        let timeline = MediaTimeline(plan: plan())
        precondition(timeline.origin == 90)
        precondition(timeline.mediaTime(95) == 5)
        precondition(timeline.mediaTime(90) == 0)
        precondition(timeline.mediaTime(30) == 0) // never before the item's start
        precondition(timeline.titleTime(5) == 95)
        precondition(timeline.titleTime(-1) == 90)
        // The engine's clock, the item's duration and its buffered end are reported on the title's axis.
        precondition(timeline.titleProperty("time-pos", 5.0) as? Double == 95)
        precondition(timeline.titleProperty("duration", 6353.0) as? Double == 6443) // the title's duration
        precondition(timeline.titleProperty("demuxer-cache-time", 35.0) as? Double == 125)
        precondition(timeline.titleProperty("video-pts", 5.0) as? Double == 5)
        precondition(timeline.titleProperty("duration", nil) == nil)
        var state = PlayerState()
        for (name, value) in [("time-pos", 5.0), ("duration", 6353.0), ("demuxer-cache-time", 35.0)] {
            state.update(name, timeline.titleProperty(name, value))
        }
        precondition(state.position == 95 && state.duration == 6443 && state.cacheAhead == 30)
        precondition(!state.atEnd)

        // No origin: live windows, original files, other transports and plans without one.
        precondition(MediaTimeline(plan: plan(live: true)).origin == 0)
        precondition(MediaTimeline(plan: plan(transport: "file", original: true)).origin == 0)
        precondition(MediaTimeline(plan: plan(transport: "file")).origin == 0)
        precondition(MediaTimeline(plan: plan(origin: nil)).origin == 0)
        precondition(MediaTimeline(origin: .nan).origin == 0)
        precondition(MediaTimeline(origin: -4).origin == 0)
        precondition(MediaTimeline().mediaTime(95) == 95)
        precondition(MediaTimeline().titleProperty("time-pos", 95.0) as? Double == 95)

        // A seek that restarts the server's encoder keeps the URL and source generation: the item is new.
        let before = plan(seek: 3, origin: 90)
        let restarted = plan(seek: 4, origin: 2000, position: 2000)
        precondition(key(before) != key(restarted))
        precondition(MediaTimeline(plan: restarted).mediaTime(restarted.positionSeconds) == 0)
        // A newer revision of the same item (no seek) plays on.
        precondition(key(before) == key(plan(seek: 3, origin: 90, position: 300)))
        // A measured origin arriving in a same-generation plan is a different clock: loaded again.
        precondition(key(before) != key(plan(seek: 3, origin: 88)))
        // An original file and a live window keep their item across seeks.
        let file = plan(seek: 3, transport: "file", original: true)
        precondition(key(file) == key(plan(seek: 4, transport: "file", original: true)))
        precondition(key(file) == "session:converted:2")
        let live = plan(seek: 3, live: true)
        precondition(key(live) == key(plan(seek: 4, live: true)))
        print("media timeline passed")
    }
}
