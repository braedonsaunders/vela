import UIKit
import JavaScriptCore
import Metal
import QuartzCore

/// The visualizer on a native Apple host: JavaScriptCore and the Metal executor share one render thread, so the
/// framework's per-frame JS and the GPU encoding never touch the main thread or the React Native bridge. Audio
/// reaches it through the tap's ring buffer and the DSP; the command buffer and the analysis arrays are memory both
/// JS and Swift see (no copies, no serialisation).
final class VizHost: NSObject {
    let layer: CAMetalLayer
    private let exec: MetalExecutor
    private let dsp = VizDSP()
    private let tap: TapPlayer
    private var ctx: JSContext!
    private var frameFn: JSValue!, viz: JSValue!
    private let cmdBytes = 16 << 20
    private let cmd: UnsafeMutableRawPointer
    private let bandDb = UnsafeMutablePointer<Float>.allocate(capacity: 256), wave = UnsafeMutablePointer<Float>.allocate(capacity: 512)
    private let window = UnsafeMutablePointer<Float>.allocate(capacity: 4096)
    private var thread: Thread!
    private var link: CADisplayLink?
    private let t0 = CACurrentMediaTime()
    // measurement
    private var acc = (frames: 0, total: 0.0, js: 0.0, dsp: 0.0, gpu: 0.0, gpuMax: 0.0, intervalMax: 0.0), lastTick = 0.0, lastReport = 0.0
    private let statsURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("viz-stats.log")
    var pendingScene: String?
    private var autoCycle: Double

    init(layer: CAMetalLayer, tap: TapPlayer, bundleURL: URL, tableURL: URL, scene: String, cycleSeconds: Double) throws {
        self.layer = layer; self.tap = tap; autoCycle = cycleSeconds
        let device = layer.device ?? MTLCreateSystemDefaultDevice()!
        layer.device = device; layer.pixelFormat = .bgra8Unorm; layer.framebufferOnly = true
        exec = MetalExecutor(device: device, table: try ShaderTable(url: tableURL)); exec.layer = layer
        cmd = .allocate(byteCount: cmdBytes, alignment: 16)
        bandDb.initialize(repeating: -100, count: 256); wave.initialize(repeating: 0, count: 512)
        super.init()
        try? FileManager.default.removeItem(at: statsURL)
        let source = try String(contentsOf: bundleURL, encoding: .utf8)
        let size = layer.bounds.size, scale = layer.contentsScale
        thread = Thread { [weak self] in self?.threadMain(source: source, width: size.width, height: size.height, dpr: scale, scene: scene) }
        thread.name = "viz.render"; thread.qualityOfService = .userInteractive
        thread.start()
    }

    private func now() -> Double { (CACurrentMediaTime() - t0) * 1000 }

