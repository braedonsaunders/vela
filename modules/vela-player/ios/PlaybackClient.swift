// Native engine seam. The property vocabulary is shared with PlayerState so the
// session/chrome/reporting code remains independent of the rendering engine.
import AetherEngine
import AVFoundation
import AVKit
import Combine
import CoreImage
import Foundation

@MainActor
final class PlaybackClient {
    enum Event {
        case fileLoaded
        case endFile(reason: Int32, error: Int32)
        case seekDone
        case refused(status: Int)
        case shutdown
    }
    var onProperty: ((String, Any?) -> Void)?
    var onEvent: ((Event) -> Void)?
    var onBackend: ((String) -> Void)?
    private let rendering: PlaybackRendering
    private let preview: Bool
    private let isLive: Bool
    private let remoteHLS: Bool
    private let loops: Bool
    private let aspectFill: Bool
    private let retainPausedPicture: Bool
    /// A multiview tile's index: its own engine beside the others, a `.secondary` shared output.
    private let tile: Int?
    private var frameOutput: AVPlayerItemVideoOutput?
    private weak var outputItem: AVPlayerItem?
    private var reportedFirstFrame = false
    private static let frameContext = CIContext()
    private var failed = false
    private var reconnecting = false
    private var readRetryStarted: Date?
    private var readRetryAttempt = 0
    private var engine: AetherEngine?
    private var subscriptions = Set<AnyCancellable>()
    private var liveRateObservation: NSKeyValueObservation?
    private var liveItemObservation: NSKeyValueObservation?
    private var displayCriteriaObservation: NSKeyValueObservation?
    private var displayObservers: [NSObjectProtocol] = []
    private var lastLiveDiagnostic = Date.distantPast
    private var lastCacheDiagnostic = Date.distantPast
    private var lastFormatDiagnostic = Date.distantPast
    /// Halved each time the volume still ran out under the budget (storageExhausted), at most twice.
    private var cacheShrink = 1.0
    private var formatDescription: NSDictionary?
    private var preferences = PlaybackPreferences.current
    /// A full-screen watch: not a preview or a multiview tile. Only it takes the viewer's delivery choices.
    private var fullScreen: Bool { !preview && tile == nil }
    private var loadTask: Task<Void, Never>?
    private var headers: [String] = []
    private var properties: [String: Any] = [:]
    private var url: URL?
    private var start = 0.0
    private var dead = false
    private var paused: Bool
    private var volume: Float = 1
    private var muted: Bool
    private var audio: Int?
    private var subtitle: Int?
    /// The viewer's subtitle delay for this title, in seconds (positive shows cues later).
    private var subtitleOffset = 0.0
    // Idle engines are reused across titles. A mounted client leases its engine exclusively,
    // including while a paused outgoing picture overlaps the next view.
    private static var primaryEngine: AetherEngine?
    private static var previewEngine: AetherEngine?

    init(rendering: PlaybackRendering, preview: Bool = false, paused: Bool = false, muted: Bool = false,
         loops: Bool = false, aspectFill: Bool = false, isLive: Bool = false, remoteHLS: Bool = false, retainPausedPicture: Bool = false,
         tile: Int? = nil) {
        self.retainPausedPicture = retainPausedPicture
        self.tile = tile
        self.rendering = rendering
        self.preview = preview
        self.paused = paused
        self.muted = muted
        self.isLive = isLive
        self.remoteHLS = remoteHLS
        self.loops = loops
        self.aspectFill = aspectFill
    }

    func layout() {
        rendering.layout()
    }

