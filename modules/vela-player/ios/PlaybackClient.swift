// Native engine seam. The property vocabulary is shared with PlayerState so the
// session/chrome/reporting code remains independent of the rendering engine.
import AetherEngine
import AVFoundation
import AVKit
import Combine
import CoreImage
import UIKit

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
    private weak var host: UIView?
    private let preview: Bool
    private let isLive: Bool
    private let remoteHLS: Bool
    private let loops: Bool
    private let aspectFill: Bool
    private let retainPausedPicture: Bool
    private var frameOutput: AVPlayerItemVideoOutput?
    private weak var outputItem: AVPlayerItem?
    private var frozenPicture: UIView?
    private static let frameContext = CIContext()
    private var failed = false
    private var engine: AetherEngine?
    private var surface: AetherPlayerView?
    private var subscriptions = Set<AnyCancellable>()
    private var displayObservers: [NSObjectProtocol] = []
    private var lastCacheDiagnostic = Date.distantPast
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
    private let captions = UILabel()
    private var bitmapCaptions: [Int: UIImageView] = [:]
    // Idle engines are reused across titles. A mounted client leases its engine exclusively,
    // including while a paused outgoing picture overlaps the next view.
    private static var primaryEngine: AetherEngine?
    private static var previewEngine: AetherEngine?

    init(host: UIView, preview: Bool = false, paused: Bool = false, muted: Bool = false,
         loops: Bool = false, aspectFill: Bool = false, isLive: Bool = false, remoteHLS: Bool = false, retainPausedPicture: Bool = false) {
        self.retainPausedPicture = retainPausedPicture
        self.host = host
        self.preview = preview
        self.paused = paused
        self.muted = muted
        self.isLive = isLive
        self.remoteHLS = remoteHLS
        self.loops = loops
        self.aspectFill = aspectFill
    }

    func layout() {
        guard let host else { return }
        frozenPicture?.frame = host.bounds
        surface?.frame = host.bounds
        surface?.setNeedsLayout()
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
            if !flag { frozenPicture?.removeFromSuperview(); frozenPicture = nil }
            flag ? engine?.pause() : engine?.play()
        }
        if name == "mute" { engine?.volume = flag ? 0 : volume }
    }
    func set(_ name: String, double: Double) {
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
            self.subscriptions.removeAll()
            self.surface?.removeFromSuperview()
            do {
                guard let host = self.host else { throw PlaybackError("Missing native video host") }
                // Upstream messages may contain media URLs. Keep grant URLs out of logs.
                EngineLog.handler = { _ in }
                let preview = self.preview
                let cached = self.engine ?? (preview ? Self.previewEngine : Self.primaryEngine)
                let engine = try cached ?? AetherEngine()
                if preview { Self.previewEngine = nil } else { Self.primaryEngine = nil }
                self.engine = engine
                engine.maximumSubtitleOffsetSeconds = 0
                let view = AetherPlayerView(frame: host.bounds)
                view.isUserInteractionEnabled = false
                view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                engine.videoGravity = self.aspectFill ? .resizeAspectFill : .resizeAspect
                host.addSubview(view)
                self.surface = view
                engine.bind(view: view)
                self.layout()
                engine.volume = self.muted ? 0 : self.volume
                self.captions.textColor = .white
                self.captions.font = .boldSystemFont(ofSize: 30)
                self.captions.textAlignment = .center
                self.captions.numberOfLines = 0
                self.captions.layer.shadowColor = UIColor.black.cgColor
                self.captions.layer.shadowOpacity = 1
                self.captions.layer.shadowRadius = 3
                // Aether attaches its video CALayer after load, above existing
                // subviews. Captions must remain above it even inside the picture.
                self.captions.layer.zPosition = 2
                view.addSubview(self.captions)
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
                    self?.prepareFrameOutput()
                    self?.emit("time-pos", time)
                    if self?.engine?.hasFirstFrameReadyForDisplay == true { self?.emit("video-pts", time) }
                    self?.drawCaptions()
                }.store(in: &self.subscriptions)
                engine.$audioDelivery.dropFirst().sink { [weak self] delivery in
                    if delivery == .droppedNoPipeline {
                        Task { @MainActor [weak self] in self?.failPath() }
                    }
                }.store(in: &self.subscriptions)
                engine.$activeAudioTrackIndex.sink { [weak self] in self?.emit("aid", $0.map { Int64($0) }) }.store(in: &self.subscriptions)
                engine.$activeSubtitleTrackIndex.sink { [weak self] in self?.emit("sid", $0.map { Int64($0) }) }.store(in: &self.subscriptions)
                engine.$videoFormat.sink { [weak self, weak engine] format in
                    if let engine { self?.publishVideoParams(engine, format: format) }
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
                // A guide/hero picture never owns the HDMI mode. Disabling matching alone
                // still permits criteria writes in Aether; host ownership suppresses all writes.
                if preview { opts.displayCriteriaOwner = .host }
                #if os(tvOS)
                let manager = host.window?.avDisplayManager
                self.displayObservers.forEach(NotificationCenter.default.removeObserver)
                self.displayObservers = [AVDisplayManagerModeSwitchStartNotification, AVDisplayManagerModeSwitchEndNotification].map { name in
                    NotificationCenter.default.addObserver(forName: name, object: manager, queue: .main) { _ in
                        print("[vela-display] event=\(name.rawValue) preview=\(preview)")
                    }
                }
                print("[vela-display] load preview=\(preview) match=\(opts.matchContentEnabled) owner=\(preview ? "host" : "engine") criteria=\(manager?.preferredDisplayCriteria != nil) switching=\(manager?.isDisplayModeSwitchInProgress ?? false)")
                #endif
                _ = try await engine.load(source: source, startPosition: self.start, options: opts,
                                          audioSourceStreamIndex: self.audio.map(Int32.init))
                guard !self.dead, !self.failed else { return }
                #if os(tvOS)
                print("[vela-display] ready preview=\(preview) criteria=\(host.window?.avDisplayManager.preferredDisplayCriteria != nil) switching=\(host.window?.avDisplayManager.isDisplayModeSwitchInProgress ?? false)")
                #endif
                print("[vela-player] Aether ready: route=\(engine.videoRoute) format=\(engine.videoFormat) audio=\(engine.audioDelivery) AVPlayerLayer=\(engine.nativePlayerLayer != nil) surface=\(view.bounds.size) videoRect=\(engine.nativePlayerLayer?.videoRect ?? .zero) external=\(engine.currentAVPlayer?.isExternalPlaybackActive ?? false)")
                self.emit("track-list", engine.audioTracks.map { self.track($0, type: "audio") } + engine.subtitleTracks.map { self.track($0, type: "sub") })
                self.publishVideoParams(engine, format: engine.videoFormat)
                self.onEvent?(.fileLoaded)
            } catch is CancellationError {} catch {
                guard !self.dead else { return }
                self.failPath()
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
        guard let engine, let surface else { return }
        let time = engine.clock.sourceTime
        let cues = engine.subtitleCues.filter { $0.startTime <= time && time < $0.endTime }
        let imageIDs = Set(cues.compactMap { cue -> Int? in
            if case .image = cue.body { return cue.id }; return nil
        })
        for id in Array(bitmapCaptions.keys) where !imageIDs.contains(id) {
            bitmapCaptions.removeValue(forKey: id)?.removeFromSuperview()
        }
        let coded = CGSize(width: Int(engine.sourceVideoWidth), height: Int(engine.sourceVideoHeight))
        let display = engine.softwareDisplaySize ?? coded
        let rect = engine.nativePlayerLayer?.videoRect ?? AVMakeRect(aspectRatio: display, insideRect: surface.bounds)
        for cue in cues {
            guard case .image(let image) = cue.body else { continue }
            let view = bitmapCaptions[cue.id] ?? UIImageView()
            if bitmapCaptions[cue.id] == nil {
                view.layer.zPosition = 1
                surface.addSubview(view)
                bitmapCaptions[cue.id] = view
            }
            view.image = UIImage(cgImage: image.cgImage)
            let canvas = image.canvasSize == .zero ? coded : image.canvasSize
            guard canvas.width > 0, coded.width > 0, coded.height > 0 else { continue }
            let canvasHeight = canvas.height * coded.width / canvas.width
            let canvasRect = CGRect(x: rect.minX, y: rect.midY - rect.height * canvasHeight / coded.height / 2,
                                    width: rect.width, height: rect.height * canvasHeight / coded.height)
            view.frame = CGRect(x: canvasRect.minX + image.position.minX * canvasRect.width,
                                y: canvasRect.minY + image.position.minY * canvasRect.height,
                                width: image.position.width * canvasRect.width, height: image.position.height * canvasRect.height)
        }
        let text = cues.compactMap { cue -> String? in
            switch cue.body {
            case .text(let text): return text
            case .richText(let runs): return runs.map(\.text).joined()
            case .image: return nil
            }
        }.joined(separator: "\n")
        captions.text = text
        captions.frame = CGRect(x: 40, y: surface.bounds.height * 0.7, width: max(0, surface.bounds.width - 80), height: surface.bounds.height * 0.25)
    }
    private func failPath() {
        guard !dead, !failed else { return }
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
        subscriptions.removeAll()
        bitmapCaptions.values.forEach { $0.removeFromSuperview() }
        bitmapCaptions.removeAll()
        engine?.stop()
        if preview { Self.previewEngine = engine } else { Self.primaryEngine = engine }
        engine = nil
        surface?.removeFromSuperview()
        surface = nil
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
        guard frozenPicture == nil, let host else { return }
        if let item = outputItem, let buffer = frameOutput?.copyPixelBuffer(forItemTime: item.currentTime(), itemTimeForDisplay: nil) {
            let image = CIImage(cvPixelBuffer: buffer)
            let scale = min(1, 1280 / image.extent.width)
            let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            if let frame = Self.frameContext.createCGImage(scaled, from: scaled.extent) {
                let still = UIImageView(image: UIImage(cgImage: frame))
                still.contentMode = aspectFill ? .scaleAspectFill : .scaleAspectFit
                still.backgroundColor = .black
                still.clipsToBounds = true
                frozenPicture = still
            }
        }
        if frozenPicture == nil { frozenPicture = surface?.snapshotView(afterScreenUpdates: false) }
        guard let still = frozenPicture else { return }
        still.frame = host.bounds
        still.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(still)
    }

    func destroy() {
        displayObservers.forEach(NotificationCenter.default.removeObserver)
        displayObservers.removeAll()
        dead = true
        frozenPicture?.removeFromSuperview()
        frozenPicture = nil
        if let output = frameOutput { outputItem?.remove(output) }
        frameOutput = nil
        outputItem = nil
        loadTask?.cancel()
        loadTask = nil
        subscriptions.removeAll()
        bitmapCaptions.values.forEach { $0.removeFromSuperview() }
        bitmapCaptions.removeAll()
        engine?.stop()
        if preview { Self.previewEngine = engine } else { Self.primaryEngine = engine }
        engine = nil
        surface?.removeFromSuperview()
        surface = nil
        onProperty = nil
        onEvent = nil
    }
}

struct PlaybackError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}