    private func threadMain(source: String, width: CGFloat, height: CGFloat, dpr: CGFloat, scene: String) {
        let c = JSContext()!; ctx = c
        c.exceptionHandler = { _, e in NSLog("viz js: \(e?.toString() ?? "?") \(e?.objectForKeyedSubscript("stack")?.toString() ?? "")") }
        let host = JSValue(newObjectIn: c)!
        let ref = c.jsGlobalContextRef
        func noCopy(_ p: UnsafeMutableRawPointer, _ bytes: Int, float: Bool) -> JSValue {
            var exc: JSValueRef?
            let v = float ? JSObjectMakeTypedArrayWithBytesNoCopy(ref, kJSTypedArrayTypeFloat32Array, p, bytes, nil, nil, &exc)
                          : JSObjectMakeArrayBufferWithBytesNoCopy(ref, p, bytes, nil, nil, &exc)
            return JSValue(jsValueRef: v, in: c)
        }
        host.setObject(noCopy(cmd, cmdBytes, float: false), forKeyedSubscript: "commandBuffer" as NSString)
        host.setObject(noCopy(bandDb, 256 * 4, float: true), forKeyedSubscript: "bandDb" as NSString)
        host.setObject(noCopy(wave, 512 * 4, float: true), forKeyedSubscript: "wave" as NSString)
        host.setObject(Double(width), forKeyedSubscript: "width" as NSString)
        host.setObject(Double(height), forKeyedSubscript: "height" as NSString)
        host.setObject(Double(dpr), forKeyedSubscript: "dpr" as NSString)
        host.setObject(tap.ring.rate, forKeyedSubscript: "sampleRate" as NSString)
        host.setObject(scene, forKeyedSubscript: "scene" as NSString)
        let nowFn: @convention(block) () -> Double = { [unowned self] in self.now() }
        let logFn: @convention(block) (String) -> Void = { NSLog("viz: \($0)") }
        let linkFn: @convention(block) (Int32, String, String) -> Any = { [unowned self] id, vs, fs in self.exec.link(id: id, vs: vs, fs: fs) }
        let flushFn: @convention(block) (Int32) -> Void = { [unowned self] words in self.exec.run(self.cmd, words: Int(words)) }
        let imgFn: @convention(block) (JSValue) -> Any = { _ in ["id": 0, "width": 1, "height": 1] }
        host.setObject(nowFn, forKeyedSubscript: "now" as NSString)
        host.setObject(logFn, forKeyedSubscript: "log" as NSString)
        host.setObject(linkFn, forKeyedSubscript: "link" as NSString)
        host.setObject(flushFn, forKeyedSubscript: "flush" as NSString)
        host.setObject(imgFn, forKeyedSubscript: "canvasImage" as NSString)
        c.setObject(host, forKeyedSubscript: "__host" as NSString)
        let tLoad = CACurrentMediaTime()
        c.evaluateScript(source)
        NSLog("viz: bundle evaluated in %.1f ms (link %.1f ms)", (CACurrentMediaTime() - tLoad) * 1000, exec.takeStats().linkMs)
        viz = c.objectForKeyedSubscript("__viz"); frameFn = viz.objectForKeyedSubscript("frame")
        let l = CADisplayLink(target: self, selector: #selector(tick(_:)))
        l.preferredFramesPerSecond = 60
        l.add(to: .current, forMode: .default); link = l
        RunLoop.current.run()
    }

    @objc private func tick(_ l: CADisplayLink) {
        let start = CACurrentMediaTime()
        if let s = pendingScene { pendingScene = nil; viz.objectForKeyedSubscript("setScene").call(withArguments: [s]) }
        if autoCycle > 0, Int(now() / 1000 / autoCycle) != Int((now() - 16) / 1000 / autoCycle) {
            let n = viz.objectForKeyedSubscript("scenes").objectForKeyedSubscript("length").toInt32()
            let cur = viz.objectForKeyedSubscript("scene").toInt32()
            viz.objectForKeyedSubscript("setScene").call(withArguments: [(cur + 1) % max(1, n)])
        }
        // What is heard now: the 4096 samples ending at the item's current time.
        tap.ring.read(endingAt: tap.heardSample(), into: window, count: 4096)
        dsp.process(window, bandDb: bandDb, wave: wave)
        frameFn.call(withArguments: [now()])
        let total = (CACurrentMediaTime() - start) * 1000, ex = exec.takeStats()
        acc.frames += 1; acc.total += total; acc.js += total - ex.encodeMs - dsp.ms; acc.dsp += dsp.ms
        acc.gpu += exec.gpuMs; acc.gpuMax = max(acc.gpuMax, exec.gpuMs)
        if lastTick > 0 { acc.intervalMax = max(acc.intervalMax, (start - lastTick) * 1000) }
        lastTick = start
        if start - lastReport >= 1 { report(ex.draws, ex.passes); lastReport = start }
    }

    private func report(_ draws: Int, _ passes: Int) {
        let n = Double(max(1, acc.frames))
        let st = viz.objectForKeyedSubscript("stats").call(withArguments: [])!
        let res = st.objectForKeyedSubscript("res").toArray() ?? []
        let sceneIx = Int(viz.objectForKeyedSubscript("scene").toInt32())
        let scene = viz.objectForKeyedSubscript("scenes").atIndex(sceneIx).objectForKeyedSubscript("id").toString() ?? "?"
        var peak: Float = 0; for i in 0..<4096 { peak = max(peak, abs(window[i])) }
        var bmax: Float = -1e9; for i in 0..<256 { bmax = max(bmax, bandDb[i]) }
        let dbg = String(format: " written=%.2fs peak=%.3f bandMax=%.1fdB tapStart=%.3f tapPeak=%.3f tapFrames=%d rate=%.0f heardS=%lld", Double(tap.ring.written) / tap.ring.rate, peak, bmax, tap.ring.lastStart, tap.ring.lastPeak, tap.ring.lastFrames, tap.ring.rate, tap.heardSample())
        let a = dbg + (ctx.evaluateScript("JSON.stringify({kick: +A.kick.toFixed(2), bassS: +A.bassS.toFixed(2), beat: A.beat, level: +A.level.toFixed(2)})")?.toString() ?? "")
        let line = String(format: "t=%.0fs scene=%@ fps=%d cpu=%.2fms js=%.2fms dsp=%.3fms gpu=%.2fms gpuMax=%.2fms intervalMax=%.1fms res=%@ draws=%d passes=%d tapCalls=%d tapMax=%.0fus stalls=%d heard=%.2fs output=%@ %@\n",
                          now() / 1000, scene, acc.frames, acc.total / n, acc.js / n, acc.dsp / n, acc.gpu / n, acc.gpuMax, acc.intervalMax,
                          res.map { "\($0)" }.joined(separator: "x"), draws, passes, tap.ring.tapCalls, tap.ring.tapMaxUs, tap.stalls,
                          Double(tap.heardSample()) / tap.ring.rate, "zeroed-in-tap", a)
        NSLog("viz: %@", line)
        if let h = try? FileHandle(forWritingTo: statsURL) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
        else { try? line.write(to: statsURL, atomically: true, encoding: .utf8) }
        acc = (0, 0, 0, 0, 0, 0, 0)
    }
}

final class MetalView: UIView {
    override class var layerClass: AnyClass { CAMetalLayer.self }
    var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
}

final class VizViewController: UIViewController {
    private var host: VizHost?
    private let tap = TapPlayer()
    override func loadView() { view = MetalView(); view.backgroundColor = .black }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard host == nil else { return }
        let v = view as! MetalView
        v.metalLayer.contentsScale = UIScreen.main.scale
        v.metalLayer.drawableSize = CGSize(width: v.bounds.width * UIScreen.main.scale, height: v.bounds.height * UIScreen.main.scale)
        let args = ProcessInfo.processInfo.arguments, arg = { (k: String) in args.firstIndex(of: k).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil } }
        let b = Bundle.main
        let track = arg("-track").map { URL(fileURLWithPath: $0) } ?? b.url(forResource: "track", withExtension: "mp3")!
        Task { @MainActor in
            do {
                try await tap.play(url: track)
                host = try VizHost(layer: v.metalLayer, tap: tap, bundleURL: b.url(forResource: "viz-native", withExtension: "js")!,
                                   tableURL: b.url(forResource: "apple-shaders", withExtension: "json")!, scene: arg("-scene") ?? "ink",
                                   cycleSeconds: Double(arg("-cycle") ?? "0") ?? 0)
            } catch { NSLog("viz: start failed: \(error)") }
        }
    }
    // Remote: left/right change scene (the spike only knows its own two).
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        for p in presses where p.type == .leftArrow || p.type == .rightArrow { host?.pendingScene = p.type == .leftArrow ? "tunnel" : "ink" }
        super.pressesBegan(presses, with: event)
    }
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let c = UISceneConfiguration(name: nil, sessionRole: session.role); c.delegateClass = SceneDelegate.self; return c
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws); w.rootViewController = VizViewController(); w.makeKeyAndVisible(); window = w
    }
}