    func value(_ name: String) -> Any? { properties[name] }
    private func emit(_ name: String, _ value: Any?) {
        properties[name] = value
        onProperty?(name, value)
    }
    func setStringList(_ name: String, _ values: [String]) {
        if name == "http-header-fields" { headers = values }
    }
    func set(_ name: String, _ value: String) {
        switch name {
        case "aid":
            audio = Int(value)
            if let audio { engine?.selectAudioTrack(index: audio); emit("aid", Int64(audio)) }
        case "sid":
            subtitle = Int(value)
            if let subtitle { engine?.selectSubtitleTrack(index: subtitle); emit("sid", Int64(subtitle)) }
            else { engine?.clearSubtitle(); emit("sid", nil) }
        default: break
        }
    }
    func set(_ name: String, flag: Bool) {
        if name == "pause" { paused = flag }
        if name == "mute" { muted = flag }
        if name == "pause" {
            if flag && retainPausedPicture { freezePicture() }
            if !flag { rendering.clearFrozenPicture() }
            flag ? engine?.pause() : engine?.play()
        }
        if name == "mute" { engine?.volume = flag ? 0 : volume }
    }
    func set(_ name: String, double: Double) {
        if name == "sub-delay" {
            subtitleOffset = max(-600, min(600, double))
            // Aether keeps decoded cues this far either side of the clock for the overlay's offset.
            engine?.maximumSubtitleOffsetSeconds = abs(subtitleOffset)
            emit("sub-delay", subtitleOffset)
            drawCaptions()
        }
        if name == "volume" { volume = Float(double / 100) }
        if name == "volume" { engine?.volume = muted ? 0 : volume }
    }
    func command(_ args: [String]) {
        switch args.first {
        case "loadfile":
            guard args.count > 1, let url = URL(string: args[1]) else { return }
            self.url = url
            if let flags = args.last?.split(separator: ",") {
                for flag in flags where flag.hasPrefix("start=") { start = Double(flag.dropFirst(6)) ?? 0 }
            }
            if ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") { load(url) }
            else { failPath() }
        case "seek":
            guard args.count > 1, let target = Double(args[1]), let engine else { return }
            Task { @MainActor in await engine.seek(to: target) }
        case "sub-add":
            guard args.count > 1, let url = URL(string: args[1]), let engine else { return }
            let track = engine.addExternalSubtitleTrack(ExternalSubtitleTrack(url: url))
            engine.selectSubtitleTrack(index: track.id)
        default: break
        }
    }
    private func load(_ url: URL) {
        loadTask = Task { @MainActor [weak self] in
            guard let self, !self.dead else { return }
            self.liveRateObservation = nil
            self.liveItemObservation = nil
            self.subscriptions.removeAll()
            self.rendering.removeSurface()
            self.formatDescription = nil
            do {
                // Upstream messages may contain media URLs. Keep grant URLs out of logs.
                EngineLog.handler = { _ in }
                let preview = self.preview
                // A tile never borrows the reusable engines: up to four play at once, each its own.
                let cached = self.engine ?? (self.tile != nil ? nil : preview ? Self.previewEngine : Self.primaryEngine)
                let engine = try cached ?? AetherEngine()
                if self.tile == nil { if preview { Self.previewEngine = nil } else { Self.primaryEngine = nil } }
                self.engine = engine
                engine.logTag = self.tile.map { "tile\($0)" }
                engine.maximumSubtitleOffsetSeconds = abs(self.subtitleOffset)
                engine.videoGravity = self.aspectFill ? .resizeAspectFill : .resizeAspect
                try self.rendering.bind(engine: engine)
                self.layout()
                engine.volume = self.muted ? 0 : self.volume
                engine.diagnostics.$sessionCacheStatus.removeDuplicates().sink { [weak self] status in
                    self?.logCacheStatus(status)
                }.store(in: &self.subscriptions)
                // Published values initially belong to the previous load on this reused
                // engine. Only subsequent transitions can fail this client's source.
                engine.$state.dropFirst().sink { [weak self] state in
                    guard let self, !self.dead else { return }
                    switch state {
                    case .playing: self.emit("pause", false)
                    case .paused: self.emit("pause", true)
                    case .ended:
                        if self.retainPausedPicture { self.freezePicture() }
                        self.emit("eof-reached", true)
                        self.onEvent?(.endFile(reason: 0, error: 0))
                        if self.loops { self.load(url) }
                    // @Published delivers before assigning. Stop after that setter returns,
                    // otherwise its error assignment can overwrite stop()'s idle state.
                    case .error: Task { @MainActor [weak self] in self?.failPath() }
                    default: break
                    }
                }.store(in: &self.subscriptions)
                engine.clock.$currentTime.sink { [weak self] time in
                    if let self, self.readRetryStarted != nil, time > self.start + 10 { self.readRetryStarted = nil; self.readRetryAttempt = 0 }
                    self?.prepareFrameOutput()
                    self?.emit("time-pos", time)
                    if self?.engine?.hasFirstFrameReadyForDisplay == true {
                        if self?.reportedFirstFrame == false {
                            self?.reportedFirstFrame = true
                            print("[vela-preview] firstFrame preview=\(self?.preview ?? false)")
                        }
                        self?.emit("video-pts", time)
                    }
                    self?.drawCaptions()
                    self?.publishFormat()
                    if let self, self.isLive, !self.preview,
                       Date().timeIntervalSince(self.lastLiveDiagnostic) >= 2,
                       let player = self.engine?.currentAVPlayer {
                        self.lastLiveDiagnostic = Date()
                        let edge = player.currentItem?.seekableTimeRanges.last?.timeRangeValue
                        let offset = edge.map { CMTimeGetSeconds(CMTimeRangeGetEnd($0)) - player.currentTime().seconds } ?? .nan
                        print("[vela-live] rate=\(player.rate) position=\(player.currentTime().seconds) offset=\(offset) status=\(player.timeControlStatus.rawValue)")
                    }
                }.store(in: &self.subscriptions)
                engine.$audioDelivery.dropFirst().sink { [weak self] delivery in
                    if delivery == .droppedNoPipeline {
                        Task { @MainActor [weak self] in self?.failPath() }
                    }
                    Task { @MainActor [weak self] in self?.publishFormat(force: true) }
                }.store(in: &self.subscriptions)
                engine.$activeAudioTrackIndex.sink { [weak self] in self?.emit("aid", $0.map { Int64($0) }) }.store(in: &self.subscriptions)
                engine.$activeSubtitleTrackIndex.sink { [weak self] in self?.emit("sid", $0.map { Int64($0) }) }.store(in: &self.subscriptions)
                engine.$videoFormat.sink { [weak self, weak engine] format in
                    if let engine { self?.publishVideoParams(engine, format: format) }
                    Task { @MainActor [weak self] in self?.publishFormat(force: true) }
                }.store(in: &self.subscriptions)
                engine.$duration.sink { [weak self] in self?.emit("duration", $0) }.store(in: &self.subscriptions)
                engine.$isBuffering.sink { [weak self] in self?.emit("paused-for-cache", $0) }.store(in: &self.subscriptions)
                engine.seekEvents.sink { [weak self] event in
                    if case .landed = event.outcome { self?.onEvent?(.seekDone) }
                }.store(in: &self.subscriptions)
                engine.$isSeeking.sink { [weak self] in self?.emit("seeking", $0) }.store(in: &self.subscriptions)
                engine.clock.$bufferedPosition.sink { [weak self] in self?.emit("demuxer-cache-time", $0) }.store(in: &self.subscriptions)
                let source: MediaSource
                if self.headers.isEmpty {
                    source = .url(url)
                } else {
                    guard let access = VelaMediaAccessStore.snapshot,
                          !access.headers(for: url).isEmpty else { throw PlaybackError("Media access expired") }
                    source = .custom(ScopedAetherReader(url: url, access: access))
                }
                self.onBackend?("aether")
                // All grant headers stay in the scoped byte reader. Aether's own requests,
                // including HLS resources and external subtitles, receive no credentials.
                var opts = LoadOptions(httpHeaders: [:], matchContentEnabled: !preview,
                                       isLive: self.isLive, nativeRemoteHLS: self.remoteHLS && self.headers.isEmpty,
                                       initialSubtitleTrackID: self.subtitle, autoplay: !self.paused)
                // Keep live HLS on AVPlayer: the software feeder in Aether 7.70
                // automatically re-places the playhead after a rebuffer.
                if self.isLive { opts.clampsLiveResumeToWindow = false }
                if self.isLive && opts.nativeRemoteHLS {
                    opts.nativeRemoteHLSIngestFallback = false
                }
                // A guide/hero picture never owns the HDMI mode. Disabling matching alone
                // still permits criteria writes in Aether; host ownership suppresses all writes.
                if preview { opts.displayCriteriaOwner = .host }
                // Tiles share the device's outputs: none writes display criteria or owns Now Playing,
                // and the audio session stays up until the last engine stops.
                if self.tile != nil {
                    opts.sharedOutputRole = .secondary
                    opts.displayCriteriaOwner = .host
                    opts.matchContentEnabled = false
                }
                self.preferences.configure(&opts, fullScreen: self.fullScreen)
                self.configureCache(&opts)
                // libass draws ASS/SSA as authored from the raw events, header and container fonts.
                if ASSSubtitles.isAvailable && !preview { opts.preserveASSMarkup = true }
                self.rendering.configureLoad(options: &opts, preview: preview)
                _ = try await engine.load(source: source, startPosition: self.start, options: opts,
                                          audioSourceStreamIndex: self.audio.map(Int32.init))
                guard !self.dead, !self.failed else { return }
                if self.isLive, let player = engine.currentAVPlayer {
                    self.liveItemObservation = player.observe(\.currentItem, options: [.initial, .new]) { player, _ in
                        Task { @MainActor in
                            player.currentItem?.automaticallyPreservesTimeOffsetFromLive = false
                            player.currentItem?.configuredTimeOffsetFromLive = .invalid
                        }
                    }
                    self.liveRateObservation = player.observe(\.rate, options: [.initial, .new]) { player, _ in
                        Task { @MainActor in
                            if player.rate > 1 { player.rate = 1 }
                        }
                    }
                }
                self.emit("track-list", engine.audioTracks.map { self.track($0, type: "audio") } + engine.subtitleTracks.map { self.track($0, type: "sub") })
                self.publishVideoParams(engine, format: engine.videoFormat)
                self.onEvent?(.fileLoaded)
            } catch is CancellationError {} catch {
                guard !self.dead else { return }
                self.failPath()
            }
        }
    }
    /// The segment cache's share of the device, from the space free now (PlaybackCacheBudget). Orphaned
    /// sessions are swept first so their bytes count as free. Previews and tiles take a quarter share.
    private func configureCache(_ options: inout LoadOptions) {
        let swept = PlaybackCacheBudget.removeStaleSessions()
        guard let free = PlaybackCacheBudget.freeBytes() else { return }
        let budget = PlaybackCacheBudget.plan(freeBytes: free, shrink: fullScreen ? cacheShrink : cacheShrink * 0.25)
        options.sessionCacheByteBudget = budget.byteBudget
        options.sessionCacheHardLimitBytes = budget.hardLimit
        options.sessionCacheFreeReserveBytes = budget.freeReserve
        print("[vela-aether-cache] budget free=\(free) swept=\(swept) limit=\(budget.hardLimit) reserve=\(budget.freeReserve) shrink=\(cacheShrink)")
    }

