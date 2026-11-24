// Sound on Apple (docs/sound.md): levelling, the equalizer and AutoMix's fades, applied to the PCM
// AVPlayer decodes by an MTAudioProcessingTap on every item's audioMix. A player's items share one tap
// (SoundTapContext), which switches to the next item's gain on that item's first sample; the EQ is
// shared by every player. Parameters reach the live taps through a lock the render thread only ever
// tries (never waits on), and every change glides over 10 ms, so nothing clicks. The filters are
// Robert Bristow-Johnson's cookbook biquads exactly as Web Audio's BiquadFilterNode defines them
// (packages/core/src/audio/eq.ts), run in double precision.
import AVFoundation
import Foundation
import MediaToolbox
import os

/// One EQ filter as JavaScript sends it (NativeEqFilter).
struct SoundFilter: Equatable {
    enum Kind: Int32 { case lowshelf, peaking, highshelf }
    var kind: Kind
    var frequency: Double
    var q: Double
    var gainDb: Double
}

/// The EQ chain: a gain before the filters (dB), then the filters in order.
struct SoundEQ: Equatable {
    var preGainDb: Double
    var filters: [SoundFilter]
}

/// Normalised biquad coefficients (a0 = 1): y = b0·x + b1·x1 + b2·x2 − a1·y1 − a2·y2.
struct SoundBiquad: Equatable {
    var b0: Double, b1: Double, b2: Double, a1: Double, a2: Double

    static let identity = SoundBiquad(b0: 1, b1: 0, b2: 0, a1: 0, a2: 0)

    /// eq.ts `biquad()`: a frequency at or above Nyquist passes the high shelf's gain, or nothing changes.
    static func make(_ filter: SoundFilter, sampleRate: Double) -> SoundBiquad {
        let A = pow(10, filter.gainDb / 40)
        guard filter.frequency > 0, filter.frequency < sampleRate / 2 else {
            return filter.kind == .highshelf && filter.frequency > 0 ? SoundBiquad(b0: A * A, b1: 0, b2: 0, a1: 0, a2: 0) : .identity
        }
        let w0 = 2 * Double.pi * filter.frequency / sampleRate
        let cosw = cos(w0), sinw = sin(w0)
        var b0: Double, b1: Double, b2: Double, a0: Double, a1: Double, a2: Double
        switch filter.kind {
        case .peaking:
            let alpha = sinw / (2 * (filter.q > 0 ? filter.q : 1e-4))
            b0 = 1 + alpha * A; b1 = -2 * cosw; b2 = 1 - alpha * A
            a0 = 1 + alpha / A; a1 = -2 * cosw; a2 = 1 - alpha / A
        case .lowshelf, .highshelf:
            // Shelf slope 1.
            let alpha = sinw / 2 * 2.0.squareRoot()
            let root = 2 * A.squareRoot() * alpha
            if filter.kind == .lowshelf {
                b0 = A * ((A + 1) - (A - 1) * cosw + root); b1 = 2 * A * ((A - 1) - (A + 1) * cosw); b2 = A * ((A + 1) - (A - 1) * cosw - root)
                a0 = (A + 1) + (A - 1) * cosw + root; a1 = -2 * ((A - 1) + (A + 1) * cosw); a2 = (A + 1) + (A - 1) * cosw - root
            } else {
                b0 = A * ((A + 1) + (A - 1) * cosw + root); b1 = -2 * A * ((A - 1) + (A + 1) * cosw); b2 = A * ((A + 1) + (A - 1) * cosw - root)
                a0 = (A + 1) - (A - 1) * cosw + root; a1 = 2 * ((A - 1) - (A + 1) * cosw); a2 = (A + 1) - (A - 1) * cosw - root
            }
        }
        return SoundBiquad(b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0)
    }
}

/// The one lock between the main thread (writes) and the render threads (tries, never waits).
private let soundLock: UnsafeMutablePointer<os_unfair_lock> = {
    let lock = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1)
    lock.initialize(to: os_unfair_lock())
    return lock
}()

private let maxFilters = 16
private let maxChannels = 8
/// Every gain and EQ change glides over this long (seconds).
private let glideSeconds = 0.010

