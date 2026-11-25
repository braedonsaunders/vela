import Foundation
import JavaScriptCore
import Metal
import QuartzCore

enum VisualizerError: String, Error {
    case resources, engine, scene, metal, budget
}

enum VisualizerResources {
    // Resolves the CocoaPods resource bundle in both frameworks and statically linked apps.
    static let bundle: Bundle? = [Bundle(for: VelaVisualizerModule.self), .main].compactMap { owner in
        owner.url(forResource: "VelaVisualizerAssets", withExtension: "bundle").flatMap(Bundle.init(url:))
    }.first

    static var available: Bool {
        guard let bundle else { return false }
        return bundle.url(forResource: "viz-native", withExtension: "js") != nil &&
            bundle.url(forResource: "apple-shaders", withExtension: "json") != nil
    }

    // Loaded on the rendering queue at first use. Only source and reflection are shared.
    static let source: (String, ShaderTable)? = {
        guard let js = bundle?.url(forResource: "viz-native", withExtension: "js"),
              let shaders = bundle?.url(forResource: "apple-shaders", withExtension: "json"),
              let source = try? String(contentsOf: js, encoding: .utf8),
              let table = try? ShaderTable(url: shaders) else { return nil }
        return (source, table)
    }()
}

/// All JS and command encoding is confined to the surface's serial rendering queue.
final class VisualizerRenderer {
    private let context: JSContext
    private let executor: MetalExecutor
    private let dsp = VizDSP()
    private var samples = [Float](repeating: 0, count: 4096)
    private let band: UnsafeMutablePointer<Float>, wave: UnsafeMutablePointer<Float>, fastDb: UnsafeMutablePointer<Float>
    private var frame: JSValue!, resize: JSValue!
    private var tint: [String]
    private var applyTint: JSValue?
    private var size: CGSize
    private var error: VisualizerError?
    private let epoch = CACurrentMediaTime()

    init(device: MTLDevice, layer: CAMetalLayer, scene: String, size: CGSize, tint: [String]) throws {
        guard let (source, table) = VisualizerResources.source else { throw VisualizerError.resources }
        guard let c = JSContext(), let host = JSValue(newObjectIn: c) else { throw VisualizerError.engine }
        self.size = size
        self.tint = tint
        context = c
        executor = try MetalExecutor(device: device, table: table)
        executor.layer = layer
        let commandBytes = 16 << 20
        // JSC owns the backing memory and releases it with its typed arrays, even on partial setup failure.
        func shared(_ bytes: Int, float: Bool) throws -> (JSValue, UnsafeMutableRawPointer) {
            guard let p = calloc(1, bytes) else { throw VisualizerError.engine }
            let release: JSTypedArrayBytesDeallocator = { address, _ in free(address) }
            var exception: JSValueRef?
            let ref = float ? JSObjectMakeTypedArrayWithBytesNoCopy(c.jsGlobalContextRef, kJSTypedArrayTypeFloat32Array, p, bytes, release, nil, &exception)
                : JSObjectMakeArrayBufferWithBytesNoCopy(c.jsGlobalContextRef, p, bytes, release, nil, &exception)
            guard let ref, exception == nil else { throw VisualizerError.engine }
            return (JSValue(jsValueRef: ref, in: c), p)
        }
        let (commands, commandMemory) = try shared(commandBytes, float: false)
        let (bands, bandMemory) = try shared(256 * 4, float: true)
        let (waves, waveMemory) = try shared(512 * 4, float: true)
        let (fast, fastMemory) = try shared(512 * 4, float: true)
        fastDb = fastMemory.assumingMemoryBound(to: Float.self)
        fastDb.initialize(repeating: -.infinity, count: 512)
        band = bandMemory.assumingMemoryBound(to: Float.self)
        wave = waveMemory.assumingMemoryBound(to: Float.self)
        band.initialize(repeating: -100, count: 256)
        func put(_ key: String, _ value: Any) { host.setObject(value, forKeyedSubscript: key as NSString) }
        put("commandBuffer", commands)
        put("bandDb", bands)
        put("wave", waves)
        put("fastFreq", fast)
        put("width", size.width)
        put("height", size.height)
        put("dpr", 1)
        put("sampleRate", 48_000)
        put("maxSamples", device.supportsTextureSampleCount(4) ? 4 : device.supportsTextureSampleCount(2) ? 2 : 1)
        put("scene", scene)
        put("artworkTint", tint[0])
        put("accent", tint[1])
        let clock: @convention(block) () -> Double = { [epoch] in (CACurrentMediaTime() - epoch) * 1000 }
        let log: @convention(block) (String) -> Void = { NSLog("VelaVisualizer: %@", $0) }
        let link: @convention(block) (Int32, String, String) -> Any = { [executor] id, vs, fs in
            executor.link(id: id, vs: vs, fs: fs)
        }
        let flush: @convention(block) (Int32) -> Void = { [weak self] words in
            guard words > 0, Int(words) <= commandBytes / 4 else { self?.error = .engine; return }
            self?.executor.run(commandMemory, words: Int(words))
        }
        put("now", clock)
        put("log", log)
        put("link", link)
        put("flush", flush)
        c.setObject(host, forKeyedSubscript: "__host" as NSString)
        c.exceptionHandler = { [weak self] _, exception in
            NSLog("VelaVisualizer: %@", exception?.toString() ?? "JavaScript exception")
            self?.error = .engine
        }
        c.evaluateScript(source)
        guard error == nil, let viz = c.objectForKeyedSubscript("__viz"),
              let scenes = viz.objectForKeyedSubscript("scenes")?.toArray() as? [[String: Any]],
              scenes.contains(where: { $0["id"] as? String == scene }),
              let frame = viz.objectForKeyedSubscript("frame"), !frame.isUndefined,
              let resize = viz.objectForKeyedSubscript("resize"), !resize.isUndefined else { throw VisualizerError.scene }
        let broken = viz.objectForKeyedSubscript("stats")?.call(withArguments: [])?.objectForKeyedSubscript("broken")?.toArray() as? [String]
        if broken?.contains(scene) == true { throw VisualizerError.scene }
        applyTint = viz.objectForKeyedSubscript("tint")
        self.frame = frame
        self.resize = resize
    }

    func draw(size newSize: CGSize, tint newTint: [String], lanes: [VisualizerHeardLane]) throws -> Double {
        let started = CACurrentMediaTime()
        if tint != newTint {
            tint = newTint
            if let applyTint, !applyTint.isUndefined { applyTint.call(withArguments: tint) }
        }
        if size != newSize {
            size = newSize
            resize.call(withArguments: [size.width, size.height, 1])
        }
        samples.withUnsafeMutableBufferPointer { out in
            out.update(repeating: 0)
            for lane in lanes {
                lane.buffer.mix(id: lane.id, endingAt: lane.seconds, speed: lane.speed, into: out)
            }
            dsp.process(out.baseAddress!, bandDb: band, wave: wave, fastDb: fastDb)
        }
        frame.call(withArguments: [(CACurrentMediaTime() - epoch) * 1000])
        if let error { throw error }
        if executor.hasFailed { throw VisualizerError.metal }
        return max(executor.gpuMs, (CACurrentMediaTime() - started) * 1000)
    }
}
