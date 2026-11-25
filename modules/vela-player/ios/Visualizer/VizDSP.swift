import Accelerate
import QuartzCore

// MARK: - Analysis DSP (PROTOCOL.md): AnalyserNode-equivalent spectrum, then the 256-band / 512-point reduction
final class VizDSP {
    let n = 4096
    private let setup: vDSP_DFT_Setup
    private let shortSetup: vDSP_DFT_Setup
    private let shortWindow: [Float] = (0..<1024).map { i in
        let phase = 2 * Double.pi * Double(i) / 1024
        return Float(0.42 - 0.5 * cos(phase) + 0.08 * cos(2 * phase))
    }
    private var shortRe = [Float](repeating: 0, count: 512), shortIm = [Float](repeating: 0, count: 512)
    private var shortOutRe = [Float](repeating: 0, count: 512), shortOutIm = [Float](repeating: 0, count: 512)
    private var window = [Float](repeating: 0, count: 4096), frame = [Float](repeating: 0, count: 4096)
    private var re = [Float](repeating: 0, count: 2048), im = [Float](repeating: 0, count: 2048), outRe = [Float](repeating: 0, count: 2048), outIm = [Float](repeating: 0, count: 2048)
    private var smooth = [Float](repeating: 0, count: 2048), db = [Float](repeating: 0, count: 2048)
    private var binOf = [Int](repeating: 1, count: 257)
    private(set) var ms: Double = 0
    init() {
        setup = vDSP_DFT_zrop_CreateSetup(nil, 4096, .FORWARD)!
        shortSetup = vDSP_DFT_zrop_CreateSetup(nil, 1024, .FORWARD)!
        for i in 0..<n { let x = Double(i) / Double(n); window[i] = Float(0.42 - 0.5 * cos(2 * .pi * x) + 0.08 * cos(4 * .pi * x)) }
        setRate(48000)
    }
    deinit {
        vDSP_DFT_DestroySetup(setup)
        vDSP_DFT_DestroySetup(shortSetup)
    }

    func setRate(_ rate: Double) {
        let ny = rate / 2
        for i in 0...256 { binOf[i] = min(2047, max(1, Int((28 * pow(16000.0 / 28, Double(i) / 256) / ny * 2048).rounded()))) }
    }
    /// samples: the last 4096 heard samples. Writes bandDb[256] and wave[512].
    func process(_ samples: UnsafePointer<Float>, bandDb: UnsafeMutablePointer<Float>, wave: UnsafeMutablePointer<Float>, fastDb: UnsafeMutablePointer<Float>? = nil) {
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
        if let fastDb {
            let tail = samples + n - 1024
            for i in 0..<512 {
                shortRe[i] = tail[2 * i] * shortWindow[2 * i]
                shortIm[i] = tail[2 * i + 1] * shortWindow[2 * i + 1]
            }
            vDSP_DFT_Execute(shortSetup, shortRe, shortIm, &shortOutRe, &shortOutIm)
            for i in 0..<512 {
                // The real DFT packs Nyquist in the imaginary half of DC, and its outputs are doubled.
                let amplitude = i == 0 ? abs(shortOutRe[0]) : hypotf(shortOutRe[i], shortOutIm[i])
                fastDb[i] = amplitude > 0 ? 20 * log10(amplitude / 2048) : -.infinity
            }
        }
        ms = (CACurrentMediaTime() - t0) * 1000
    }
}