    /// Source → output facts for the info card, at most once a second unless a route or format changed.
    private func publishFormat(force: Bool = false) {
        guard !dead, !failed, !preview, let engine else { return }
        guard force || Date().timeIntervalSince(lastFormatDiagnostic) >= 1 else { return }
        lastFormatDiagnostic = Date()
        let next = PlaybackFormat.describe(engine, preferences: preferences, display: rendering.displayMatch()) as NSDictionary
        guard next != formatDescription else { return }
        let first = formatDescription == nil
        formatDescription = next
        emit("format", next as? [String: Any])
        if first || force, let data = try? JSONSerialization.data(withJSONObject: next, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print("[vela-format] \(text)")
        }
    }

    /// The viewer changed a delivery choice: the playing title takes it at the current position.
    func apply(preferences next: PlaybackPreferences) {
        guard next != preferences else { return }
        preferences = next
        guard fullScreen, let engine, let url, !dead else { return }
        let fullScreen = self.fullScreen
        Task { @MainActor [weak self] in
            do {
                _ = try await engine.reloadAtCurrentPosition { next.configure(&$0, fullScreen: fullScreen) }
                self?.publishFormat(force: true)
            } catch {
                guard let self, !self.dead else { return }
                self.start = (self.properties["time-pos"] as? Double) ?? self.start
                self.load(url)
            }
        }
    }

