// The native engine for originals: the file's bytes over HTTP ranges, demuxed on the device
// (VelaMedia/FFmpeg), video decoded by VideoToolbox through AVSampleBufferDisplayLayer,
// audio rendered by AVSampleBufferAudioRenderer (AC-3/E-AC-3 as they are, everything else
// decoded to PCM), both on one AVSampleBufferRenderSynchronizer clock. Nothing is
// transcoded: the server only serves bytes.
import AVFoundation
import AVKit
import CoreMedia
import Foundation
import VelaMedia

/// What a backend reports to the view, which turns it into the web engine's snapshot.
struct VelaReadout {
    enum State: String { case loading, playing, paused, buffering, ended, failed }
    var state: State = .loading
    var position: Double = 0
    var duration: Double?
    var bufferedEnd: Double?
    var throughputBps: Double?
    var transferredBytes: Int64?
    var failure: String?
    var failureKind = "source"
    var videoCodec: String?
    var width = 0, height = 0
    var dynamicRange: String?
    var frameRate: Double = 0
    var audioRoute: String?
    var preparation: String? = "media-metadata"
}

protocol VelaBackend: AnyObject {
    var onChange: (() -> Void)? { get set }
    var readout: VelaReadout { get }
    var currentTime: Double { get }
    func play()
    func pause()
    func seek(to seconds: Double)
    func setVolume(_ volume: Float, muted: Bool)
    func stop()
}

/// One subtitle cue in media time.
struct VelaCue {
    enum Content { case text(String), bitmaps([(CGImage, CGRect)], CGSize) }
    let start: Double
    var end: Double
    let content: Content
}

final class VelaOriginalEngine: VelaBackend, @unchecked Sendable {
    struct Source {
        let url: URL
        let headers: [String: String]
        let byteLength: Int64?
        let start: Double
        let audioStreamIndex: Int?
        let subtitleStreamIndex: Int?
    }

    var onChange: (() -> Void)?
    let videoLayer: AVSampleBufferDisplayLayer
    private var videoRenderer: AVSampleBufferVideoRenderer { videoLayer.sampleBufferRenderer }
    private let audioRenderer = AVSampleBufferAudioRenderer()
    private let synchronizer = AVSampleBufferRenderSynchronizer()
    private let feedQueue = DispatchQueue(label: "vela.feed", qos: .userInteractive)
    private let lock = NSCondition()
    private let displayCriteria: (CMFormatDescription?, Double) -> Void

    private var source: Source
    private var reader: VelaRangeReader?
    private var demuxer: VelaDemuxer?
    private var thread: Thread?
    private var stopped = false

    // Selection
    private var videoStream: VelaStream?
    private var audioStream: VelaStream?
    private(set) var streams: [VelaStream] = []
    private var videoFormat: VelaVideoFormat?
    private var dolbyVision = true
    private var audioRoute: VelaAudioRoute?
    private var audioDecoder: OpaquePointer?
    private var pcmFormat: CMAudioFormatDescription?
    private var pcmKey = ""

    // Queues, guarded by `lock`.
    private var videoFIFO: [CMSampleBuffer] = []
    private var audioFIFO: [CMSampleBuffer] = []
    private var fifoBytes = 0
    private var lastVideo = -Double.infinity, lastAudio = -Double.infinity
    private var endOfFile = false
    private var seekRequest: Double?
    private var generation = 0
    private var dropBefore = 0.0
    private var feedingVideo = false, feedingAudio = false

    // Clock
    private var started = false
    private var anchor = 0.0
    private var wantsPlay = true
    private var stalled = false
    private var state = VelaReadout.State.loading
    private var failure: String?
    private var failureKind = "source"

    // Subtitles, guarded by `lock`: every subtitle stream's packets are kept (they are small)
    // so a change shows what is on screen now, not only what is read next.
    private var subtitlePackets: [Int: [VelaDemuxPacket]] = [:]
    private var subtitleStreamIndex: Int?
    private var subtitleDecoder: OpaquePointer?
    private var decodedThrough = 0
    private(set) var cues: [VelaCue] = []
    var subtitleCanvas = CGSize.zero

