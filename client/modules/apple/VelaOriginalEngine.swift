// The native engine for originals. The file's bytes come over HTTP ranges (VelaRangeReader),
// are demuxed on the device (VelaMedia), video is decoded by VideoToolbox through
// AVSampleBufferDisplayLayer, audio is rendered by AVSampleBufferAudioRenderer (VelaAudioPath),
// both on one AVSampleBufferRenderSynchronizer clock. The server only serves bytes.
//
// Threads: a demux thread reads packets into two queues (video, audio); the renderers pull
// from them on the feed queue; control calls come from the main thread. `lock` guards the queues
// and the clock state.
import AVFoundation
import CoreMedia
import Foundation

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
    private(set) var streams: [VelaStream] = []

    private let videoLayer: AVSampleBufferDisplayLayer
    private let audioRenderer = AVSampleBufferAudioRenderer()
    private let synchronizer = AVSampleBufferRenderSynchronizer()
    private let feedQueue = DispatchQueue(label: "vela.feed", qos: .userInteractive)
    private let lock = NSCondition()
    private let preferDisplay: (CMFormatDescription?, Double) -> Void
    private let source: Source
    private let subtitles = VelaEmbeddedSubtitles()

    private var reader: VelaRangeReader?
    private var demuxer: VelaDemuxer?
    private var stopped = false

    // Streams and their paths to the renderers.
    private var videoStream: VelaStream?
    private var videoFormat: VelaVideoFormat?
    private var dolbyVision = true
    private var audio: VelaAudioPath?
    private var decodeAudio: Set<Int> = []
    private var pendingAudioStream: Int?

    // Read-ahead, guarded by `lock`.
    private var videoQueue: [CMSampleBuffer] = []
    private var audioQueue: [CMSampleBuffer] = []
    private var queuedBytes = 0
    private var lastVideoTime = -Double.infinity
    private var lastAudioTime = -Double.infinity
    private var endOfFile = false
    private var seekRequest: Double?
    private var generation = 0
    private var dropBefore = 0.0
    private var feedingVideo = false
    private var feedingAudio = false

    // The clock, guarded by `lock`.
    private var started = false
    private var anchor = 0.0
    private var wantsPlay = true
    private var stalled = false
    private var state = VelaReadout.State.loading
    private var failure: String?
    private var failureKind = "source"

    // Read-ahead bounds.
    private let videoAhead = 12.0
    private let audioAhead = 4.0
    private let maximumQueuedBytes = 160 << 20

    private var videoRenderer: AVSampleBufferVideoRenderer {
        videoLayer.sampleBufferRenderer
    }

    init(
        layer: AVSampleBufferDisplayLayer,
        source: Source,
        preferDisplay: @escaping (CMFormatDescription?, Double) -> Void
    ) {
        videoLayer = layer
        self.source = source
        self.preferDisplay = preferDisplay
        anchor = source.start
        synchronizer.addRenderer(videoLayer.sampleBufferRenderer)
        synchronizer.addRenderer(audioRenderer)
        let thread = Thread { [weak self] in
            self?.run()
        }
        thread.name = "vela.demux"
        thread.qualityOfService = .userInitiated
        thread.start()
    }

    // MARK: Control (main thread)

    var currentTime: Double {
        lock.lock()
        defer { lock.unlock() }
        return clock()
    }

    /// The media time: the synchronizer's once started, else where it will start.
    private func clock() -> Double {
        started ? max(0, CMTimeGetSeconds(synchronizer.currentTime())) : anchor
    }

    var readout: VelaReadout {
        lock.lock()
        defer { lock.unlock() }
        var readout = VelaReadout()
        readout.state = state
        readout.position = clock()
        readout.duration = demuxer?.duration
        let videoKnown = videoStream != nil && lastVideoTime.isFinite
        readout.bufferedEnd = videoKnown ? lastVideoTime : (lastAudioTime.isFinite ? lastAudioTime : nil)
        readout.throughputBps = reader?.throughputBps
        readout.transferredBytes = reader?.transferredBytes
        readout.failure = failure
        readout.failureKind = failureKind
        if let videoStream {
            readout.videoCodec = videoStream.codec
            readout.width = Int(videoStream.info.width)
            readout.height = Int(videoStream.info.height)
            readout.dynamicRange = videoFormat?.dynamicRange
        }
        readout.audioRoute = audio?.description
        readout.preparation = state == .loading ? (demuxer == nil ? "media-metadata" : "initial-buffer") : nil
        return readout
    }

    func cue(at time: Double) -> VelaCue? {
        subtitles.cue(at: time)
    }

    func play() {
        lock.lock()
        wantsPlay = true
        if started && !stalled && state != .ended && state != .failed {
            synchronizer.rate = 1
            state = .playing
        }
        lock.unlock()
        changed()
    }

    func pause() {
        lock.lock()
        wantsPlay = false
        if started {
            synchronizer.rate = 0
            if state == .playing || state == .buffering {
                state = .paused
            }
        }
        lock.unlock()
        changed()
    }

    func seek(to seconds: Double) {
        lock.lock()
        let end = (demuxer?.duration ?? .infinity) - 0.5
        let target = max(0, min(seconds, end))
        seekRequest = target
        anchor = target
        started = false
        if state != .failed {
            state = .loading
        }
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

    /// Another audio stream of the same file, from the current position.
    func selectAudio(streamIndex: Int) {
        guard audio?.stream.index != streamIndex else {
            return
        }
        lock.lock()
        pendingAudioStream = streamIndex
        lock.unlock()
        seek(to: currentTime)
    }

    /// An embedded subtitle stream (nil: off), decoded from what was already read.
    func selectSubtitle(streamIndex: Int?) {
        subtitles.select(streamIndex, demuxer: demuxer?.handle)
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
        videoRenderer.flush(removingDisplayedImage: true) {}
        audioRenderer.flush()
        preferDisplay(nil, 0)
    }

    private func changed() {
        DispatchQueue.main.async { [weak self] in
            self?.onChange?()
        }
    }

    private func fail(_ message: String, kind: String = "source") {
        lock.lock()
        failure = message
        failureKind = kind
        state = .failed
        synchronizer.rate = 0
        lock.unlock()
        changed()
    }

    // MARK: Demux thread

    private func run() {
        do {
            let reader = VelaRangeReader(url: source.url, headers: source.headers, byteLength: source.byteLength)
            lock.lock()
            self.reader = reader
            let halted = stopped
            lock.unlock()
            if halted {
                return
            }
            let demuxer = try VelaDemuxer(reader: reader)
            lock.lock()
            self.demuxer = demuxer
            streams = demuxer.streams
            lock.unlock()
            try configure(demuxer)
            changed()
            if source.start > 0.25 {
                _ = demuxer.seek(to: source.start)
            }
            lock.lock()
            dropBefore = source.start
            lock.unlock()
            try pump(demuxer)
        } catch {
            lock.lock()
            let halted = stopped
            lock.unlock()
            if !halted {
                fail("\(error)")
            }
        }
    }

    private func configure(_ demuxer: VelaDemuxer) throws {
        let video = demuxer.streams.first { $0.isVideo }
        let audios = demuxer.streams.filter(\.isAudio)
        let chosenAudio = audios.first { $0.index == source.audioStreamIndex }
            ?? audios.first { $0.info.is_default != 0 }
            ?? audios.first
        guard video != nil || chosenAudio != nil else {
            throw VelaDemuxer.Failure.open("The file has no playable stream")
        }
        videoStream = video
        if let chosenAudio {
            audio = try VelaAudioPath(stream: chosenAudio, demuxer: demuxer, decode: false)
        }
        enableStreams(demuxer)
        if let video, !video.extradata.isEmpty {
            try makeVideoFormat(video, firstPacket: nil)
        }
        subtitles.select(source.subtitleStreamIndex, demuxer: demuxer.handle)
    }

    /// The video, the chosen audio, and every subtitle stream (kept for a later choice).
    private func enableStreams(_ demuxer: VelaDemuxer) {
        var wanted = Set(demuxer.streams.filter(\.isSubtitle).map(\.index))
        if let videoStream {
            wanted.insert(videoStream.index)
        }
        if let audio {
            wanted.insert(audio.stream.index)
        }
        demuxer.enable(wanted)
    }

    private func makeVideoFormat(_ stream: VelaStream, firstPacket: Data?) throws {
        let format = try VelaVideoFormat.make(stream, firstPacket: firstPacket, dolbyVision: dolbyVision)
        videoFormat = format
        let preferDisplay = self.preferDisplay
        DispatchQueue.main.sync {
            preferDisplay(format.description, format.frameRate)
        }
        // A display mode switch blanks the screen for a moment: start after it, not into it.
        var waited = 0.0
        while waited < 6, VelaDisplay.switching() {
            Thread.sleep(forTimeInterval: 0.1)
            waited += 0.1
        }
    }

    private func pump(_ demuxer: VelaDemuxer) throws {
        while true {
            lock.lock()
            maintainClock()
            while !stopped && seekRequest == nil && (endOfFile || readAheadFull()) {
                _ = lock.wait(until: Date().addingTimeInterval(0.1))
                maintainClock()
            }
            if stopped {
                lock.unlock()
                return
            }
            if let target = seekRequest {
                lock.unlock()
                try performSeek(to: target, demuxer)
                continue
            }
            let readGeneration = generation
            lock.unlock()
            let packet: VelaDemuxPacket?
            do {
                packet = try demuxer.read()
            } catch {
                lock.lock()
                let superseded = seekRequest != nil || stopped
                lock.unlock()
                if superseded {
                    continue
                }
                throw error
            }
            lock.lock()
            let current = readGeneration == generation && seekRequest == nil
            if packet == nil && current {
                endOfFile = true
                lock.broadcast()
            }
            lock.unlock()
            guard current, let packet else {
                kick()
                continue
            }
            try route(packet, demuxer)
        }
    }

    private func performSeek(to target: Double, _ demuxer: VelaDemuxer) throws {
        lock.lock()
        seekRequest = nil
        generation += 1
        videoQueue.removeAll()
        audioQueue.removeAll()
        queuedBytes = 0
        lastVideoTime = -.infinity
        lastAudioTime = -.infinity
        endOfFile = false
        dropBefore = target
        let audioChange = pendingAudioStream
        pendingAudioStream = nil
        lock.unlock()
        videoRenderer.flush()
        audioRenderer.flush()
        if let audioChange, let stream = demuxer.streams.first(where: { $0.index == audioChange }) {
            audio = try VelaAudioPath(stream: stream, demuxer: demuxer, decode: decodeAudio.contains(stream.index))
            enableStreams(demuxer)
        } else {
            audio?.flush()
        }
        guard demuxer.seek(to: target) else {
            throw VelaDemuxer.Failure.open("The file could not seek to \(Int(target)) s")
        }
    }

    private func route(_ packet: VelaDemuxPacket, _ demuxer: VelaDemuxer) throws {
        if packet.stream == videoStream?.index {
            try video(packet)
        } else if packet.stream == audio?.stream.index {
            audioPacket(packet)
        } else if demuxer.streams.indices.contains(packet.stream), demuxer.streams[packet.stream].isSubtitle {
            subtitles.keep(packet)
        }
    }

    /// Enough is read ahead of the clock, of both kinds (an interleave gap never starves one).
    private func readAheadFull() -> Bool {
        if queuedBytes > maximumQueuedBytes {
            return true
        }
        let now = clock()
        let videoFull = videoStream == nil || lastVideoTime - now > videoAhead
        let audioFull = audio == nil || lastAudioTime - now > audioAhead
        return videoFull && audioFull
    }

    private func video(_ packet: VelaDemuxPacket) throws {
        guard let stream = videoStream else {
            return
        }
        if videoFormat == nil {
            guard packet.keyframe else {
                return
            }
            try makeVideoFormat(stream, firstPacket: packet.data)
        }
        guard let format = videoFormat else {
            return
        }
        let bytes = format.sampleData(packet.data)
        let time = packet.pts.isFinite ? packet.pts : packet.dts
        lock.lock()
        let hidden = time.isFinite && time + max(packet.duration, 0.001) < dropBefore
        lock.unlock()
        let sample = VelaSampleBuffers.video(
            bytes, format: format.description, pts: packet.pts, dts: packet.dts,
            duration: packet.duration, keyframe: packet.keyframe, hidden: hidden
        )
        guard !bytes.isEmpty, let sample else {
            return
        }
        lock.lock()
        videoQueue.append(sample)
        queuedBytes += bytes.count
        if time.isFinite {
            lastVideoTime = max(lastVideoTime, time)
        }
        lock.unlock()
        kick()
    }

    private func audioPacket(_ packet: VelaDemuxPacket) {
        guard let audio else {
            return
        }
        lock.lock()
        let drop = dropBefore
        lock.unlock()
        let samples = audio.samples(for: packet, dropBefore: drop)
        guard !samples.isEmpty else {
            return
        }
        lock.lock()
        for sample in samples {
            audioQueue.append(sample.buffer)
            queuedBytes += sample.bytes
            lastAudioTime = max(lastAudioTime, sample.end)
        }
        lock.unlock()
        kick()
    }

    // MARK: Feeding (feed queue)

    /// Starts each renderer pulling from its queue, if it is not already.
    private func kick() {
        feedQueue.async { [weak self] in
            guard let self else {
                return
            }
            self.lock.lock()
            let startVideo = !self.feedingVideo && !self.videoQueue.isEmpty
            let startAudio = !self.feedingAudio && !self.audioQueue.isEmpty
            self.feedingVideo = self.feedingVideo || startVideo
            self.feedingAudio = self.feedingAudio || startAudio
            self.lock.unlock()
            if startVideo {
                self.videoRenderer.requestMediaDataWhenReady(on: self.feedQueue) { [weak self] in
                    self?.feedVideo()
                }
            }
            if startAudio {
                self.audioRenderer.requestMediaDataWhenReady(on: self.feedQueue) { [weak self] in
                    self?.feedAudio()
                }
            }
            self.startWhenReady()
        }
    }

    private func feedVideo() {
        if videoRenderer.status == .failed {
            videoFailed()
            return
        }
        while videoRenderer.isReadyForMoreMediaData {
            lock.lock()
            guard !videoQueue.isEmpty else {
                feedingVideo = false
                lock.unlock()
                videoRenderer.stopRequestingMediaData()
                break
            }
            let sample = videoQueue.removeFirst()
            queuedBytes -= CMSampleBufferGetTotalSampleSize(sample)
            lock.broadcast()
            lock.unlock()
            videoRenderer.enqueue(sample)
        }
        startWhenReady()
    }

    private func feedAudio() {
        if audioRenderer.status == .failed {
            audioFailed()
            return
        }
        while audioRenderer.isReadyForMoreMediaData {
            lock.lock()
            guard !audioQueue.isEmpty else {
                feedingAudio = false
                lock.unlock()
                audioRenderer.stopRequestingMediaData()
                break
            }
            let sample = audioQueue.removeFirst()
            queuedBytes -= CMSampleBufferGetTotalSampleSize(sample)
            lock.broadcast()
            lock.unlock()
            audioRenderer.enqueue(sample)
        }
        startWhenReady()
    }

    /// Starts the clock at the target once both renderers hold enough to play on.
    private func startWhenReady() {
        lock.lock()
        guard !started, !stopped, state != .failed, seekRequest == nil else {
            lock.unlock()
            return
        }
        let videoReady = videoStream == nil || lastVideoTime - dropBefore >= 1.0 || endOfFile
        let audioReady = audio == nil || lastAudioTime - dropBefore >= 0.5 || endOfFile
        guard videoReady && audioReady else {
            lock.unlock()
            return
        }
        started = true
        stalled = false
        state = wantsPlay ? .playing : .paused
        let start = CMTime(seconds: dropBefore, preferredTimescale: VelaSampleBuffers.videoTimescale)
        synchronizer.setRate(wantsPlay ? 1 : 0, time: start)
        lock.unlock()
        changed()
    }

    /// Buffering and the end, from the demux thread (under `lock`).
    private func maintainClock() {
        guard started, state != .failed else {
            return
        }
        let now = clock()
        let lastTime = videoStream != nil ? lastVideoTime : lastAudioTime
        if endOfFile && now >= lastTime - 0.05 {
            if state != .ended {
                state = .ended
                synchronizer.rate = 0
                changed()
            }
            return
        }
        guard !endOfFile && wantsPlay else {
            return
        }
        let videoLow = videoStream != nil && lastVideoTime - now < 0.15
        let audioLow = audio != nil && lastAudioTime - now < 0.1
        if (videoLow || audioLow) && !stalled {
            stalled = true
            synchronizer.rate = 0
            state = .buffering
            changed()
            return
        }
        let videoRefilled = videoStream == nil || lastVideoTime - now > 2.5
        let audioRefilled = audio == nil || lastAudioTime - now > 1
        if stalled && videoRefilled && audioRefilled {
            stalled = false
            synchronizer.rate = 1
            state = .playing
            changed()
        }
    }

    // MARK: Renderer failures

    private func videoFailed() {
        videoRenderer.stopRequestingMediaData()
        lock.lock()
        feedingVideo = false
        lock.unlock()
        // Dolby Vision this device or display refuses: present the base layer instead.
        if dolbyVision, videoFormat?.dynamicRange == "dv" {
            dolbyVision = false
            videoFormat = nil
            videoRenderer.flush()
            seek(to: currentTime)
            return
        }
        let reason = videoRenderer.error?.localizedDescription ?? "unknown"
        fail("The video could not be decoded (\(reason))", kind: "decoder")
    }

    private func audioFailed() {
        audioRenderer.stopRequestingMediaData()
        lock.lock()
        feedingAudio = false
        lock.unlock()
        // tvOS refused the compressed stream: decode it here instead.
        if let audio, !audio.isDecoded {
            decodeAudio.insert(audio.stream.index)
            self.audio = nil
            audioRenderer.flush()
            lock.lock()
            pendingAudioStream = audio.stream.index
            lock.unlock()
            seek(to: currentTime)
            return
        }
        let reason = audioRenderer.error?.localizedDescription ?? "unknown"
        fail("The audio could not be played (\(reason))", kind: "decoder")
    }
}