/// The EQ every tap applies, written on the main thread.
final class SoundSharedEQ: @unchecked Sendable {
    static let shared = SoundSharedEQ()
    fileprivate var generation: UInt64 = 0
    fileprivate var preGainDb: Double = 0
    fileprivate var count = 0
    fileprivate let filters = UnsafeMutablePointer<SoundFilter>.allocate(capacity: maxFilters)
    private(set) var current: SoundEQ?

    func set(_ eq: SoundEQ?) {
        guard eq != current else { return }
        current = eq
        let filters = Array((eq?.filters ?? []).prefix(maxFilters))
        os_unfair_lock_lock(soundLock)
        preGainDb = eq?.preGainDb ?? 0
        count = filters.count
        for (i, filter) in filters.enumerated() { self.filters[i] = filter }
        generation &+= 1
        os_unfair_lock_unlock(soundLock)
    }
}

/// A gain before the filters and up to `maxFilters` biquads with their state, per channel.
private struct SoundChain {
    var preGain = 1.0
    var count = 0
    let coefficients = UnsafeMutablePointer<SoundBiquad>.allocate(capacity: maxFilters)
    /// x1, x2, y1, y2 for each filter and channel.
    let state = UnsafeMutablePointer<Double>.allocate(capacity: maxFilters * maxChannels * 4)

    init() { reset() }

    func reset() { state.update(repeating: 0, count: maxFilters * maxChannels * 4) }

    func free() {
        coefficients.deallocate()
        state.deallocate()
    }

    @inline(__always)
    func process(_ input: Double, channel: Int) -> Double {
        var x = input * preGain
        var f = 0
        while f < count {
            let c = coefficients[f]
            let s = state + (f * maxChannels + channel) * 4
            let y = c.b0 * x + c.b1 * s[0] + c.b2 * s[1] - c.a1 * s[2] - c.a2 * s[3]
            s[1] = s[0]; s[0] = x
            s[3] = s[2]; s[2] = y
            x = y
            f += 1
        }
        return x
    }
}

/// One player's tap, shared by every item the player queues: the items' levelling gains, the playing
/// item's AutoMix fade, and the shared EQ. A gapless queue keeps one audio pipeline only while its
/// items share one tap (a tap per item makes AVQueuePlayer stop and restart between them, ~0.4 s).
///
/// The item boundary is exact without a timing guess: when the queue moves on, the player relabels the
/// blocks still to come with the next item's clock, so the outgoing item's last samples arrive with
/// negative times and the next item's first sample is time 0. The next item's gain applies from there.
final class SoundTapContext: @unchecked Sendable {
    enum Fade: Equatable {
        case none
        /// cos(π/2·x) from `start` (item seconds) over `seconds`, then silence.
        case out(start: Double, seconds: Double)
        /// Silence until `start`, then sin(π/2·x) over `seconds`.
        case into(start: Double, seconds: Double)
    }

    struct ItemSound: Equatable {
        var id: Int
        var gain: Double
        var fade: Fade = .none
    }

    private static var serials = 0
    /// The stream this tap renders (capture only).
    let serial: Int

    // Written on the main thread under soundLock.
    private var current = ItemSound(id: 0, gain: 1)
    private var next: ItemSound?
    /// The main thread's count of items the queue moved on to, and of seeks.
    private var advances: UInt64 = 0
    private var resets: UInt64 = 0
    private var generation: UInt64 = 1

    // The render thread's own copy.
    private var seenGeneration: UInt64 = 0
    private var seenEQ: UInt64 = .max
    private var playing = ItemSound(id: 0, gain: 1)
    private var queued: ItemSound?
    private var localAdvances: UInt64 = 0
    private var localResets: UInt64 = 0
    /// The queue moved on: the next item starts at time 0 on the relabelled clock.
    private var advancing = false
    private var lastStart: Int64?
    private var gain = 1.0
    private var gainStep = 0.0
    private var gainLeft = 0
    private var sampleRate = 48000.0
    private var channels = 0
    private var interleaved = false
    private var supported = false
    private var started = false
    private var glideLength = 480
    private var glideLeft = 0
    private var maxFrames = 0
    private var envelope: UnsafeMutablePointer<Double>?
    private var active = SoundChain()
    private var previous = SoundChain()
    /// Where the next frame falls (seconds), when the source gives no time.
    private var nextTime = 0.0

