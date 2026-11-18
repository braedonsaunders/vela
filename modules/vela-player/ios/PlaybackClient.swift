// Native engine seam. The property vocabulary is shared with PlayerState so the
// session/chrome/reporting code remains independent of the rendering engine.
import AetherEngine
import AVFoundation
import Combine
import Libmpv
import UIKit

@MainActor
final class PlaybackClient {
    typealias Event = MPVClient.Event
    var onProperty: ((String, Any?) -> Void)?
    var onEvent: ((Event) -> Void)?
    var onBackend: ((String) -> Void)?
    private let layer: CAMetalLayer
    private let options: [String: String]
    var usesAether: Bool { fallback == nil }
    private var fallback: MPVClient?
    private var engine: AetherEngine?
    private var surface: AetherPlayerView?
    private var subscriptions = Set<AnyCancellable>()
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
    // Reuse the engine across titles; previews have an independent muted session.
    private static var primaryEngine: AetherEngine?
    private static var previewEngine: AetherEngine?

    init(layer: CAMetalLayer, options: [String: String]) throws {
        self.layer = layer
        self.options = options
        paused = options["pause"] == "yes"
        muted = options["mute"] == "yes"
    }

    func observe(_ name: String, format: mpv_format) {}
    func value(_ name: String) -> Any? { fallback?.value(name) ?? properties[name] }
    private func emit(_ name: String, _ value: Any?) {
        properties[name] = value
        onProperty?(name, value)
    }
    func setStringList(_ name: String, _ values: [String]) {
        if name == "http-header-fields" { headers = values }
        fallback?.setStringList(name, values)
    }
    func set(_ name: String, _ value: String) {
        if let fallback { fallback.set(name, value); return }
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
        if let fallback { fallback.set(name, flag: flag); return }
        if name == "pause" { flag ? engine?.pause() : engine?.play() }
        if name == "mute" { engine?.volume = flag ? 0 : volume }
    }
    func set(_ name: String, double: Double) {
        if let fallback { fallback.set(name, double: double); return }
        if name == "volume" { volume = Float(double / 100); engine?.volume = muted ? 0 : volume }
    }
    func command(_ args: [String]) {
        if let fallback { fallback.command(args); return }
        switch args.first {
        case "loadfile":
            guard args.count > 1, let url = URL(string: args[1]) else { return }
            self.url = url
            if let flags = args.last?.split(separator: ",") {
                for flag in flags where flag.hasPrefix("start=") { start = Double(flag.dropFirst(6)) ?? 0 }
            }
            if ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") { load(url) }
            else { demote() }
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
                EngineLog.handler = { print("[aether] \($0)") }
                let preview = self.options["audio"] == "no"
                let cached = preview ? Self.previewEngine : Self.primaryEngine
                let engine = try cached ?? AetherEngine()
                if preview { Self.previewEngine = engine } else { Self.primaryEngine = engine }
                self.engine = engine
                engine.maximumSubtitleOffsetSeconds = 0
                let view = AetherPlayerView(frame: self.layer.frame)
                view.isUserInteractionEnabled = false
                view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                engine.videoGravity = self.options["panscan"] == "1.0" ? .resizeAspectFill : .resizeAspect
                guard let host = self.layer.delegate as? UIView ?? self.layer.superlayer?.delegate as? UIView else {
                    throw MPVError("Missing native video host")
                }
                host.addSubview(view)
                self.surface = view
                self.layer.isHidden = true
                engine.bind(view: view)
                engine.volume = self.muted ? 0 : self.volume
                self.captions.textColor = .white
                self.captions.font = .boldSystemFont(ofSize: 30)
                self.captions.textAlignment = .center
                self.captions.numberOfLines = 0
                self.captions.layer.shadowColor = UIColor.black.cgColor
                self.captions.layer.shadowOpacity = 1
                self.captions.layer.shadowRadius = 3
                view.addSubview(self.captions)
                engine.$state.sink { [weak self] state in
                    guard let self, !self.dead else { return }
                    switch state {
                    case .playing: self.emit("pause", false)
                    case .paused: self.emit("pause", true)
                    case .ended:
                        self.emit("eof-reached", true)
                        self.onEvent?(.endFile(reason: 0, error: 0))
                        if self.options["loop-file"] == "inf" { self.load(url) }
                    case .error: self.demote()
                    default: break
                    }
                }.store(in: &self.subscriptions)
                engine.clock.$currentTime.sink { [weak self] time in
                    self?.emit("time-pos", time)
                    if self?.engine?.hasFirstFrameReadyForDisplay == true { self?.emit("video-pts", time) }
                    self?.drawCaptions()
                }.store(in: &self.subscriptions)
                engine.$audioDelivery.sink { [weak self] delivery in
                    if delivery == .droppedNoPipeline { self?.demote() }
                }.store(in: &self.subscriptions)
                engine.$activeAudioTrackIndex.sink { [weak self] in self?.emit("aid", $0.map { Int64($0) }) }.store(in: &self.subscriptions)
                engine.$activeSubtitleTrackIndex.sink { [weak self] in self?.emit("sid", $0.map { Int64($0) }) }.store(in: &self.subscriptions)
                engine.$duration.sink { [weak self] in self?.emit("duration", $0) }.store(in: &self.subscriptions)
                engine.$isBuffering.sink { [weak self] in self?.emit("paused-for-cache", $0) }.store(in: &self.subscriptions)
                engine.seekEvents.sink { [weak self] event in
                    if case .landed = event.outcome { self?.onEvent?(.seekDone) }
                }.store(in: &self.subscriptions)
                engine.$isSeeking.sink { [weak self] in self?.emit("seeking", $0) }.store(in: &self.subscriptions)
                engine.clock.$bufferedPosition.sink { [weak self] in self?.emit("demuxer-cache-time", $0) }.store(in: &self.subscriptions)
                var httpHeaders: [String: String] = [:]
                for header in self.headers {
                    if let colon = header.firstIndex(of: ":") {
                        httpHeaders[String(header[..<colon])] = header[header.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                    }
                }
                self.onBackend?("aether")
                let opts = LoadOptions(httpHeaders: httpHeaders, matchContentEnabled: !preview,
                                       initialSubtitleTrackID: self.subtitle, autoplay: !self.paused)
                _ = try await engine.load(url: url, startPosition: self.start, options: opts,
                                          audioSourceStreamIndex: self.audio.map(Int32.init))
                guard !self.dead, self.fallback == nil else { return }
                self.emit("track-list", engine.audioTracks.map { self.track($0, type: "audio") } + engine.subtitleTracks.map { self.track($0, type: "sub") })
                let gamma: String
                switch engine.videoFormat {
                case .sdr: gamma = "bt.1886"
                case .hlg: gamma = "hlg"
                default: gamma = "pq"
                }
                var params: [String: Any] = ["w": Int64(engine.sourceVideoWidth), "h": Int64(engine.sourceVideoHeight), "gamma": gamma]
                if engine.videoFormat == .dolbyVision { params["dovi"] = true }
                self.emit("video-params", params)
                self.onEvent?(.fileLoaded)
            } catch is CancellationError {} catch {
                guard !self.dead else { return }
                self.demote()
            }
        }
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
            if bitmapCaptions[cue.id] == nil { surface.addSubview(view); bitmapCaptions[cue.id] = view }
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
    private func demote() {
        guard !dead, fallback == nil, let url else { return }
        if engine?.hasFirstFrameReadyForDisplay == true {
            start = (properties["time-pos"] as? Double) ?? start
        }
        subscriptions.removeAll()
        bitmapCaptions.values.forEach { $0.removeFromSuperview() }
        bitmapCaptions.removeAll()
        engine?.stop()
        engine = nil
        surface?.removeFromSuperview()
        surface = nil
        do {
            print("[vela-player] AetherEngine failed; falling back to mpv")
            let mpv = try MPVClient(layer: layer, options: options)
            fallback = mpv
            layer.isHidden = false
            mpv.onProperty = { [weak self] in self?.onProperty?($0, $1) }
            mpv.onEvent = { [weak self] in self?.onEvent?($0) }
            for property in PlayerState.observed { mpv.observe(property.name, format: property.format) }
            mpv.observe("video-pts", format: MPV_FORMAT_DOUBLE)
            mpv.setStringList("http-header-fields", headers)
            mpv.set("stream-lavf-o", headers.isEmpty ? "" : "max_redirects=0")
            mpv.command(["loadfile", url.absoluteString, "replace", "-1", "start=\(start)"])
            onBackend?("mpv")
        } catch { onEvent?(.endFile(reason: 4, error: -1)) }
    }
    func destroy() {
        dead = true
        loadTask?.cancel()
        loadTask = nil
        subscriptions.removeAll()
        bitmapCaptions.values.forEach { $0.removeFromSuperview() }
        bitmapCaptions.removeAll()
        engine?.stop()
        engine = nil
        surface?.removeFromSuperview()
        surface = nil
        fallback?.destroy()
        fallback = nil
        onProperty = nil
        onEvent = nil
    }
}
