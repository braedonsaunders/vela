import AudioToolbox
import Foundation

@main struct Probe {
    static func main() {
        var budget = VisualizerBudget()
        for _ in 0..<500 { precondition(budget.measure(milliseconds: 16, fps: 60) == .keep) }
        var reductions = 0, failed = false
        for _ in 0..<400 {
            let action = budget.measure(milliseconds: 48, fps: 30)
            if action == .reduce { reductions += 1 }
            if action == .unavailable { failed = true; break }
        }
        precondition(reductions == 2 && budget.pixelCap == 640 && failed)
        // One second-half tone checks the short FFT's scale and its 1024-sample window.
        var samples = [Float](repeating: 0, count: 4096)
        for i in 0..<1024 { samples[3072 + i] = sin(Float(2 * Double.pi * 16 * Double(i) / 1024)) }
        var bands = [Float](repeating: 0, count: 256), wave = [Float](repeating: 0, count: 512)
        var fast = [Float](repeating: 0, count: 512)
        let dsp = VizDSP()
        dsp.process(samples, bandDb: &bands, wave: &wave, fastDb: &fast)
        precondition(abs(fast[16] - 20 * log10(Float(0.42 / 2))) < 0.001)
        samples = [Float](repeating: 0, count: 4096)
        for i in 0..<3072 { samples[i] = 0.5 }
        dsp.process(samples, bandDb: &bands, wave: &wave, fastDb: &fast)
        precondition(fast.allSatisfy { $0 == -.infinity })
        let rate = 48_000.0
        let feed = VisualizerPCMFeed(), first = feed.subscribe()
        precondition(first === feed.subscribe())
        func sendStereo(_ data: inout [Float], _ id: Int, _ start: Double, split: Int = -1, next: Int = 0, streamOffset: Int? = nil) {
            data.withUnsafeMutableBytes { source in
                var list = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 2,
                    mDataByteSize: UInt32(source.count), mData: source.baseAddress))
                withUnsafeMutablePointer(to: &list) { ptr in
                    feed.append(UnsafeMutableAudioBufferListPointer(ptr), frames: source.count / 8, channels: 2,
                                interleaved: true, rate: rate, start: start, id: id, split: split, nextID: next, streamOffset: streamOffset)
                }
            }
        }
        func read(_ id: Int, _ end: Double, _ n: Int, speed: Double = 1) -> [Float] {
            var out = [Float](repeating: 0, count: n)
            out.withUnsafeMutableBufferPointer { first.mix(id: id, endingAt: end, speed: speed, into: $0) }
            return out
        }
        var pairs: [Float] = [0,2, 2,4, 4,6, 6,8]
        sendStereo(&pairs, 11, 0)
        precondition(pairs == [0,2, 2,4, 4,6, 6,8]) // Read-only tap
        precondition(read(11, 4 / rate, 4) == [1,3,5,7])
        precondition(read(11, 2 / rate, 4) == [0,0,1,3]) // Window ending at heard time ignores the decoded future.
        precondition(read(12, 4 / rate, 4) == [0,0,0,0])
        precondition(read(11, 4 / rate, 2, speed: 2) == [1,5])
        var next: [Float] = [8,10, 10,12, 12,14, 14,16]
        sendStereo(&next, 11, -2 / rate, split: 2, next: 12)
        precondition(read(11, 6 / rate, 2) == [9,11])
        precondition(read(12, 2 / rate, 2) == [13,15])
        precondition(read(12, 2 / rate, 6) == [5,7,9,11,13,15])
        var mix = read(11, 6 / rate, 2)
        mix.withUnsafeMutableBufferPointer { first.mix(id: 12, endingAt: 2 / rate, speed: 1, into: $0) }
        precondition(mix == [22,26])
        sendStereo(&pairs, 12, 2)
        sendStereo(&pairs, 12, 0)
        precondition(read(12, 2 / rate, 4) == [0,0,1,3])
        // A full 4096-sample FFT two samples into the incoming item. Fill the previous
        // track's complete tail, including the part AVQueuePlayer labels with negative time.
        var preceding = [Float](repeating: 0.25, count: 4096 * 2)
        sendStereo(&preceding, 20, 1)
        sendStereo(&next, 20, -2 / rate, split: 2, next: 21)
        let across = read(21, 2 / rate, 4096)
        precondition(across.prefix(4092).allSatisfy { $0 == 0.25 } && Array(across.suffix(4)) == [9,11,13,15])
        // If a busy reader dropped a callback, those samples stay silent at their own
        // locations even when the next callback is relabelled against the incoming item.
        sendStereo(&pairs, 30, 0, streamOffset: 100)
        sendStereo(&next, 30, -2 / rate, split: 2, next: 31, streamOffset: 106)
        precondition(read(31, 2 / rate, 8) == [5,7,0,0,9,11,13,15])
        feed.reset()
        precondition(feed.subscribe() !== first)
        precondition(read(12, 2 + 4 / rate, 4) == [0,0,0,0]) // Backwards seek invalidates prior history.
    }
}