    init() {
        Self.serials += 1
        serial = Self.serials
    }

    deinit {
        active.free()
        previous.free()
        envelope?.deallocate()
    }

    private static func clamp(_ gain: Double) -> Double { gain.isFinite ? min(max(gain, 0), 16) : 1 }

    private func write(_ change: () -> Void) {
        os_unfair_lock_lock(soundLock)
        change()
        generation &+= 1
        os_unfair_lock_unlock(soundLock)
    }

    /// A new item from the start (a load, or a crossfade's incoming item).
    func start(id: Int, gain: Double) {
        write {
            current = ItemSound(id: id, gain: Self.clamp(gain))
            next = nil
            resets &+= 1
        }
    }

    /// The playing item's gain.
    func setGain(_ value: Double) { write { current.gain = Self.clamp(value) } }

    /// The playing item's fade.
    func setFade(_ value: Fade) { write { current.fade = value } }

    /// The item queued behind the playing one (nil: none).
    func queue(_ item: ItemSound?) { write { next = item.map { ItemSound(id: $0.id, gain: Self.clamp($0.gain)) } } }

    /// The queue moved on (the player's current item changed).
    func advanced() {
        write {
            if let next { current = next }
            next = nil
            advances &+= 1
        }
    }

    /// A seek: the clock jumps, and a move to the next item that has not been reached is undone.
    func seeked() { write { resets &+= 1 } }

    // MARK: Render thread

    fileprivate func prepare(maxFrames: Int, format: AudioStreamBasicDescription) {
        sampleRate = format.mSampleRate > 0 ? format.mSampleRate : 48000
        channels = Int(format.mChannelsPerFrame)
        interleaved = format.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        supported = format.mFormatID == kAudioFormatLinearPCM && format.mFormatFlags & kAudioFormatFlagIsFloat != 0
            && format.mBitsPerChannel == 32 && channels > 0 && channels <= maxChannels
        if !supported { print("[vela-sound] tap format unsupported id=\(format.mFormatID) flags=\(format.mFormatFlags) bits=\(format.mBitsPerChannel) channels=\(channels)") }
        glideLength = max(1, Int(sampleRate * glideSeconds))
        envelope?.deallocate()
        self.maxFrames = max(maxFrames, 1)
        envelope = .allocate(capacity: self.maxFrames)
        seenEQ = .max
        started = false
        lastStart = nil
    }

    fileprivate func unprepare() {
        envelope?.deallocate()
        envelope = nil
        maxFrames = 0
    }

    private func setPlaying(_ item: ItemSound, exact: Bool) {
        if item.gain != playing.gain || exact {
            if started && !exact {
                gainLeft = glideLength
                gainStep = (item.gain - gain) / Double(glideLength)
            } else {
                gain = item.gain
                gainLeft = 0
            }
        }
        playing = item
    }

    /// Picks up new parameters if the main thread isn't writing them this instant (a stream's first
    /// block waits the microsecond, so it never starts with the wrong gain).
    private func refresh(waiting: Bool) {
        if waiting { os_unfair_lock_lock(soundLock) } else if !os_unfair_lock_trylock(soundLock) { return }
        if seenGeneration != generation {
            seenGeneration = generation
            if localResets != resets {
                // A seek: the player's view wins (a boundary crossed before the seek took effect is undone).
                localResets = resets
                localAdvances = advances
                advancing = false
            }
            if advances == localAdvances {
                setPlaying(current, exact: !started)
                queued = next
            } else if advances &+ 1 == localAdvances {
                // This thread already moved on; the main thread hasn't heard yet: its next item plays.
                if let next { setPlaying(next, exact: false) }
                queued = nil
            } else {
                // The main thread moved on and this thread never saw the boundary: follow, gliding.
                localAdvances = advances
                advancing = false
                setPlaying(current, exact: !started)
                queued = next
            }
            if queued == nil { advancing = false }
        }
        let eq = SoundSharedEQ.shared
        if seenEQ != eq.generation {
            if started {
                // Glide: the old chain keeps running beside the new one, which starts from its state.
                swap(&active, &previous)
                active.state.update(from: previous.state, count: maxFilters * maxChannels * 4)
                glideLeft = glideLength
            } else {
                active.reset()
            }
            seenEQ = eq.generation
            active.preGain = pow(10, eq.preGainDb / 20)
            active.count = eq.count
            for i in 0..<eq.count { active.coefficients[i] = SoundBiquad.make(eq.filters[i], sampleRate: sampleRate) }
        }
        os_unfair_lock_unlock(soundLock)
    }

