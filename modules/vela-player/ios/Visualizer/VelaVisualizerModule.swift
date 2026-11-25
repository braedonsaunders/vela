import ExpoModulesCore
import Metal
import QuartzCore
import UIKit

final class VisualizerAvailability {
    static let shared = VisualizerAvailability()
    static let changed = Notification.Name("VelaVisualizerAvailability")
    private let lock = NSLock()
    private var supported = true, withinBudget = true

    var trackSupported: Bool {
        lock.lock()
        defer { lock.unlock() }
        return supported && withinBudget
    }

    func disableForBudget() {
        lock.lock()
        withinBudget = false
        lock.unlock()
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    func update(_ value: Bool) {
        lock.lock()
        let changed = value != supported
        supported = value
        lock.unlock()
        if changed { NotificationCenter.default.post(name: Self.changed, object: nil) }
    }
}

public final class VelaVisualizerModule: Module {
    private static let hostSupported = VisualizerResources.available && MTLCreateSystemDefaultDevice() != nil
    private var observer: NSObjectProtocol?
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    public func definition() -> ModuleDefinition {
        Name("VelaVisualizer")
        Events("onAvailabilityChange")
        OnStartObserving {
            self.observer = NotificationCenter.default.addObserver(forName: VisualizerAvailability.changed,
                object: nil, queue: .main) { [weak self] _ in self?.sendEvent("onAvailabilityChange", [:]) }
        }
        OnStopObserving {
            if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
            self.observer = nil
        }
        Function("canVisualize") {
            Self.hostSupported && VisualizerAvailability.shared.trackSupported
        }
        View(VelaVisualizerView.self) {
            Events("onUnavailable")
            Prop("sceneId") { (view: VelaVisualizerView, value: String?) in view.sceneID = value ?? "" }
            Prop("active") { (view: VelaVisualizerView, value: Bool?) in view.active = value ?? false }
            Prop("still") { (view: VelaVisualizerView, value: Bool?) in view.still = value ?? false }
            Prop("mode") { (view: VelaVisualizerView, value: String?) in view.mode = value ?? "" }
            Prop("accent") { (view: VelaVisualizerView, value: String?) in view.accent = value ?? "" }
            Prop("artworkTint") { (view: VelaVisualizerView, value: String?) in view.artworkTint = value ?? "" }
            OnViewDidUpdateProps { (view: VelaVisualizerView) in view.commit() }
        }
    }
}

private final class VisualizerSurface: UIView {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    var metal: CAMetalLayer { layer as! CAMetalLayer }
}

private final class RenderSession {
    var renderer: VisualizerRenderer?
    private let lock = NSLock()
    private var cancelled = false
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
}

private final class VelaVisualizerView: ExpoView {
    var sceneID = "", mode = "", active = false, still = false
    var accent = "", artworkTint = ""
    private var budget = VisualizerBudget()
    private var lastTint: [String] = []
    let onUnavailable = EventDispatcher()
    private let surface = VisualizerSurface()
    private let queue = DispatchQueue(label: "app.vela.visualizer", qos: .userInitiated)
    private var session: RenderSession?, displayLink: CADisplayLink?
    private var runningScene = "", busy = false, drew = false
    private var failedScene: String?
    private var pendingPCM: (id: Int, since: Double)?
    private var subscribed: [VisualizerHeardLane] = []
    private var framesStill: Bool { still || UIAccessibility.isReduceMotionEnabled }

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        clipsToBounds = true
        surface.isUserInteractionEnabled = false
        surface.metal.pixelFormat = .bgra8Unorm
        surface.metal.framebufferOnly = true
        addSubview(surface)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(commit), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(stop), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(commit), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
    }

    override func didMoveToWindow() { super.didMoveToWindow(); commit() }
    override func layoutSubviews() {
        super.layoutSubviews()
        surface.frame = bounds
        commit()
    }