    init(layer: AVSampleBufferDisplayLayer, source: Source, displayCriteria: @escaping (CMFormatDescription?, Double) -> Void) {
        videoLayer = layer
        self.source = source
        self.displayCriteria = displayCriteria
        anchor = source.start
        synchronizer.addRenderer(videoRenderer)
        synchronizer.addRenderer(audioRenderer)
        synchronizer.delaysRateChangeUntilHasSufficientMediaData = false
        let thread = Thread { [weak self] in self?.run() }
        thread.name = "vela.demux"
        thread.qualityOfService = .userInitiated
        self.thread = thread
        thread.start()
    }

    // MARK: Control (main thread)

    var currentTime: Double {
        lock.lock(); defer { lock.unlock() }
        return clock()
    }
    private func clock() -> Double { started ? max(0, CMTimeGetSeconds(synchronizer.currentTime())) : anchor }

    var readout: VelaReadout {
        lock.lock(); defer { lock.unlock() }
        var r = VelaReadout()
        r.state = state
        r.position = clock()
        r.duration = demuxer?.duration
        let ahead = [lastVideo, lastAudio].filter { $0.isFinite }
        r.bufferedEnd = ahead.isEmpty ? nil : (videoStream != nil && lastVideo.isFinite ? lastVideo : ahead.max())
        r.throughputBps = reader?.throughputBps
        r.transferredBytes = reader?.transferredBytes
        r.failure = failure
        r.failureKind = failureKind
        if let videoStream {
            r.videoCodec = videoStream.codec; r.width = Int(videoStream.info.width); r.height = Int(videoStream.info.height)
            r.frameRate = videoStream.info.frame_rate
            r.dynamicRange = videoFormat?.dynamicRange
        }
        if let audioStream { r.audioRoute = "\(audioStream.codec)\(audioDecoder != nil ? " → PCM" : "")" }
        r.preparation = state == .loading ? (demuxer == nil ? "media-metadata" : "initial-buffer") : nil
        return r
    }

    func play() {
        lock.lock(); wantsPlay = true
        if started && !stalled && state != .ended { synchronizer.rate = 1; state = .playing }
        lock.unlock(); changed()
    }

    func pause() {
        lock.lock(); wantsPlay = false
        if started { synchronizer.rate = 0; if state == .playing || state == .buffering { state = .paused } }
        lock.unlock(); changed()
    }

    func seek(to seconds: Double) {
        lock.lock()
        let target = max(0, min(seconds, (demuxer?.duration ?? .infinity) - 0.5))
        seekRequest = target
        anchor = target
        started = false
        state = .loading
        synchronizer.rate = 0
        demuxer?.interrupt(true)
        lock.broadcast()
        lock.unlock()
        changed()
    }

    func setVolume(_ volume: Float, muted: Bool) {
        audioRenderer.volume = volume
        audioRenderer.isMuted = muted
    }

    /// A different audio stream of the same file, from the current position.
    func selectAudio(streamIndex: Int) {
        lock.lock()
        let same = audioStream?.index == streamIndex
        if !same { source = Source(url: source.url, headers: source.headers, byteLength: source.byteLength, start: source.start, audioStreamIndex: streamIndex, subtitleStreamIndex: subtitleStreamIndex) }
        let now = clock()
        lock.unlock()
        if !same { pendingAudio = streamIndex; seek(to: now) }
    }
    private var pendingAudio: Int?

    /// An embedded subtitle stream (nil: off), decoded from what was already read.
    func selectSubtitle(streamIndex: Int?) {
        lock.lock(); defer { lock.unlock() }
        guard subtitleStreamIndex != streamIndex else { return }
        subtitleStreamIndex = streamIndex
        if let decoder = subtitleDecoder { vm_subtitle_close(decoder); subtitleDecoder = nil }
        cues.removeAll(); decodedThrough = 0
        if let streamIndex, let demuxer {
            subtitleDecoder = vm_subtitle_open(demuxer.handle, Int32(streamIndex), nil, 0)
            decodeSubtitles()
        }
    }

    func stop() {
        lock.lock()
        stopped = true
        demuxer?.interrupt(true)
        lock.broadcast()
        lock.unlock()
        reader?.close()
        synchronizer.rate = 0
        videoRenderer.stopRequestingMediaData()
        audioRenderer.stopRequestingMediaData()
        videoRenderer.flush(removingDisplayedImage: true) { }
        audioRenderer.flush()
        displayCriteria(nil, 0)
    }