    @inline(__always)
    private func fadeGain(_ t: Double) -> Double {
        switch playing.fade {
        case .none: return 1
        case .out(let start, let seconds):
            if t <= start { return 1 }
            if t >= start + seconds { return 0 }
            return cos(Double.pi / 2 * (t - start) / seconds)
        case .into(let start, let seconds):
            if t <= start { return 0 }
            if t >= start + seconds { return 1 }
            return sin(Double.pi / 2 * (t - start) / seconds)
        }
    }

    fileprivate func process(_ list: UnsafeMutablePointer<AudioBufferList>, frames: Int, range: CMTimeRange, flags: MTAudioProcessingTapFlags) {
        guard frames > 0 else { return }
        let buffers = UnsafeMutableAudioBufferListPointer(list)
        let valid = range.start.isNumeric
        let startTime = valid ? range.start.seconds : nextTime
        nextTime = startTime + Double(frames) / sampleRate
        let label: Int64? = valid ? Int64((startTime * sampleRate).rounded()) : nil
        var item = playing.id
        var split = -1
        if supported, let envelope, frames <= maxFrames {
            if flags & MTAudioProcessingTapFlags(kMTAudioProcessingTapFlag_StartOfStream) != 0 {
                // A discontinuity (a start, a seek): no filter history, no glide.
                active.reset()
                glideLeft = 0
                started = false
            }
            refresh(waiting: !started)
            if !started {
                gain = playing.gain
                gainLeft = 0
                started = true
            }
            item = playing.id
            // The queue moved on: the blocks still to come carry the next item's clock (negative until it starts).
            if let label, let last = lastStart, last >= 0, label < 0, queued != nil { advancing = true }
            for i in 0..<frames {
                let t = startTime + Double(i) / sampleRate
                if advancing, t >= 0, let next = queued {
                    // The next item's first sample: its own gain, exactly.
                    advancing = false
                    queued = nil
                    localAdvances &+= 1
                    setPlaying(next, exact: true)
                    split = i
                }
                if gainLeft > 0 {
                    gain += gainStep
                    gainLeft -= 1
                    if gainLeft == 0 { gain = playing.gain }
                }
                envelope[i] = gain * fadeGain(t)
            }
            let glide = glideLeft
            for channel in 0..<channels {
                let data: UnsafeMutablePointer<Float>
                let stride: Int
                if interleaved {
                    guard let base = buffers[0].mData else { continue }
                    data = base.assumingMemoryBound(to: Float.self) + channel
                    stride = channels
                } else {
                    guard channel < buffers.count, let base = buffers[channel].mData else { continue }
                    data = base.assumingMemoryBound(to: Float.self)
                    stride = 1
                }
                var i = 0
                while i < frames {
                    let x = Double(data[i * stride])
                    var y = active.process(x, channel: channel)
                    if i < glide {
                        let w = Double(glideLength - glide + i + 1) / Double(glideLength)
                        y = y * w + previous.process(x, channel: channel) * (1 - w)
                    }
                    data[i * stride] = Float(y * envelope[i])
                    i += 1
                }
            }
            glideLeft = max(0, glide - frames)
        }
        lastStart = label
        #if DEBUG
        if SoundCapture.active {
            SoundCapture.shared.append(stream: serial, id: item, split: split, next: split >= 0 ? playing.id : -1, rate: sampleRate, channels: channels,
                                       interleaved: interleaved, range: range, frames: frames, buffers: buffers, supported: supported, flags: flags)
        }
        if SoundCapture.silent {
            for buffer in buffers { if let data = buffer.mData { memset(data, 0, Int(buffer.mDataByteSize)) } }
        }
        #endif
    }

    // MARK: The tap