    @objc func commit() {
        guard active, !sceneID.isEmpty, let window, !bounds.isEmpty,
              UIApplication.shared.applicationState == .active else {
            stop()
            failedScene = nil
            return
        }
        guard failedScene != sceneID else { return }
        if sceneID != runningScene {
            stop()
            runningScene = sceneID
            guard let device = MTLCreateSystemDefaultDevice(), VisualizerResources.available else {
                unavailable(.resources)
                return
            }
            surface.metal.device = device
            session = RenderSession()
        }
        let cap = min(mode == "background" ? 1080 : 1920, budget.pixelCap)
        let scale = min(window.screen.scale, CGFloat(cap) / max(bounds.width, bounds.height))
        let pixels = CGSize(width: max(1, (bounds.width * scale).rounded()), height: max(1, (bounds.height * scale).rounded()))
        if surface.metal.drawableSize != pixels {
            surface.metal.drawableSize = pixels
            drew = false
        }
        if lastTint != [artworkTint, accent] { drew = false }
        if framesStill && drew {
            displayLink?.invalidate()
            displayLink = nil
            subscribed.removeAll()
            return
        }
        if displayLink == nil {
            let timer = CADisplayLink(target: self, selector: #selector(tick))
            timer.add(to: .main, forMode: .common)
            displayLink = timer
        }
        displayLink?.preferredFramesPerSecond = mode == "background" || budget.tier > 0 || ProcessInfo.processInfo.isLowPowerModeEnabled ? 30 : 60
    }

    @objc private func tick() {
        guard !busy, let session, let device = surface.metal.device else { return }
        let layer = surface.metal, size = layer.drawableSize, scene = runningScene
        let tint = [artworkTint, accent]
        guard let lanes = AudioPlayback.shared.visualizerLanes() else { stop(); return }
        subscribed = lanes
        if let lane = lanes.first, lane.speed > 0, !lane.buffer.hasReceivedSamples {
            let now = CACurrentMediaTime()
            if let waiting = pendingPCM, waiting.id == lane.id {
                // Some streaming items accept an audio mix but never call its tap. Real silence
                // still produces PCM blocks. Waiting/buffering and paused clocks don't count.
                if now - waiting.since > 4 {
                    AudioPlayback.shared.markMissingVisualizerPCM(id: lane.id)
                    stop()
                    return
                }
            } else { pendingPCM = (lane.id, now) }
        } else { pendingPCM = nil }
        busy = true
        queue.async { [weak self] in
            var frameCost = 0.0
            let failure: VisualizerError? = autoreleasepool {
                do {
                    guard !session.isCancelled else { return nil }
                    if session.renderer == nil {
                        session.renderer = try VisualizerRenderer(device: device, layer: layer, scene: scene, size: size, tint: tint)
                    }
                    guard !session.isCancelled else { return nil }
                    frameCost = try session.renderer?.draw(size: size, tint: tint, lanes: lanes) ?? 0
                    return nil
                } catch { return error as? VisualizerError ?? .engine }
            }
            let measured = frameCost
            DispatchQueue.main.async { [weak self] in
                guard let self, self.session === session else { return }
                self.busy = false
                if let failure { self.unavailable(failure); return }
                self.lastTint = tint
                self.drew = self.surface.metal.drawableSize == size
                if self.framesStill { self.commit(); return }
                switch self.budget.measure(milliseconds: measured, fps: self.displayLink?.preferredFramesPerSecond ?? 30) {
                case .keep: break
                case .reduce: self.commit()
                case .unavailable:
                    VisualizerAvailability.shared.disableForBudget()
                    self.unavailable(.budget)
                }
            }
        }
    }

    private func unavailable(_ reason: VisualizerError) {
        failedScene = sceneID
        stop()
        onUnavailable(["reason": reason.rawValue])
    }

    @objc private func stop() {
        displayLink?.invalidate()
        displayLink = nil
        subscribed.removeAll()
        if let previous = session {
            previous.cancel()
            queue.async { previous.renderer = nil }
            session = nil
        }
        pendingPCM = nil
        runningScene = ""
        budget = VisualizerBudget()
        drew = false
        busy = false
    }
}