    private func publishVideoParams(_ engine: AetherEngine, format: VideoFormat) {
        guard !dead, !failed, engine.sourceVideoWidth > 0, engine.sourceVideoHeight > 0 else { return }
        let gamma: String
        switch format {
        case .sdr: gamma = "bt.1886"
        case .hlg: gamma = "hlg"
        default: gamma = "pq"
        }
        var params: [String: Any] = ["w": Int64(engine.sourceVideoWidth), "h": Int64(engine.sourceVideoHeight), "gamma": gamma]
        if format == .dolbyVision { params["dovi"] = true }
        emit("video-params", params)
    }

    private func logCacheStatus(_ status: SessionCacheStatus, force: Bool = false) {
        guard force || status.lastFailure != nil || Date().timeIntervalSince(lastCacheDiagnostic) >= 15 else { return }
        lastCacheDiagnostic = Date()
        func number(_ value: Int?) -> Any { value.map { $0 as Any } ?? NSNull() }
        let fields: [String: Any] = [
            "route": String(describing: status.route), "capability": String(describing: status.capability),
            "requestedBudgetBytes": number(status.requestedBudgetBytes),
            "volumeSafetyLimitBytes": number(status.volumeSafetyLimitBytes),
            "baseEffectiveBudgetBytes": status.baseEffectiveBudgetBytes,
            "playbackSafeFloorBytes": status.playbackSafeFloorBytes, "effectiveBudgetBytes": status.effectiveBudgetBytes,
            "hardLimitBytes": number(status.hardLimitBytes), "freeDiskReserveBytes": status.freeDiskReserveBytes,
            "residentBytes": status.currentResidentBytes, "forwardBytes": status.currentForwardBytes,
            "stagingBytes": status.stagingBytes, "forwardSegments": status.forwardWindowSegments,
            "backwardSegments": status.backwardWindowSegments, "producerParked": status.producerParked,
            "diskAdmissionWaiting": status.diskAdmissionWaiting, "evictionCount": status.evictionCount,
            "hardWindowFloorExceeded": status.hardWindowFloorExceeded, "rejectedWrites": status.rejectedDiskWrites,
            "lastFailure": status.lastFailure.map { String(describing: $0) } ?? "none",
            "cleanupReason": status.cleanupReason.map { String(describing: $0) } ?? "none",
            "cleanupResult": String(describing: status.cleanupResult),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) { print("[vela-aether-cache] \(text)") }
    }