    /// The tap for a player's items; the tap keeps the context until it is released.
    func makeTap() -> MTAudioProcessingTap? {
        let info = Unmanaged.passRetained(self).toOpaque()
        var callbacks = MTAudioProcessingTapCallbacks(
            version: kMTAudioProcessingTapCallbacksVersion_0,
            clientInfo: info,
            init: { _, clientInfo, storage in storage.pointee = clientInfo },
            finalize: { tap in Unmanaged<SoundTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release() },
            prepare: { tap, maxFrames, format in
                Unmanaged<SoundTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                    .prepare(maxFrames: Int(maxFrames), format: format.pointee)
            },
            unprepare: { tap in Unmanaged<SoundTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue().unprepare() },
            process: { tap, numberFrames, _, bufferList, numberFramesOut, flagsOut in
                var range = CMTimeRange.invalid
                let status = MTAudioProcessingTapGetSourceAudio(tap, numberFrames, bufferList, flagsOut, &range, numberFramesOut)
                guard status == noErr else { return }
                Unmanaged<SoundTapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
                    .process(bufferList, frames: Int(numberFramesOut.pointee), range: range, flags: flagsOut.pointee)
            })
        var tap: MTAudioProcessingTap?
        let status = MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PreEffects, &tap)
        if status != noErr || tap == nil {
            Unmanaged<SoundTapContext>.fromOpaque(info).release()
            return nil
        }
        return tap
    }
}

/// A player's sound: its tap, put on each item's audio mix, and which items have it.
@MainActor
final class SoundLane {
    let context = SoundTapContext()
    private lazy var tap: MTAudioProcessingTap? = context.makeTap()
    /// Per item: true with the tap on its audio mix, false when it cannot have one (it plays as decoded).
    private var items: [ObjectIdentifier: Bool] = [:]

    /// Whether the item may start: its tap is in place, or it cannot have one. While capturing, an item
    /// without the tap never plays, so nothing is heard.
    func ready(_ item: AVPlayerItem) -> Bool {
        let state = items[ObjectIdentifier(item)]
        #if DEBUG
        if SoundCapture.silent { return state == true }
        #endif
        return state != nil
    }

    func forget(_ item: AVPlayerItem) { items[ObjectIdentifier(item)] = nil }

    /// Puts the tap on the item once its audio track is known; `done(true)` with the tap in place.
    func attach(_ item: AVPlayerItem, done: @escaping @MainActor (Bool) -> Void) {
        item.asset.loadTracks(withMediaType: .audio) { tracks, _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let track = tracks?.first, let tap = self.tap else {
                        self.items[ObjectIdentifier(item)] = false
                        done(false)
                        return
                    }
                    let parameters = AVMutableAudioMixInputParameters(track: track)
                    parameters.audioTapProcessor = tap
                    let mix = AVMutableAudioMix()
                    mix.inputParameters = [parameters]
                    item.audioMix = mix
                    self.items[ObjectIdentifier(item)] = true
                    done(true)
                }
            }
        }
    }
}

#if DEBUG
/// Measurement capture (docs/sound.md, stage 2 verification): every tap's processed output, with the
/// item and the item time of each block, and the players' clocks against host time, written to
/// `<path>.f32` (interleaved float32) and `<path>.json`. Capturing also silences the output, and the
/// output stays silent for the rest of the process: nothing measured is ever heard.
final class SoundCapture: @unchecked Sendable {
    static let shared = SoundCapture()
    nonisolated(unsafe) static var active = false
    nonisolated(unsafe) static var silent = false

    private struct Chunk {
        var stream: Int32, id: Int32, split: Int32, next: Int32, channels: Int32, rate: Double, start: CMTime, frames: Int32, offset: Int, host: UInt64, supported: Bool, flags: UInt32
    }

    private let lock: UnsafeMutablePointer<os_unfair_lock> = {
        let lock = UnsafeMutablePointer<os_unfair_lock>.allocate(capacity: 1)
        lock.initialize(to: os_unfair_lock())
        return lock
    }()
    private var samples: UnsafeMutablePointer<Float>?
    private var capacity = 0
    private var used = 0
    private var chunks: UnsafeMutablePointer<Chunk>?
    private var chunkCapacity = 0
    private var chunkCount = 0
    private var overflow = false
    private var path: String?
    /// Main thread: clocks and events.
    private var clocks: [[String: Any]] = []
    private var events: [[String: Any]] = []

    static var hostSeconds: Double { CMClockGetTime(CMClockGetHostTimeClock()).seconds }

