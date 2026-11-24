import Foundation

func reading(_ clock: Double, at now: Double, frame: Double? = nil, playing: Bool = true, seeking: Bool = false,
             waiting: Bool = false, frames: Bool = true, shift: Double = 0) -> PresentationProgress.Reading {
    PresentationProgress.Reading(clock: clock, sourceClock: clock - shift, now: now, playing: playing, seeking: seeking,
                                 waiting: waiting, framesExpected: frames, newestFrame: frame)
}

@main struct Probe {
    static func main() {
        // Healthy: frames ahead of a moving clock; the clock is the position.
        var healthy = PresentationProgress()
        for step in 0..<20 {
            let t = Double(step) * 0.25
            let out = healthy.observe(reading(12 + t, at: t, frame: 12 + t + 2))
            precondition(!out.starved && out.position == 12 + t, "healthy \(step)")
        }

        // The 40 kbit/s start: the first frame at 12.25, then the clock runs on with no frames.
        var frozen = PresentationProgress()
        _ = frozen.observe(reading(12.25, at: 0, frame: 12.25))
        var last = 0.0
        for step in 1...40 {
            let t = Double(step) * 0.25
            let out = frozen.observe(reading(12.25 + t, at: t, frame: 12.25))
            precondition(out.position >= last, "never back")
            precondition(out.position <= 12.25 + PresentationProgress.frameSlack + 0.01, "held at the picture, not the clock: \(out.position)")
            if t > PresentationProgress.frameSlack + 0.01 { precondition(out.starved, "starved at \(t)") }
            last = out.position
        }
        // Frames trickle in behind the clock: the position follows the picture, still starved.
        let trickle = frozen.observe(reading(22.5, at: 10.25, frame: 14))
        precondition(trickle.starved && trickle.position == 14, "trickle \(trickle)")
        // The picture catches up: moving again, at the clock.
        let caught = frozen.observe(reading(22.75, at: 10.5, frame: 24))
        precondition(!caught.starved && caught.position == 22.75, "caught \(caught)")

        // No first frame yet while the clock runs (on another axis than the source): starved at the start.
        var start = PresentationProgress()
        _ = start.observe(reading(100, at: 0, shift: 100))
        let early = start.observe(reading(102, at: 2, shift: 100))
        precondition(early.starved && early.position == 100, "no first frame \(early)")

        // A clock that claims to play and stands still is starved after stillSeconds; a route without
        // frame reports (remote HLS) is judged by its clock alone.
        var still = PresentationProgress()
        precondition(!still.observe(reading(40, at: 0, frames: false)).starved)
        precondition(!still.observe(reading(40, at: 1, frames: false)).starved)
        precondition(still.observe(reading(40, at: 1.6, frames: false)).starved)
        precondition(!still.observe(reading(40.5, at: 2, frames: false)).starved, "moves again")
        // Remote HLS moving without frame reports is healthy.
        var remote = PresentationProgress()
        for step in 0..<12 { precondition(!remote.observe(reading(Double(step), at: Double(step), frames: false)).starved) }

        // Paused or seeking: the clock (a seek's target) is the position, and nothing is starved.
        var paused = PresentationProgress()
        _ = paused.observe(reading(12.25, at: 0, frame: 12.25))
        let held = paused.observe(reading(30, at: 5, frame: 12.25, playing: false))
        precondition(!held.starved && held.position == 30)
        let seek = paused.observe(reading(600, at: 6, seeking: true))
        precondition(!seek.starved && seek.position == 600)

        // The engine's own waiting holds the position too, and a reload keeps it until its picture moves.
        var waiting = PresentationProgress()
        _ = waiting.observe(reading(50, at: 0, frame: 52))
        let buffering = waiting.observe(reading(50, at: 0.25, frame: 52, waiting: true))
        precondition(buffering.starved && buffering.position == 50, "waiting \(buffering)")
        // Waiting with frames still ahead of a moving clock: the picture moves, and so does the position.
        let draining = waiting.observe(reading(50.4, at: 0.5, frame: 52, waiting: true))
        precondition(draining.starved && draining.position == 50.4, "draining \(draining)")
        waiting.reset(keepingPosition: true)
        precondition(waiting.position == 50.4)
        let reloaded = waiting.observe(reading(0, at: 1, waiting: true))
        precondition(reloaded.starved && reloaded.position == 50.4, "a reload's clock at 0 does not move it back: \(reloaded)")
        print("presentation progress passed")
    }
}