    deinit {
        if let audioDecoder { vm_audio_close(audioDecoder) }
        if let subtitleDecoder { vm_subtitle_close(subtitleDecoder) }
    }

    private func changed() { DispatchQueue.main.async { [weak self] in self?.onChange?() } }
    private func fail(_ message: String, kind: String = "source") {
        lock.lock(); failure = message; failureKind = kind; state = .failed; synchronizer.rate = 0; lock.unlock()
        changed()
    }

    // MARK: Demux thread

    private func run() {
        do {
            let reader = VelaRangeReader(url: source.url, headers: source.headers, byteLength: source.byteLength)
            lock.lock(); self.reader = reader; let halt = stopped; lock.unlock()
            if halt { return }
            let demuxer = try VelaDemuxer(reader: reader)
            lock.lock(); self.demuxer = demuxer; streams = demuxer.streams; lock.unlock()
            try configure(demuxer)
            changed()
            if source.start > 0.25 { _ = demuxer.seek(to: source.start) }
            lock.lock(); dropBefore = source.start; lock.unlock()
            startFeeding()
            try pump(demuxer)
        } catch {
            if !stopped { fail("\(error)") }
        }
    }

    private func configure(_ demuxer: VelaDemuxer) throws {
        let video = demuxer.streams.first(where: { $0.isVideo })
        let audios = demuxer.streams.filter { $0.isAudio }
        let audio = audios.first(where: { $0.index == source.audioStreamIndex }) ?? audios.first(where: { $0.info.is_default != 0 }) ?? audios.first
        guard video != nil || audio != nil else { throw VelaDemuxer.Failure.open("The file has no playable stream") }
        lock.lock()
        videoStream = video; audioStream = audio
        lock.unlock()
        try configureAudio(audio)
        var wanted = Set([video?.index, audio?.index].compactMap { $0 })
        for stream in demuxer.streams where stream.isSubtitle { wanted.insert(stream.index) }
        demuxer.enable(wanted)
        if let video, !(video.extradata.isEmpty) { try makeVideoFormat(video, firstPacket: nil) }
        selectSubtitle(streamIndex: source.subtitleStreamIndex)
    }

    private func configureAudio(_ audio: VelaStream?) throws {
        if let decoder = audioDecoder { vm_audio_close(decoder); audioDecoder = nil }
        pcmFormat = nil; pcmKey = ""
        guard let audio, let demuxer else { audioRoute = nil; return }
        let route = forceDecode == audio.index ? .decoded : VelaAudioRoute.make(audio)
        audioRoute = route
        if case .decoded = route {
            var error = [CChar](repeating: 0, count: 256)
            guard let decoder = vm_audio_open(demuxer.handle, Int32(audio.index), &error, Int32(error.count)) else {
                throw VelaDemuxer.Failure.open("\(audio.codec) audio: \(String(cString: error))")
            }
            audioDecoder = decoder
        }
    }

    private func makeVideoFormat(_ stream: VelaStream, firstPacket: Data?) throws {
        let format = try VelaVideoFormat.make(stream, firstPacket: firstPacket, dolbyVision: dolbyVision)
        videoFormat = format
        // The display follows the content (Match Content): dynamic range and frame rate.
        let wait = DispatchSemaphore(value: 0)
        DispatchQueue.main.async { self.displayCriteria(format.description, format.frameRate); wait.signal() }
        wait.wait()
        // A mode switch blanks the display for a moment; start after it, not into it.
        var waited = 0.0
        while waited < 6, VelaDisplay.switching() { Thread.sleep(forTimeInterval: 0.1); waited += 0.1 }
    }