    /// Starts a capture of up to `seconds` of stereo 48 kHz audio across all items.
    func begin(path: String, seconds: Double = 200) {
        SoundCapture.silent = true
        os_unfair_lock_lock(lock)
        samples?.deallocate()
        chunks?.deallocate()
        capacity = Int(seconds * 48000 * 2)
        samples = .allocate(capacity: capacity)
        chunkCapacity = 400_000
        chunks = .allocate(capacity: chunkCapacity)
        used = 0
        chunkCount = 0
        overflow = false
        os_unfair_lock_unlock(lock)
        self.path = path
        clocks = []
        events = []
        SoundCapture.active = true
    }

    func append(stream: Int, id: Int, split: Int, next: Int, rate: Double, channels: Int, interleaved: Bool, range: CMTimeRange, frames: Int,
                buffers: UnsafeMutableAudioBufferListPointer, supported: Bool, flags: UInt32) {
        os_unfair_lock_lock(lock)
        defer { os_unfair_lock_unlock(lock) }
        guard let samples, let chunks, chunkCount < chunkCapacity, used + frames * channels <= capacity else {
            overflow = true
            return
        }
        chunks[chunkCount] = Chunk(stream: Int32(stream), id: Int32(id), split: Int32(split), next: Int32(next), channels: Int32(channels), rate: rate, start: range.start, frames: Int32(frames),
                                   offset: used, host: mach_absolute_time(), supported: supported, flags: flags)
        chunkCount += 1
        for i in 0..<frames {
            for channel in 0..<channels {
                var value: Float = 0
                if supported {
                    if interleaved {
                        if let data = buffers[0].mData?.assumingMemoryBound(to: Float.self) { value = data[i * channels + channel] }
                    } else if channel < buffers.count, let data = buffers[channel].mData?.assumingMemoryBound(to: Float.self) {
                        value = data[i]
                    }
                }
                samples[used] = value
                used += 1
            }
        }
    }

    /// Records each item's clock at one host instant (main thread).
    func clock(_ entries: [(id: Int, role: String, item: AVPlayerItem)]) {
        guard SoundCapture.active else { return }
        let hostClock = CMClockGetHostTimeClock()
        let now = CMClockGetTime(hostClock)
        var record: [String: Any] = ["host": now.seconds]
        var items: [[String: Any]] = []
        for entry in entries {
            guard let timebase = entry.item.timebase else { continue }
            let time = CMSyncConvertTime(now, from: hostClock, to: timebase)
            items.append(["id": entry.id, "role": entry.role, "time": time.seconds, "rate": CMTimebaseGetRate(timebase)])
        }
        record["items"] = items
        clocks.append(record)
    }

    func event(_ name: String, _ fields: [String: Any] = [:]) {
        guard SoundCapture.active else { return }
        var record = fields
        record["event"] = name
        record["host"] = SoundCapture.hostSeconds
        events.append(record)
    }

    /// Stops capturing and writes the files (the output stays silent).
    func finish() {
        SoundCapture.active = false
        guard let path else { return }
        os_unfair_lock_lock(lock)
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        let toSeconds = Double(info.numer) / Double(info.denom) / 1e9
        var list: [[String: Any]] = []
        if let chunks {
            for i in 0..<chunkCount {
                let c = chunks[i]
                list.append(["stream": Int(c.stream), "id": Int(c.id), "split": Int(c.split), "next": Int(c.next), "channels": Int(c.channels), "rate": c.rate, "frames": Int(c.frames), "offset": c.offset,
                             "startValue": c.start.isNumeric ? c.start.value : 0, "startScale": c.start.isNumeric ? Int(c.start.timescale) : 0,
                             "start": c.start.isNumeric ? c.start.seconds : -1, "host": Double(c.host) * toSeconds, "supported": c.supported, "flags": Int(c.flags)])
            }
        }
        let data = samples.map { Data(bytes: $0, count: used * MemoryLayout<Float>.size) } ?? Data()
        let overflowed = overflow
        os_unfair_lock_unlock(lock)
        let json: [String: Any] = ["chunks": list, "clocks": clocks, "events": events, "overflow": overflowed]
        try? data.write(to: URL(fileURLWithPath: path + ".f32"))
        if let encoded = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) {
            try? encoded.write(to: URL(fileURLWithPath: path + ".json"))
        }
        self.path = nil
    }
}
#endif
