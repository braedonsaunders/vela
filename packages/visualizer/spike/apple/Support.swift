import Foundation
import Accelerate
import AVFoundation
import MediaToolbox

// MARK: - The build-time shader table (tools/apple-shaders.ts)
struct ShaderTable {
    struct Uniform: Decodable { let name: String; let type: Int; let size: Int }
    struct Member: Decodable { let name: String; let type: String; let offset: Int; let count: Int; let arrayStride: Int; let matrixStride: Int }
    struct TextureSlot: Decodable { let name: String; let texture: Int; let sampler: Int }
    struct Stage: Decodable { let msl: String; let entry: String; let ubo: Int; let uboSize: Int; let members: [Member]; let textures: [TextureSlot] }
    struct Screen: Decodable { let msl: String }
    struct Stages: Decodable { let vs: Stage; let vsScreen: Screen; let fs: Stage }
    struct Row: Decodable { let vs: String; let fs: String; let uniforms: [Uniform]; let stages: Stages }
    struct Entry { let uniforms: [Uniform]; let vs: Stage; let vsScreenMsl: String; let fs: Stage }
    let entries: [String: Entry]
    init(url: URL) throws {
        let rows = try JSONDecoder().decode([Row].self, from: Data(contentsOf: url))
        var e: [String: Entry] = [:]
        for r in rows { e[r.vs + "\u{0}" + r.fs] = Entry(uniforms: r.uniforms, vs: r.stages.vs, vsScreenMsl: r.stages.vsScreen.msl, fs: r.stages.fs) }
        entries = e
    }
}

// MARK: - PCM ring, written by the tap (audio render thread), read by the visualizer (render thread)
/// Mono samples indexed by the item's sample clock. The tap runs ≈370 ms ahead of the speaker, so the reader asks
/// for the window that ends at what is being heard now and never meets the writer.
final class PCMRing {
    let capacity = 1 << 17
    let samples: UnsafeMutablePointer<Float>
    private(set) var rate: Double = 48000
    var written: Int64 = 0                      // highest sample index written + 1
    // tap health
    var tapCalls = 0, tapMaxUs: Double = 0, tapNonZeroWhileMuted = false, lastStart: Double = -1, lastPeak: Float = 0, lastFrames = 0
    init() { samples = .allocate(capacity: capacity); samples.initialize(repeating: 0, count: capacity) }
    func setRate(_ r: Double) { rate = r }
    func write(_ mono: UnsafePointer<Float>, count: Int, at index: Int64) {
        for i in 0..<count { samples[Int((index + Int64(i)) & Int64(capacity - 1))] = mono[i] }
        written = max(written, index + Int64(count))
    }
    func read(endingAt index: Int64, into out: UnsafeMutablePointer<Float>, count: Int) {
        for i in 0..<count { let j = index - Int64(count) + Int64(i); out[i] = (j >= 0 && j < written && written - j < Int64(capacity)) ? samples[Int(j & Int64(capacity - 1))] : 0 }
    }
}

// MARK: - Analysis DSP (PROTOCOL.md): AnalyserNode-equivalent spectrum, then the 256-band / 512-point reduction
final class VizDSP {
    let n = 4096
    private let setup: vDSP_DFT_Setup
    private var window = [Float](repeating: 0, count: 4096), frame = [Float](repeating: 0, count: 4096)
    private var re = [Float](repeating: 0, count: 2048), im = [Float](repeating: 0, count: 2048), outRe = [Float](repeating: 0, count: 2048), outIm = [Float](repeating: 0, count: 2048)
    private var smooth = [Float](repeating: 0, count: 2048), db = [Float](repeating: 0, count: 2048)
    private var binOf = [Int](repeating: 1, count: 257)
    private(set) var ms: Double = 0
    init() {
        setup = vDSP_DFT_zrop_CreateSetup(nil, 4096, .FORWARD)!
        for i in 0..<n { let x = Double(i) / Double(n); window[i] = Float(0.42 - 0.5 * cos(2 * .pi * x) + 0.08 * cos(4 * .pi * x)) }
        setRate(48000)
    }
    func setRate(_ rate: Double) {
        let ny = rate / 2
        for i in 0...256 { binOf[i] = min(2047, max(1, Int((28 * pow(16000.0 / 28, Double(i) / 256) / ny * 2048).rounded()))) }
    }
    /// samples: the last 4096 heard samples. Writes bandDb[256] and wave[512].
    func process(_ samples: UnsafePointer<Float>, bandDb: UnsafeMutablePointer<Float>, wave: UnsafeMutablePointer<Float>) {
        let t0 = CACurrentMediaTime()
        vDSP_vmul(samples, 1, window, 1, &frame, 1, vDSP_Length(n))
        // pack even/odd for the real DFT
        frame.withUnsafeBufferPointer { f in for i in 0..<2048 { re[i] = f[2 * i]; im[i] = f[2 * i + 1] } }
        vDSP_DFT_Execute(setup, re, im, &outRe, &outIm)
        // zrop output is twice the mathematical DFT; bin 0 packs DC (re) and Nyquist (im).
        let scale: Float = 0.5 / Float(n)
        for k in 0..<2048 {
            let mag = k == 0 ? abs(outRe[0]) * scale : (outRe[k] * outRe[k] + outIm[k] * outIm[k]).squareRoot() * scale
            smooth[k] = 0.55 * smooth[k] + 0.45 * mag
            db[k] = smooth[k] > 0 ? 20 * log10(smooth[k]) : -.infinity
        }
        // vizReduce
        for i in 0..<256 {
            var m = -Float.infinity; let a = binOf[i], b = max(binOf[i], binOf[i + 1] - 1)
            for j in a...b { m = max(m, db[j]) }
            bandDb[i] = m
        }
        var z = 64
        for i in 64..<1000 where samples[i - 1] < 0 && samples[i] >= 0 && samples[i + 3] > samples[i] { z = i; break }
        for i in 0..<512 { let k = z + i * 6; wave[i] = (samples[k] + samples[k + 1] + samples[k + 2]) / 3 }
        ms = (CACurrentMediaTime() - t0) * 1000
    }
}