    private func pump(_ demuxer: VelaDemuxer) throws {
        while true {
            lock.lock()
            maintainClock()
            while !stopped && seekRequest == nil && (endOfFile || full()) { _ = lock.wait(until: Date().addingTimeInterval(0.1)); maintainClock() }
            if stopped { lock.unlock(); return }
            if let target = seekRequest {
                seekRequest = nil
                generation += 1
                videoFIFO.removeAll(); audioFIFO.removeAll(); fifoBytes = 0
                lastVideo = -.infinity; lastAudio = -.infinity
                endOfFile = false; dropBefore = target
                let audioChange = pendingAudio; pendingAudio = nil
                lock.unlock()
                videoRenderer.flush(); audioRenderer.flush()
                if let audioChange, let stream = demuxer.streams.first(where: { $0.index == audioChange }) {
                    lock.lock(); audioStream = stream; lock.unlock()
                    try configureAudio(stream)
                    var wanted = Set(demuxer.streams.filter { $0.isSubtitle }.map { $0.index })
                    if let v = videoStream { wanted.insert(v.index) }
                    wanted.insert(stream.index)
                    demuxer.enable(wanted)
                } else if let decoder = audioDecoder { vm_audio_flush(decoder) }
                if !demuxer.seek(to: target) { fail("The file could not seek to \(Int(target)) s"); return }
                continue
            }
            let generationNow = generation
            lock.unlock()
            let packet: VelaDemuxPacket?
            do { packet = try demuxer.read() } catch {
                lock.lock(); let superseded = seekRequest != nil || stopped; lock.unlock()
                if superseded { continue }
                throw error
            }
            lock.lock()
            if generationNow != generation || seekRequest != nil { lock.unlock(); continue }
            lock.unlock()
            guard let packet else {
                lock.lock(); endOfFile = true; lock.broadcast(); lock.unlock()
                kick(); continue
            }
            if packet.stream == videoStream?.index { try video(packet) }
            else if packet.stream == audioStream?.index { audio(packet) }
            else if demuxer.streams.indices.contains(packet.stream), demuxer.streams[packet.stream].isSubtitle { subtitle(packet) }
        }
    }

    /// Enough is read ahead of the clock (both kinds, so an interleave gap never starves one).
    private func full() -> Bool {
        if fifoBytes > 160 << 20 { return true }
        let now = clock()
        let videoFull = videoStream == nil || lastVideo - now > 12
        let audioFull = audioStream == nil || lastAudio - now > 4
        return videoFull && audioFull
    }