    private func track(_ track: TrackInfo, type: String) -> [String: Any] {
        ["id": Int64(track.id), "ff-index": Int64(track.id), "type": type, "title": track.name,
         "lang": track.language ?? "und", "codec": track.codec, "external": track.isExternal]
    }
    private func drawCaptions() {
        if let engine { rendering.drawCaptions(engine: engine, offset: subtitleOffset) }
    }
    private func failPath() {
        guard !dead, !failed, !reconnecting else { return }
        // The volume ran out even inside the budget (other apps wrote meanwhile): play on from here with a
        // smaller cache rather than ask the server for a transcode, which needs the same disk.
        if let failure = engine?.errorInfo, failure.kind.rawValue == "storageExhausted", cacheShrink > 0.3, let url {
            cacheShrink /= 2
            start = (properties["time-pos"] as? Double) ?? start
            print("[vela-aether-cache] storage exhausted; reloading with shrink=\(cacheShrink)")
            logCacheStatus(engine!.diagnostics.sessionCacheStatus, force: true)
            engine?.stop()
            load(url)
            return
        }
        let ioCodes = [-110, -104, -1001, -1005, -1009, -1004]
        if let failure = engine?.errorInfo,
           (ioCodes.contains(Int(failure.underlyingCode ?? 0)) || ioCodes.contains(Int(failure.ffmpegErrorCode ?? 0))),
           let url {
            let began = readRetryStarted ?? Date()
            readRetryStarted = began
            let delays: [Double] = [1, 2, 4, 8, 15, 15, 15]
            if readRetryAttempt < delays.count {
                let wait = delays[readRetryAttempt]
                readRetryAttempt += 1
                if Date().timeIntervalSince(began) + wait <= 60 {
                    start = (properties["time-pos"] as? Double) ?? start
                    reconnecting = true
                    liveRateObservation = nil
                    liveItemObservation = nil
                    subscriptions.removeAll()
                    engine?.stop()
                    emit("paused-for-cache", true)
                    loadTask = Task { @MainActor [weak self] in
                        do { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) } catch { return }
                        guard let self, !self.dead else { return }
                        self.reconnecting = false
                        self.load(url)
                    }
                    return
                }
            }
        }
        failed = true
        loadTask?.cancel()
        if engine?.hasFirstFrameReadyForDisplay == true {
            start = (properties["time-pos"] as? Double) ?? start
        }
        if let engine {
            logCacheStatus(engine.diagnostics.sessionCacheStatus, force: true)
            if let failure = engine.errorInfo {
                print("[vela-player] Aether failure kind=\(failure.kind) underlying=\(failure.underlyingCode ?? 0) ffmpeg=\(failure.ffmpegErrorCode ?? 0)")
            }
        }
        if retainPausedPicture { freezePicture() }
        liveRateObservation = nil
        liveItemObservation = nil
        subscriptions.removeAll()

