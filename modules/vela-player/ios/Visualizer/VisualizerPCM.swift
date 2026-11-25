import AVFoundation
import Foundation

/// The view holds the subscription. Dropping the last view releases the PCM history.
final class VisualizerPCMFeed {
    private let lock = NSLock()
    private var supported: Bool?
    private weak var subscription: VisualizerPCMBuffer?

    func reset() {
        // Main-thread seek/load: a previously queued render may finish with its own history.
        // Every subsequent subscription and tap write uses a fresh item timeline.
        lock.lock()
        subscription = nil
        lock.unlock()
    }

    func setFormatSupported(_ value: Bool) {
        lock.lock()
        supported = value
        lock.unlock()
    }

    var unsupported: Bool {
        lock.lock()
        defer { lock.unlock() }
        return supported == false
    }

    func subscribe() -> VisualizerPCMBuffer {
        lock.lock()
        defer { lock.unlock() }
        if let subscription { return subscription }
        let buffer = VisualizerPCMBuffer()
        subscription = buffer
        return buffer
    }

    /// The sound callback never waits on a reader or changes the supplied audio.
    func append(_ buffers: UnsafeMutableAudioBufferListPointer, frames: Int, channels: Int, interleaved: Bool,
                rate: Double, start: Double, id: Int, split: Int, nextID: Int) {
        guard lock.try() else { return }
        let buffer = subscription
        lock.unlock()
        buffer?.append(buffers, frames: frames, channels: channels, interleaved: interleaved,
                       rate: rate, start: start, id: id, split: split, nextID: nextID)
    }
}

struct VisualizerHeardLane {
    let buffer: VisualizerPCMBuffer
    let id: Int
    let seconds: Double
    let speed: Double
}

/// The tap runs ahead of output. Each block records its item clock, including both sides
/// of a gapless boundary. The reader adds the two AutoMix lanes on one 48 kHz output clock.
final class VisualizerPCMBuffer {
    private struct Block {
        var id = -1, offset = 0, length = 0
        var seconds = 0.0, rate = 0.0
    }
    private let lock = NSLock()
    private static let mask = (1 << 17) - 1
    private var samples = [Float](repeating: 0, count: mask + 1)
    private var blocks = [Block](repeating: Block(), count: 512)
    private var written = 0, blockCount = 0
    private var boundary: (old: Int, new: Int, offset: Int, shift: Double)?


    var hasReceivedSamples: Bool {
        lock.lock()
        defer { lock.unlock() }
        return written > 0
    }

    func append(_ buffers: UnsafeMutableAudioBufferListPointer, frames: Int, channels: Int, interleaved: Bool,
                rate: Double, start: Double, id: Int, split: Int, nextID: Int) {
        guard frames > 0, frames <= Self.mask, channels > 0, rate.isFinite, rate > 0, start.isFinite,
              lock.try() else { return }
        defer { lock.unlock() }
        let mask = Self.mask
        for i in 0..<frames { samples[(written + i) & mask] = 0 }
        let weight = 1 / Float(channels)
        for ch in 0..<channels {
            let index = interleaved ? 0 : ch
            guard index < buffers.count, let base = buffers[index].mData else { continue }
            let stride = interleaved ? channels : 1, offset = interleaved ? ch : 0
            let data = base.assumingMemoryBound(to: Float.self)
            for i in 0..<frames {
                samples[(written + i) & mask] += data[offset + stride * i] * weight
            }
        }
        var initial = start
        if start < 0, blockCount > 0 {
            let previous = blocks[(blockCount - 1) % blocks.count]
            // AVQueuePlayer relabels the old item's tail relative to the next item's start.
            if previous.id == id { initial = previous.seconds + Double(previous.length) / previous.rate }
        }
        if split != 0 { record(id, written, split < 0 ? frames : split, initial, rate) }
        if split >= 0 {
            let offset = written + split
            let seconds = max(0, start + Double(split) / rate)
            if blockCount > 0 {
                let last = blocks[(blockCount - 1) % blocks.count]
                if last.id == id, last.offset + last.length == offset, id != nextID {
                    let oldEnd = last.seconds + Double(last.length) / last.rate
                    boundary = (id, nextID, offset, seconds - oldEnd)
                }
            }
            record(nextID, offset, frames - split, seconds, rate)
        }
        written += frames
    }

    private func record(_ id: Int, _ offset: Int, _ length: Int, _ seconds: Double, _ rate: Double) {
        guard length > 0 else { return }
        if blockCount > 0 {
            let last = blocks[(blockCount - 1) % blocks.count]
            if last.id == id && seconds + 2 / rate < last.seconds + Double(last.length) / last.rate {
                boundary = nil
                blockCount = 0 // Backwards seek. Discard samples from the previous visit.
            }
        }
        blocks[blockCount % blocks.count] = Block(id: id, offset: offset, length: length, seconds: seconds, rate: rate)
        blockCount += 1
    }

    func mix(id: Int, endingAt end: Double, speed: Double, into output: UnsafeMutableBufferPointer<Float>) {
        guard end.isFinite, speed.isFinite, speed > 0, !output.isEmpty else { return }
        let step = speed / 48_000
        let start = end - Double(output.count) * step
        lock.lock()
        defer { lock.unlock() }
        for i in max(0, blockCount - blocks.count)..<blockCount {
            let block = blocks[i % blocks.count]
            guard block.offset + block.length > written - samples.count else { continue }
            let seconds: Double
            if block.id == id {
                seconds = block.seconds
            } else if let boundary, boundary.new == id, block.id == boundary.old,
                      block.offset + block.length <= boundary.offset {
                // Only an explicit queue boundary projects the preceding item's tail into
                // the negative part of the new item's first FFT window.
                seconds = block.seconds + boundary.shift
            } else { continue }
            let blockEnd = seconds + Double(block.length) / block.rate
            guard blockEnd > start, seconds < end else { continue }
            let first = max(0, Int(ceil((seconds - start) / step - 1e-7)))
            let limit = min(output.count, Int(ceil((blockEnd - start) / step - 1e-7)))
            guard first < limit else { continue }
            for j in first..<limit {
                let source = min(block.length - 1, max(0, Int((start + Double(j) * step - seconds) * block.rate + 1e-7)))
                let index = block.offset + source
                if index >= written - samples.count { output[j] += samples[index & Self.mask] }
            }
        }
    }
}