    private func video(_ packet: VelaDemuxPacket) throws {
        guard let stream = videoStream else { return }
        if videoFormat == nil {
            guard packet.keyframe else { return }
            try makeVideoFormat(stream, firstPacket: packet.data)
        }
        guard let format = videoFormat else { return }
        let bytes = format.sampleData(packet.data)
        guard !bytes.isEmpty, let sample = makeSample(bytes, format: format.description, pts: packet.pts, dts: packet.dts, duration: packet.duration, frames: 1) else { return }
        let pts = packet.pts.isFinite ? packet.pts : packet.dts
        lock.lock()
        if pts.isFinite && pts + max(packet.duration, 0.001) < dropBefore {
            // Decoded to reach the target, never shown.
            if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) as? [NSMutableDictionary], let first = attachments.first {
                first[kCMSampleAttachmentKey_DoNotDisplay] = true
            }
        }
        if !packet.keyframe {
            if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) as? [NSMutableDictionary], let first = attachments.first {
                first[kCMSampleAttachmentKey_NotSync] = true
            }
        }
        videoFIFO.append(sample); fifoBytes += bytes.count
        if pts.isFinite { lastVideo = max(lastVideo, pts) }
        lock.unlock()
        kick()
    }

    private func audio(_ packet: VelaDemuxPacket) {
        guard let route = audioRoute else { return }
        switch route {
        case .compressed(let format, let frames, let rate):
            guard let pts = packet.pts.isFinite ? Optional(packet.pts) : nil else { return }
            lock.lock(); let drop = pts + Double(frames) / rate < dropBefore; lock.unlock()
            if drop { return }
            guard let sample = makeAudioPacket(packet.data, format: format, pts: pts, frames: frames, rate: rate) else { return }
            enqueueAudio(sample, end: pts + Double(frames) / rate, bytes: packet.data.count)
        case .decoded:
            guard let decoder = audioDecoder else { return }
            _ = packet.data.withUnsafeBytes { raw in vm_audio_send(decoder, raw.bindMemory(to: UInt8.self).baseAddress, Int32(packet.data.count), packet.pts) }
            var frame = VMAudioFrame()
            while vm_audio_receive(decoder, &frame) == 0 {
                guard frame.frames > 0, frame.pts.isFinite else { continue }
                let end = frame.pts + Double(frame.frames) / Double(frame.sample_rate)
                lock.lock(); let drop = end < dropBefore; lock.unlock()
                if drop { continue }
                let key = "\(frame.channels):\(frame.sample_rate):\(frame.channel_mask)"
                if key != pcmKey { pcmFormat = VelaAudioRoute.pcmFormat(channels: Int(frame.channels), sampleRate: Int(frame.sample_rate), mask: frame.channel_mask); pcmKey = key }
                guard let format = pcmFormat else { continue }
                let bytes = Int(frame.frames) * Int(frame.channels) * 4
                let data = Data(bytes: frame.samples, count: bytes)
                guard let sample = makePCM(data, format: format, pts: frame.pts, frames: Int(frame.frames), rate: Int(frame.sample_rate)) else { continue }
                enqueueAudio(sample, end: end, bytes: bytes)
            }
        }
    }

    private func enqueueAudio(_ sample: CMSampleBuffer, end: Double, bytes: Int) {
        lock.lock()
        audioFIFO.append(sample); fifoBytes += bytes
        lastAudio = max(lastAudio, end)
        lock.unlock()
        kick()
    }

    private func subtitle(_ packet: VelaDemuxPacket) {
        lock.lock(); defer { lock.unlock() }
        var list = subtitlePackets[packet.stream, default: []]
        list.append(packet)
        if list.count > 4000 { list.removeFirst(list.count - 4000) }
        subtitlePackets[packet.stream] = list
        if packet.stream == subtitleStreamIndex { decodeSubtitles() }
    }

    /// Decodes the selected stream's kept packets not yet decoded (under `lock`).
    private func decodeSubtitles() {
        guard let index = subtitleStreamIndex, let decoder = subtitleDecoder, let packets = subtitlePackets[index] else { return }
        if decodedThrough > packets.count { decodedThrough = 0 }
        for packet in packets[decodedThrough...] {
            var sub = VMSubtitle()
            let r = packet.data.withUnsafeBytes { raw in vm_subtitle_decode(decoder, raw.bindMemory(to: UInt8.self).baseAddress, Int32(packet.data.count), packet.pts, packet.duration, &sub) }
            guard r == 0 else { continue }
            if sub.canvas_width > 0 && sub.canvas_height > 0 { subtitleCanvas = CGSize(width: Int(sub.canvas_width), height: Int(sub.canvas_height)) }
            // An open cue ends where the next begins (PGS clears with an empty one).
            if let last = cues.indices.last, !cues[last].end.isFinite || cues[last].end > sub.start { if cues[last].start < sub.start { cues[last].end = sub.start } }
            guard sub.count > 0 else { continue }
            var texts: [String] = []
            var bitmaps: [(CGImage, CGRect)] = []
            for i in 0..<Int(sub.count) {
                let rect = sub.rects[i]
                if let text = rect.text { texts.append(VelaSubtitleText.plain(String(cString: text), ass: rect.ass != 0)) }
                else if let rgba = rect.rgba, let image = VelaSubtitleText.image(rgba, width: Int(rect.width), height: Int(rect.height)) {
                    bitmaps.append((image, CGRect(x: Int(rect.x), y: Int(rect.y), width: Int(rect.width), height: Int(rect.height))))
                }
            }
            let end = sub.end.isFinite ? sub.end : .infinity
            if !bitmaps.isEmpty { cues.append(VelaCue(start: sub.start, end: end, content: .bitmaps(bitmaps, subtitleCanvas))) }
            else if !texts.isEmpty { cues.append(VelaCue(start: sub.start, end: end, content: .text(texts.joined(separator: "\n")))) }
        }
        decodedThrough = packets.count
        if cues.count > 2000 { cues.removeFirst(cues.count - 2000) }
    }

    /// The cue to show at `time`.
    func cue(at time: Double) -> VelaCue? {
        lock.lock(); defer { lock.unlock() }
        return cues.last(where: { $0.start <= time && time < $0.end })
    }

    // MARK: Feeding (feed queue)

    private func startFeeding() { kick() }

    private func kick() {
        feedQueue.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let wantVideo = !self.feedingVideo && !self.videoFIFO.isEmpty
            let wantAudio = !self.feedingAudio && !self.audioFIFO.isEmpty
            if wantVideo { self.feedingVideo = true }
            if wantAudio { self.feedingAudio = true }
            self.lock.unlock()
            if wantVideo { self.videoRenderer.requestMediaDataWhenReady(on: self.feedQueue) { [weak self] in self?.feedVideo() } }
            if wantAudio { self.audioRenderer.requestMediaDataWhenReady(on: self.feedQueue) { [weak self] in self?.feedAudio() } }
            self.maybeStart()
        }
    }

    private func feedVideo() {
        if videoRenderer.status == .failed { videoFailed(); return }
        while videoRenderer.isReadyForMoreMediaData {
            lock.lock()
            guard !videoFIFO.isEmpty else { feedingVideo = false; lock.unlock(); videoRenderer.stopRequestingMediaData(); break }
            let sample = videoFIFO.removeFirst(); fifoBytes -= CMSampleBufferGetTotalSampleSize(sample)
            lock.broadcast(); lock.unlock()
            videoRenderer.enqueue(sample)
        }
        maybeStart()
    }

    private func feedAudio() {
        if audioRenderer.status == .failed { audioFailed(); return }
        while audioRenderer.isReadyForMoreMediaData {
            lock.lock()
            guard !audioFIFO.isEmpty else { feedingAudio = false; lock.unlock(); audioRenderer.stopRequestingMediaData(); break }
            let sample = audioFIFO.removeFirst(); fifoBytes -= CMSampleBufferGetTotalSampleSize(sample)
            lock.broadcast(); lock.unlock()
            audioRenderer.enqueue(sample)
        }
        maybeStart()
    }

    /// Starts the clock at the target once both renderers hold enough to play through.
    private func maybeStart() {
        lock.lock()
        guard !started, !stopped, state != .failed, seekRequest == nil else { lock.unlock(); return }
        let videoReady = videoStream == nil || lastVideo - dropBefore >= 1.0 || endOfFile
        let audioReady = audioStream == nil || lastAudio - dropBefore >= 0.5 || endOfFile
        guard videoReady && audioReady else { lock.unlock(); return }
        started = true
        stalled = false
        let target = dropBefore
        state = wantsPlay ? .playing : .paused
        synchronizer.setRate(wantsPlay ? 1 : 0, time: CMTime(seconds: target, preferredTimescale: 90_000))
        lock.unlock()
        changed()
    }

    /// Buffering and the end, from the demux thread's idle loop (under `lock`).
    private func maintainClock() {
        guard started, state != .failed else { return }
        let now = clock()
        let lastPresentable = videoStream != nil ? lastVideo : lastAudio
        if endOfFile && now >= lastPresentable - 0.05 && state != .ended {
            state = .ended; synchronizer.rate = 0; changed(); return
        }
        if !endOfFile && wantsPlay {
            let starving = (videoStream != nil && lastVideo - now < 0.15) || (audioStream != nil && lastAudio - now < 0.1)
            if starving && !stalled { stalled = true; synchronizer.rate = 0; state = .buffering; changed() }
            else if stalled && (videoStream == nil || lastVideo - now > 2.5) && (audioStream == nil || lastAudio - now > 1) {
                stalled = false; synchronizer.rate = 1; state = .playing; changed()
            }
        }
    }

    private func videoFailed() {
        videoRenderer.stopRequestingMediaData()
        let error = videoRenderer.error?.localizedDescription ?? "unknown"
        // Dolby Vision this device or display refuses: present the base layer instead.
        if dolbyVision, videoFormat?.dynamicRange == "dv" {
            dolbyVision = false
            lock.lock(); videoFormat = nil; feedingVideo = false; lock.unlock()
            videoRenderer.flush()
            seek(to: currentTime)
            return
        }
        fail("The video could not be decoded (\(error))", kind: "decoder")
    }

    private func audioFailed() {
        audioRenderer.stopRequestingMediaData()
        // tvOS refused the compressed stream: decode it here instead.
        if case .compressed = audioRoute, let stream = audioStream {
            lock.lock(); feedingAudio = false; lock.unlock()
            audioRenderer.flush()
            forceDecode = stream.index
            pendingAudio = stream.index
            lock.lock(); audioStream = nil; lock.unlock()
            seek(to: currentTime)
            return
        }
        fail("The audio could not be played (\(audioRenderer.error?.localizedDescription ?? "unknown"))", kind: "decoder")
    }
    private var forceDecode: Int?

    // MARK: Sample buffers

    private func makeSample(_ data: Data, format: CMFormatDescription, pts: Double, dts: Double, duration: Double, frames: Int) -> CMSampleBuffer? {
        guard let block = blockBuffer(data) else { return nil }
        var timing = CMSampleTimingInfo(
            duration: duration > 0 ? CMTime(seconds: duration, preferredTimescale: 90_000) : .invalid,
            presentationTimeStamp: pts.isFinite ? CMTime(seconds: pts, preferredTimescale: 90_000) : .invalid,
            decodeTimeStamp: dts.isFinite ? CMTime(seconds: dts, preferredTimescale: 90_000) : .invalid)
        var size = data.count
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreateReady(allocator: nil, dataBuffer: block, formatDescription: format, sampleCount: 1, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample) == noErr else { return nil }
        return sample
    }

    private func makeAudioPacket(_ data: Data, format: CMAudioFormatDescription, pts: Double, frames: Int, rate: Double) -> CMSampleBuffer? {
        guard let block = blockBuffer(data) else { return nil }
        var description = AudioStreamPacketDescription(mStartOffset: 0, mVariableFramesInPacket: 0, mDataByteSize: UInt32(data.count))
        var sample: CMSampleBuffer?
        guard CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block, formatDescription: format, sampleCount: 1,
                                                                   presentationTimeStamp: CMTime(seconds: pts, preferredTimescale: CMTimeScale(rate)), packetDescriptions: &description, sampleBufferOut: &sample) == noErr else { return nil }
        return sample
    }

    private func makePCM(_ data: Data, format: CMAudioFormatDescription, pts: Double, frames: Int, rate: Int) -> CMSampleBuffer? {
        guard let block = blockBuffer(data) else { return nil }
        var sample: CMSampleBuffer?
        guard CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block, formatDescription: format, sampleCount: frames,
                                                                   presentationTimeStamp: CMTime(value: CMTimeValue((pts * Double(rate)).rounded()), timescale: CMTimeScale(rate)), packetDescriptions: nil, sampleBufferOut: &sample) == noErr else { return nil }
        return sample
    }

    private func blockBuffer(_ data: Data) -> CMBlockBuffer? {
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: data.count, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: data.count, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block) == noErr, let block else { return nil }
        let copied = data.withUnsafeBytes { raw in CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: data.count) }
        return copied == noErr ? block : nil
    }
}