        engine?.stop()
        retire(engine)
        engine = nil
        rendering.removeSurface()
        print("[vela-player] AetherEngine refused path; requesting server recovery")
        onEvent?(.endFile(reason: 4, error: -1))
    }

    /// Native video layers clear on upstream failure, so the outgoing preview needs its own still.
    private func prepareFrameOutput() {
        guard retainPausedPicture, let item = engine?.currentAVPlayer?.currentItem, item !== outputItem else { return }
        if let output = frameOutput { outputItem?.remove(output) }
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        item.add(output)
        outputItem = item
        frameOutput = output
    }

    private func freezePicture() {
        var frame: CGImage?
        if let item = outputItem, let buffer = frameOutput?.copyPixelBuffer(forItemTime: item.currentTime(), itemTimeForDisplay: nil) {
            let image = CIImage(cvPixelBuffer: buffer)
            let scaled = image.transformed(by: CGAffineTransform(scaleX: min(1, 1280 / image.extent.width), y: min(1, 1280 / image.extent.width)))
            frame = Self.frameContext.createCGImage(scaled, from: scaled.extent)
        }
        rendering.freezePicture(frame: frame, aspectFill: aspectFill)
    }

    func destroy() {
        displayCriteriaObservation?.invalidate(); displayCriteriaObservation = nil
        displayObservers.forEach(NotificationCenter.default.removeObserver)
        displayObservers.removeAll()
        dead = true
        rendering.clearFrozenPicture()
        if let output = frameOutput { outputItem?.remove(output) }
        frameOutput = nil
        outputItem = nil
        loadTask?.cancel()
        loadTask = nil
        liveRateObservation = nil
        liveItemObservation = nil
        subscriptions.removeAll()

        engine?.stop()
        retire(engine)
        engine = nil
        rendering.removeSurface()
        onProperty = nil
        onEvent = nil
    }
}

extension PlaybackClient {
    /// A stopped engine goes back to its pool; a tile's is released (Aether counts it out on `stop()`).
    fileprivate func retire(_ engine: AetherEngine?) {
        guard tile == nil, let engine else { return }
        if preview { Self.previewEngine = engine } else { Self.primaryEngine = engine }
    }
}

struct PlaybackError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
