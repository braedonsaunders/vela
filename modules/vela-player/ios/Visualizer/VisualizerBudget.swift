/// Sustained misses after scene setup lower resolution and cadence. The minimum tier
/// must sustain 30 fps at a 640 px long edge. Paused/still frames never enter the meter.
struct VisualizerBudget {
    enum Action { case keep, reduce, unavailable }
    private(set) var tier = 0
    var pixelCap: Int { [1920, 1080, 640][tier] }
    private var warmup = 12, frames = 0, misses = 0, slowWindows = 0

    mutating func measure(milliseconds: Double, fps: Int) -> Action {
        if warmup > 0 { warmup -= 1; return .keep }
        frames += 1
        if milliseconds > 1_050 / Double(max(1, fps)) { misses += 1 }
        guard frames == 45 else { return .keep }
        slowWindows = misses >= 12 ? slowWindows + 1 : 0
        frames = 0
        misses = 0
        guard slowWindows >= 2 else { return .keep }
        slowWindows = 0
        guard tier < 2 else { return .unavailable }
        tier += 1
        warmup = 12
        return .reduce
    }
}