/// The display's mode switch (Match Content), read from the main thread's window.
enum VelaDisplay {
    static weak var manager: AVDisplayManager?
    static func switching() -> Bool {
        var busy = false
        DispatchQueue.main.sync { busy = manager?.isDisplayModeSwitchInProgress ?? false }
        return busy
    }
}

enum VelaSubtitleText {
    /// An ASS event's text without its override tags, or plain text as it is.
    static func plain(_ line: String, ass: Bool) -> String {
        var text = line
        if ass {
            // ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
            var fields = 0, cut = text.startIndex
            for (i, c) in zip(text.indices, text) where c == "," { fields += 1; if fields == 8 { cut = text.index(after: i); break } }
            if fields == 8 { text = String(text[cut...]) }
            text = text.replacingOccurrences(of: #"\{[^}]*\}"#, with: "", options: .regularExpression)
            text = text.replacingOccurrences(of: "\\N", with: "\n").replacingOccurrences(of: "\\n", with: "\n").replacingOccurrences(of: "\\h", with: " ")
        }
        text = text.replacingOccurrences(of: #"</?[a-zA-Z][^>]*>"#, with: "", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func image(_ rgba: UnsafePointer<UInt32>, width: Int, height: Int) -> CGImage? {
        let data = Data(bytes: rgba, count: width * height * 4)
        guard let provider = CGDataProvider(data: data as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                       bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }
}