// MARK: - The player and its tap (Vela's SoundTap pattern: the tap goes on before the item may play)
final class TapPlayer {
    let ring = PCMRing()
    let player = AVPlayer()
    private(set) var item: AVPlayerItem?
    var stalls = 0
    private var mono = UnsafeMutablePointer<Float>.allocate(capacity: 16384)
    private var channels = 2, interleaved = false
    var muted = false

    func play(url: URL) async throws {
        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw NSError(domain: "viz", code: 2) }
        let item = AVPlayerItem(asset: asset)
        guard let tap = makeTap() else { throw NSError(domain: "viz", code: 3, userInfo: [NSLocalizedDescriptionKey: "no tap: refusing to play"]) }
        let params = AVMutableAudioMixInputParameters(track: track); params.audioTapProcessor = tap
        let mix = AVMutableAudioMix(); mix.inputParameters = [params]; item.audioMix = mix
        NotificationCenter.default.addObserver(forName: AVPlayerItem.playbackStalledNotification, object: item, queue: nil) { [weak self] _ in self?.stalls += 1 }
        self.item = item
        // Not isMuted: muting is applied before the tap (measured: the tap then receives silence). Silence comes from
        // the tap zeroing its own output, and the item cannot start without the tap.
        player.isMuted = false
        player.replaceCurrentItem(with: item)
        player.actionAtItemEnd = .none
        NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in self?.player.seek(to: .zero) }
        player.play()
    }
    /// The heard position on the item's clock, in samples.
    func heardSample() -> Int64 {
        guard let tb = item?.timebase else { return 0 }
        return Int64(CMTimeGetSeconds(CMTimebaseGetTime(tb)) * ring.rate)
    }

    private func makeTap() -> MTAudioProcessingTap? {
        let info = Unmanaged.passUnretained(self).toOpaque()
        var cb = MTAudioProcessingTapCallbacks(
            version: kMTAudioProcessingTapCallbacksVersion_0, clientInfo: info,
            init: { _, clientInfo, storage in storage.pointee = clientInfo },
            finalize: nil,
            prepare: { tap, _, format in
                let me = Unmanaged<TapPlayer>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                let f = format.pointee
                me.ring.setRate(f.mSampleRate); me.channels = Int(f.mChannelsPerFrame)
                me.interleaved = f.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
            },
            unprepare: nil,
            process: { tap, frames, _, bufferList, framesOut, flagsOut in
                var range = CMTimeRange.invalid
                guard MTAudioProcessingTapGetSourceAudio(tap, frames, bufferList, flagsOut, &range, framesOut) == noErr else { return }
                Unmanaged<TapPlayer>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                    .process(bufferList, frames: Int(framesOut.pointee), range: range)
            })
        var tap: MTAudioProcessingTap?
        return MTAudioProcessingTapCreate(kCFAllocatorDefault, &cb, kMTAudioProcessingTapCreationFlag_PreEffects, &tap) == noErr ? tap : nil
    }
    /// Real-time thread: mix to mono, copy into the ring, then silence the output. No locks, no allocation.
    private func process(_ list: UnsafeMutablePointer<AudioBufferList>, frames: Int, range: CMTimeRange) {
        let t0 = CACurrentMediaTime()
        let abl = UnsafeMutableAudioBufferListPointer(list), n = min(frames, 16384)
        for i in 0..<n { mono[i] = 0 }
        var any = false
        if interleaved, let d = abl.first?.mData?.assumingMemoryBound(to: Float.self) {
            let c = max(1, channels); for i in 0..<n { var s: Float = 0; for ch in 0..<c { s += d[i * c + ch] }; mono[i] = s / Float(c) }
        } else {
            let c = max(1, abl.count)
            for b in abl { if let d = b.mData?.assumingMemoryBound(to: Float.self) { for i in 0..<n { mono[i] += d[i] / Float(c) } } }
        }
        for i in 0..<n where mono[i] != 0 { any = true; break }
        var pk: Float = 0; for i in 0..<n { pk = max(pk, abs(mono[i])) }; ring.lastPeak = pk; ring.lastFrames = n; ring.lastStart = range.start.isValid ? CMTimeGetSeconds(range.start) : -1
        if range.start.isValid { ring.write(mono, count: n, at: Int64((CMTimeGetSeconds(range.start) * ring.rate).rounded())) }
        for b in abl { if let d = b.mData { memset(d, 0, Int(b.mDataByteSize)) } }       // nothing is ever heard
        if muted && any { ring.tapNonZeroWhileMuted = true }
        ring.tapCalls += 1; ring.tapMaxUs = max(ring.tapMaxUs, (CACurrentMediaTime() - t0) * 1e6)
    }
}
