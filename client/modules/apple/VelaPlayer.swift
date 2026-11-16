// vela-player on tvOS: the same props and messages as the web view (client/player/web-module.ts,
// model.ts, protocol.ts), driving a native backend:
//   - an original the server offers by byte range plays in VelaOriginalEngine (no conversion);
//   - anything else (Ether's remux or conversion HLS) plays in AVPlayer, labelled as such.
// Seeks, track changes and path switches go to the server as session commands, as the web
// engine sends them; a track the original carries switches here, client-side.
import AVFoundation
import AVKit
import Foundation
import MediaPlayer
import UIKit

final class VelaPlayerView: ExactNativeInstance {
    private let surface = VelaSurface()
    private var backend: VelaBackend?
    private var original: VelaOriginalEngine? { backend as? VelaOriginalEngine }

    // The server's plan and what this view has applied of it.
    private var planJSON = ""
    private var plan: [String: Any] = [:]
    private var sessionId = ""
    private var revision = -1
    private var sourceGeneration = 0
    private var seekGeneration = 0
    private var activePathId = ""
    private var activeKey = ""
    private var mediaAuth: VelaMediaAuth?
    private var mediaAuthJSON = ""
    private var serverError = ""
    private var lastCommand = -1

    // Local state
    private var pendingSeek: Double?
    private var pendingSeekAt = Date.distantPast
    private var audioTrackId: String?
    private var subtitleTrackId: String?
    private var audioClientOnly = false
    private var subtitleClientOnly = false
    private var volume: Float = 1
    private var muted = false
    private var sequence = 0
    private var lastObservation = Date.distantPast
    private var endedReported = ""
    private var failureReported = ""
    private var actionError: String?
    private var externalCues: [VelaCue] = []
    private var subtitleStyle = VelaSubtitleStyle()
    private var timer: Timer?
    private let ambient: Bool

    init(_ module: Vela, _ props: [String: String], _ events: ExactNativeEvents) throws {
        ambient = props["ambient"] == "true"
        super.init(events: events)
        if !ambient { VelaAudioSession.activate() }
        surface.attached = { [weak self] window in VelaDisplay.manager = window?.avDisplayManager; _ = self }
        try setProps(props)
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
        if !ambient { VelaRemote.shared.attach(self) }
    }

    override var view: ExactNativeView { surface }

    override func destroy() {
        timer?.invalidate(); timer = nil
        backend?.stop(); backend = nil
        surface.reset()
        VelaRemote.shared.detach(self)
    }

    // MARK: Props

    override func setProps(_ props: [String: String]) throws {
        let auth = props["mediaAuth"] ?? ""
        if auth != mediaAuthJSON {
            mediaAuthJSON = auth
            mediaAuth = try auth.isEmpty ? nil : VelaMediaAuth(json: auth)
            activeKey = ""; revision = -1
        }
        let error = props["serverError"] ?? ""
        if error != serverError {
            serverError = error
            if !error.isEmpty { pendingSeek = nil; actionError = error; emitError(kind: "action", message: error, recoverable: true) }
        }
        let input = props["plan"] ?? ""
        if !input.isEmpty && input != planJSON { applyPlan(input) }
        if let json = props["playerCommand"], !json.isEmpty { command(json) }
    }

    private func applyPlan(_ json: String) {
        guard let value = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else { return }
        let session = value["sessionId"] as? String ?? ""
        let rev = value["revision"] as? Int ?? 0
        let source = value["sourceGeneration"] as? Int ?? 0, seek = value["seekGeneration"] as? Int ?? 0
        if session == sessionId && (rev <= revision || source < sourceGeneration || seek < seekGeneration) { return }
        planJSON = json; plan = value
        let newSession = session != sessionId
        let seekChanged = !newSession && seek != seekGeneration
        sessionId = session; revision = rev; sourceGeneration = source; seekGeneration = seek
        if newSession {
            audioClientOnly = false; subtitleClientOnly = false
            audioTrackId = value["selectedAudioTrackId"] as? String
            subtitleTrackId = value["selectedSubtitleTrackId"] as? String
        } else if !audioClientOnly {
            audioTrackId = value["selectedAudioTrackId"] as? String
        }
        if !subtitleClientOnly { subtitleTrackId = value["selectedSubtitleTrackId"] as? String }
        let paths = value["paths"] as? [[String: Any]] ?? []
        let selectedId = value["selectedPathId"] as? String ?? ""
        guard let path = paths.first(where: { $0["id"] as? String == selectedId }) else { return }
        let position = value["positionSeconds"] as? Double ?? Double(value["positionSeconds"] as? Int ?? 0)
        let key = "\(session):\(selectedId):\(source)"
        if key == activeKey, let backend {
            // Same source: a server-confirmed seek moves the clock unless this view already did.
            if seekChanged {
                if let target = pendingSeek, abs(target - position) < 1.5 { pendingSeek = nil }
                else { backend.seek(to: position); pendingSeek = nil }
            }
            applyTracks()
            return
        }
        guard (path["readiness"] as? String) == "ready", let urlText = path["url"] as? String, let url = resolve(urlText) else {
            // Preparing or on demand: the chrome shows loading until a ready path arrives.
            publish(); return
        }
        backend?.stop(); surface.reset()
        activeKey = key; activePathId = selectedId
        pendingSeek = nil
        externalCues = []
        let headers = mediaAuth?.headers(for: url) ?? [:]
        let originalPath = (path["original"] as? Bool ?? false) && (path["transport"] as? String) == "file"
        let tracks = value["audioTracks"] as? [[String: Any]] ?? []
        let selectedAudio = tracks.first(where: { $0["id"] as? String == audioTrackId })
        let subtitles = value["subtitleTracks"] as? [[String: Any]] ?? []
        let selectedSubtitle = subtitles.first(where: { $0["id"] as? String == subtitleTrackId })
        if originalPath {
            let byteLength = (path["byteLength"] as? NSNumber)?.int64Value
            let engine = VelaOriginalEngine(layer: surface.videoLayer, source: .init(
                url: url, headers: headers, byteLength: byteLength, start: position,
                audioStreamIndex: selectedAudio?["streamIndex"] as? Int,
                subtitleStreamIndex: (selectedSubtitle?["delivery"] as? [String: Any])?["kind"] as? String == "external" ? nil : selectedSubtitle?["streamIndex"] as? Int),
                displayCriteria: { [weak self] format, rate in self?.surface.prefer(format: format, frameRate: rate) })
            backend = engine
        } else {
            let origin = (path["timelineOriginSeconds"] as? NSNumber)?.doubleValue ?? 0
            backend = VelaHLSBackend(layer: surface.playerLayer, url: url, headers: headers, start: position, timelineOrigin: origin)
        }
        backend?.onChange = { [weak self] in self?.publish() }
        backend?.setVolume(volume, muted: muted)
        if let selectedSubtitle { loadExternal(selectedSubtitle) }
        publish()
    }

    /// Track choices the server confirmed in a newer plan of the same source.
    private func applyTracks() {
        guard let engine = original else { return }
        let tracks = plan["audioTracks"] as? [[String: Any]] ?? []
        if let index = tracks.first(where: { $0["id"] as? String == audioTrackId })?["streamIndex"] as? Int { engine.selectAudio(streamIndex: index) }
        let subtitles = plan["subtitleTracks"] as? [[String: Any]] ?? []
        let selected = subtitles.first(where: { $0["id"] as? String == subtitleTrackId })
        if let selected, (selected["delivery"] as? [String: Any])?["kind"] as? String != "external" { engine.selectSubtitle(streamIndex: selected["streamIndex"] as? Int) }
        else { engine.selectSubtitle(streamIndex: nil) }
    }

    private func resolve(_ text: String) -> URL? {
        if let url = URL(string: text), url.scheme != nil { return url }
        let base = mediaAuth?.origin ?? VelaServer.origin
        return URL(string: text, relativeTo: URL(string: base))?.absoluteURL
    }

    // MARK: Commands

    private func command(_ json: String) {
        guard let value = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any], let id = value["id"] as? Int, id > lastCommand else { return }
        lastCommand = id
        let type = value["type"] as? String ?? ""
        let raw = (value["value"] as? String).flatMap { $0.removingPercentEncoding } ?? ""
        actionError = nil
        switch type {
        case "play": backend?.play()
        case "pause": backend?.pause()
        case "seek": if let seconds = Double(raw) ?? (value["seconds"] as? Double) { requestSeek(seconds) }
        case "seekBy": if let delta = Double(raw) ?? (value["seconds"] as? Double) { requestSeek((pendingSeek ?? backend?.currentTime ?? 0) + delta) }
        case "volume": if let v = Float(raw) ?? (value["value"] as? Double).map(Float.init) { volume = max(0, min(1, v)); backend?.setVolume(volume, muted: muted) }
        case "mute": muted = raw.isEmpty ? !muted : raw == "true"; backend?.setVolume(volume, muted: muted)
        case "audio": selectAudio(raw.isEmpty ? (value["trackId"] as? String ?? "") : raw)
        case "subtitle": selectSubtitle(raw.isEmpty ? value["trackId"] as? String : raw)
        case "subtitleStyle": subtitleStyle.apply(raw); surface.style = subtitleStyle
        case "quality", "switchPath":
            let target = raw.hasPrefix("path:") ? String(raw.dropFirst(5)) : raw
            if !target.isEmpty && target != activePathId { sessionCommand(["kind": "switch", "pathId": target, "atSeconds": backend?.currentTime ?? 0]) }
        case "retry":
            activeKey = ""
            if !planJSON.isEmpty { let json = planJSON; planJSON = ""; revision -= 1; applyPlan(json) }
        default:
            actionError = "\(type) is not available on Apple TV"
            emitError(kind: "action", message: actionError!, recoverable: true)
        }
        publish()
    }

    private func requestSeek(_ seconds: Double) {
        let duration = backend?.readout.duration ?? .infinity
        let target = max(0, min(seconds, duration - 1))
        pendingSeek = target; pendingSeekAt = Date()
        // The clock moves now; the server records the seek and answers with its next generation.
        backend?.seek(to: target)
        sessionCommand(["kind": "seek", "positionSeconds": target])
    }

    private func selectAudio(_ id: String) {
        let tracks = plan["audioTracks"] as? [[String: Any]] ?? []
        guard let track = tracks.first(where: { $0["id"] as? String == id }) else { return }
        if let engine = original, let index = track["streamIndex"] as? Int, engine.streams.contains(where: { $0.index == index && $0.isAudio }) {
            audioTrackId = id; audioClientOnly = true
            engine.selectAudio(streamIndex: index)
        } else {
            sessionCommand(["kind": "tracks", "audioTrackId": id])
        }
    }

    private func selectSubtitle(_ id: String?) {
        let tracks = plan["subtitleTracks"] as? [[String: Any]] ?? []
        let track = id.flatMap { id in tracks.first(where: { $0["id"] as? String == id }) }
        if id != nil && track == nil { return }
        let delivery = (track?["delivery"] as? [String: Any])?["kind"] as? String
        if let engine = original, delivery != "burn-in" {
            subtitleTrackId = id; subtitleClientOnly = true
            externalCues = []
            if let track, delivery == "external" { engine.selectSubtitle(streamIndex: nil); loadExternal(track) }
            else { engine.selectSubtitle(streamIndex: track?["streamIndex"] as? Int) }
        } else if id == nil || delivery == "external" {
            subtitleTrackId = id; subtitleClientOnly = true
            externalCues = []
            if let track { loadExternal(track) }
        } else {
            var command: [String: Any] = ["kind": "tracks"]
            command["subtitleTrackId"] = id ?? NSNull()
            sessionCommand(command)
        }
    }

    /// A server-converted WebVTT track.
    private func loadExternal(_ track: [String: Any]) {
        guard let delivery = track["delivery"] as? [String: Any], delivery["kind"] as? String == "external",
              let text = delivery["url"] as? String ?? track["url"] as? String, let url = resolve(text) else { return }
        var request = URLRequest(url: url)
        for (name, value) in mediaAuth?.headers(for: url) ?? [:] { request.setValue(value, forHTTPHeaderField: name) }
        let wanted = track["id"] as? String
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            guard let data, let body = String(data: data, encoding: .utf8) else { return }
            let cues = VelaWebVTT.parse(body)
            DispatchQueue.main.async { if self?.subtitleTrackId == wanted { self?.externalCues = cues } }
        }.resume()
    }

    private func sessionCommand(_ fields: [String: Any]) {
        guard !sessionId.isEmpty else { return }
        var command = fields
        command["sourceGeneration"] = sourceGeneration
        command["seekGeneration"] = seekGeneration
        command["idempotencyKey"] = UUID().uuidString.lowercased()
        emit(["type": "session-command", "sessionId": sessionId, "command": command])
    }

    // MARK: Reports

    private func tick() {
        guard let backend else { return }
        let time = backend.currentTime
        let cue = externalCues.last(where: { $0.start <= time && time < $0.end }) ?? original?.cue(at: time)
        surface.show(cue, canvas: original?.subtitleCanvas ?? .zero)
        publish()
    }

    private func publish() {
        guard !sessionId.isEmpty else { return }
        let readout = backend?.readout ?? VelaReadout()
        let state: String = pendingSeek != nil && readout.state == .loading ? "buffering" : readout.state.rawValue
        let position = readout.position
        var snapshot: [String: Any] = [
            "sessionId": sessionId, "sourceGeneration": sourceGeneration, "seekGeneration": seekGeneration,
            "state": state, "sourceId": activePathId.isEmpty ? NSNull() : activePathId,
            "strategy": strategy() ?? NSNull(), "backend": (original != nil ? "file" : backend != nil ? "native-hls" : nil) as Any? ?? NSNull(),
            "renditionId": NSNull(), "qualityIds": [], "lockedQuality": NSNull(),
            "capabilities": ["pip": false, "fullscreen": false, "audioSwitch": true],
            "audioTracks": tracks("audioTracks"), "subtitleTracks": tracks("subtitleTracks"), "renditions": [],
            "currentBitrateBps": NSNull(), "requiredBandwidthBps": NSNull(),
            "bufferAheadSeconds": readout.bufferedEnd.map { max(0, $0 - position) } ?? NSNull(),
            "throughputHistory": readout.throughputBps.map { [$0] } ?? [],
            "speed": 1, "speeds": [1], "pendingSubtitleTrackId": NSNull(), "chapters": plan["chapters"] ?? [],
            "subtitleError": NSNull(), "subtitleStyleAvailable": true, "subtitleStyle": subtitleStyle.json,
            "subtitleClientOnly": subtitleClientOnly, "audioClientOnly": audioClientOnly,
            "diagnostics": ["implementation": "vela-native-tvos", "metadataDiscrepancies": [], "audioRoute": readout.audioRoute ?? ""],
            "live": NSNull(), "seekTarget": pendingSeek ?? NSNull(),
            "waiting": readout.state == .loading || readout.state == .buffering, "volume": volume, "muted": muted,
            "preparation": readout.preparation ?? NSNull(),
            "position": pendingSeek ?? position, "duration": readout.duration ?? NSNull(),
            "playable": readout.bufferedEnd.map { [["start": position, "end": max(position, $0)]] } ?? [],
            "throughputBps": readout.throughputBps ?? NSNull(), "droppedFrames": NSNull(), "totalFrames": NSNull(),
            "audioTrackIds": (plan["audioTracks"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String },
            "audioTrackId": audioTrackId ?? NSNull(), "pendingAudioTrackId": NSNull(), "subtitleTrackId": subtitleTrackId ?? NSNull(),
            "failure": readout.failure.map { ["kind": readout.failureKind, "message": $0, "recoverable": false] } ?? NSNull(),
        ]
        if let codec = readout.videoCodec, readout.width > 0 {
            snapshot["video"] = ["width": readout.width, "height": readout.height, "codec": codec, "dynamicRange": readout.dynamicRange ?? NSNull()]
        } else { snapshot["video"] = NSNull() }
        if pendingSeek != nil, Date().timeIntervalSince(pendingSeekAt) > 15 { pendingSeek = nil }
        if pendingSeek != nil, readout.state == .playing || readout.state == .paused { if abs(position - (pendingSeek ?? 0)) < 2 { /* landed */ } }
        emit(["type": "snapshot", "snapshot": snapshot])
        if let failure = readout.failure {
            let key = "\(sessionId):\(sourceGeneration):\(seekGeneration):\(failure)"
            if key != failureReported { failureReported = key; emitError(kind: readout.failureKind, message: failure, recoverable: false); observe(readout, force: true) }
        }
        observe(readout, force: false)
    }

    private func observe(_ readout: VelaReadout, force: Bool) {
        guard !activePathId.isEmpty, backend != nil else { return }
        let ended = readout.state == .ended
        let endedKey = "\(sessionId):\(sourceGeneration):\(seekGeneration)"
        if ended && endedReported == endedKey { return }
        guard force || ended || Date().timeIntervalSince(lastObservation) >= 1 else { return }
        if readout.state == .loading && !force { return }
        lastObservation = Date()
        if ended { endedReported = endedKey }
        sequence += 1
        let state: String = readout.state == .playing ? "playing" : ended ? "ended" : readout.state == .paused ? "paused" : "buffering"
        var observation: [String: Any] = [
            "idempotencyKey": "\(sessionId):\(sourceGeneration):\(seekGeneration):\(sequence)",
            "sourceGeneration": sourceGeneration, "seekGeneration": seekGeneration, "sequence": sequence,
            "observedAt": ISO8601DateFormatter().string(from: Date()), "positionSeconds": readout.position, "state": state,
            "playableRanges": readout.bufferedEnd.map { [["startSeconds": readout.position, "endSeconds": max(readout.position, $0)]] } ?? [],
            "selectedPathId": activePathId,
        ]
        if let throughput = readout.throughputBps { observation["throughputBps"] = throughput }
        if let bytes = readout.transferredBytes { observation["transferredBytes"] = bytes }
        if !audioClientOnly, let audioTrackId { observation["audioTrackId"] = audioTrackId }
        if !subtitleClientOnly { observation["subtitleTrackId"] = subtitleTrackId ?? NSNull() }
        if let failure = readout.failure { observation["error"] = ["class": readout.failureKind == "decoder" ? "decoder" : readout.failureKind == "network" ? "transient" : "source", "message": failure] }
        emit(["type": "observation", "sessionId": sessionId, "observation": observation])
    }

    private func strategy() -> String? {
        let paths = plan["paths"] as? [[String: Any]] ?? []
        return paths.first(where: { $0["id"] as? String == activePathId })?["kind"] as? String
    }

    private func tracks(_ key: String) -> [[String: Any]] {
        (plan[key] as? [[String: Any]] ?? []).map { t in
            var out: [String: Any] = ["id": t["id"] ?? "", "label": t["name"] ?? ""]
            for name in ["language", "codec", "channels", "streamIndex", "forced", "hearingImpaired", "delivery"] { if let v = t[name] { out[name] = v } }
            return out
        }
    }

    private func emitError(kind: String, message: String, recoverable: Bool) {
        emit(["type": "error", "failure": ["kind": kind, "message": message, "recoverable": recoverable], "sessionId": sessionId, "sourceGeneration": sourceGeneration, "seekGeneration": seekGeneration])
    }

    private func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        events.message(String(decoding: data, as: UTF8.self))
    }

    // MARK: Remote

    func remote(_ action: VelaRemote.Action) {
        switch action {
        case .toggle: if backend?.readout.state == .playing { backend?.pause() } else { backend?.play() }
        case .play: backend?.play()
        case .pause: backend?.pause()
        case .skip(let seconds): requestSeek((pendingSeek ?? backend?.currentTime ?? 0) + seconds)
        }
        publish()
    }
}

// MARK: - Media authorization (a native server's scoped headers)

struct VelaMediaAuth {
    let origin: String
    let pathPrefix: String
    let fields: [String: String]
    private static let allowed = try! NSRegularExpression(pattern: "^(accept|authorization|x-plex-token|x-emby-token|x-emby-authorization|x-plex-product|x-plex-version|x-plex-client-identifier|x-plex-platform|x-plex-device-name)$", options: .caseInsensitive)

    init(json: String) throws {
        guard let value = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
              let origin = value["origin"] as? String, let prefix = value["pathPrefix"] as? String, prefix.hasPrefix("/"),
              let headers = value["headers"] as? [String: String], !headers.isEmpty, headers.count <= 8,
              headers.keys.allSatisfy({ VelaMediaAuth.allowed.firstMatch(in: $0, range: NSRange($0.startIndex..., in: $0)) != nil }) else {
            throw ExactNativeRefusal("Invalid media authorization")
        }
        self.origin = origin; pathPrefix = prefix; fields = headers
    }

    /// Headers only for the authorized origin and path (client/player/media-auth.ts `inside`).
    func headers(for url: URL) -> [String: String] {
        guard let scheme = url.scheme, let host = url.host else { return [:] }
        let port = url.port.map { ":\($0)" } ?? ""
        guard "\(scheme)://\(host)\(port)" == origin else { return [:] }
        let path = url.path
        let inside = pathPrefix == "/" || path == pathPrefix || path.hasPrefix(pathPrefix.hasSuffix("/") ? pathPrefix : pathPrefix + "/")
        return inside ? fields : [:]
    }
}

// MARK: - The surface: video layers and the subtitle overlay

final class VelaSurface: UIView {
    let videoLayer = AVSampleBufferDisplayLayer()
    let playerLayer = AVPlayerLayer()
    private let text = UILabel()
    private let backdrop = UIView()
    private var bitmaps: [UIImageView] = []
    private var shown = ""
    var attached: ((UIWindow?) -> Void)?
    var style = VelaSubtitleStyle() { didSet { shown = ""; } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isUserInteractionEnabled = false
        videoLayer.videoGravity = .resizeAspect
        playerLayer.videoGravity = .resizeAspect
        layer.addSublayer(videoLayer)
        layer.addSublayer(playerLayer)
        backdrop.layer.cornerRadius = 8
        addSubview(backdrop)
        text.numberOfLines = 0
        text.textAlignment = .center
        addSubview(text)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func didMoveToWindow() { super.didMoveToWindow(); attached?(window) }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        videoLayer.frame = bounds; playerLayer.frame = bounds
        CATransaction.commit()
        shown = ""
    }

    func reset() {
        videoLayer.sampleBufferRenderer.flush(removingDisplayedImage: true) { }
        playerLayer.player = nil
        show(nil, canvas: .zero)
    }

    /// Dynamic range and frame rate for the display (Settings › Video and Audio › Match Content).
    func prefer(format: CMFormatDescription?, frameRate: Double) {
        guard let manager = window?.avDisplayManager ?? VelaDisplay.manager else { return }
        VelaDisplay.manager = manager
        guard manager.isDisplayCriteriaMatchingEnabled else { return }
        if let format { manager.preferredDisplayCriteria = AVDisplayCriteria(refreshRate: Float(frameRate > 0 ? frameRate : 24), formatDescription: format) }
        else { manager.preferredDisplayCriteria = nil }
    }

    func show(_ cue: VelaCue?, canvas: CGSize) {
        let key: String
        switch cue?.content {
        case .text(let value)?: key = "t:\(value)"
        case .bitmaps(let list, _)?: key = "b:\(cue!.start):\(list.count)"
        case nil: key = ""
        }
        if key == shown { return }
        shown = key
        text.isHidden = true; backdrop.isHidden = true
        bitmaps.forEach { $0.removeFromSuperview() }; bitmaps = []
        guard let cue else { return }
        switch cue.content {
        case .text(let value):
            let size = bounds.height * style.scale
            let shadow = NSShadow(); shadow.shadowColor = UIColor.black; shadow.shadowBlurRadius = style.background == "shadow" ? 6 : 0; shadow.shadowOffset = .zero
            text.attributedText = NSAttributedString(string: value, attributes: [
                .font: UIFont.systemFont(ofSize: size, weight: .semibold),
                .foregroundColor: style.color == "yellow" ? UIColor.systemYellow : UIColor.white, .shadow: shadow,
            ])
            let width = bounds.width * 0.8
            let fit = text.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
            let bottom = bounds.height * (style.raised ? 0.82 : 0.92)
            text.frame = CGRect(x: (bounds.width - fit.width) / 2, y: bottom - fit.height, width: fit.width, height: fit.height)
            text.isHidden = false
            if style.background == "box" {
                backdrop.backgroundColor = UIColor.black.withAlphaComponent(0.7)
                backdrop.frame = text.frame.insetBy(dx: -16, dy: -8); backdrop.isHidden = false
            }
        case .bitmaps(let list, let size):
            let canvasSize = size.width > 0 ? size : canvas.width > 0 ? canvas : CGSize(width: 1920, height: 1080)
            let area = bounds
            let scale = min(area.width / canvasSize.width, area.height / canvasSize.height)
            let origin = CGPoint(x: (area.width - canvasSize.width * scale) / 2, y: (area.height - canvasSize.height * scale) / 2)
            for (image, rect) in list {
                let view = UIImageView(image: UIImage(cgImage: image))
                view.frame = CGRect(x: origin.x + rect.minX * scale, y: origin.y + rect.minY * scale, width: rect.width * scale, height: rect.height * scale)
                addSubview(view); bitmaps.append(view)
            }
        }
    }
}

struct VelaSubtitleStyle {
    var size = "medium", background = "shadow", color = "white", position = "bottom"
    var scale: CGFloat { ["small": 0.04, "medium": 0.05, "large": 0.062, "xl": 0.075][size] ?? 0.05 }
    var raised: Bool { position == "raised" }
    var json: [String: Any] { ["subtitleSize": size, "subtitleBackground": background, "subtitleColor": color, "subtitlePosition": position, "offsetSeconds": 0] }
    mutating func apply(_ raw: String) {
        if let value = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] {
            size = value["subtitleSize"] as? String ?? size; background = value["subtitleBackground"] as? String ?? background
            color = value["subtitleColor"] as? String ?? color; position = value["subtitlePosition"] as? String ?? position
        } else if let pair = raw.split(separator: ":", maxSplits: 1).map(String.init) as [String]?, pair.count == 2 {
            switch pair[0] { case "subtitleSize": size = pair[1]; case "subtitleBackground": background = pair[1]; case "subtitleColor": color = pair[1]; case "subtitlePosition": position = pair[1]; default: break }
        }
    }
}

enum VelaWebVTT {
    static func parse(_ body: String) -> [VelaCue] {
        var cues: [VelaCue] = []
        for block in body.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n") {
            let lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            guard let at = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
            let parts = lines[at].components(separatedBy: "-->")
            guard parts.count == 2, let start = seconds(parts[0]), let end = seconds(parts[1].split(separator: " ").first.map(String.init) ?? "") else { continue }
            let text = VelaSubtitleText.plain(lines[(at + 1)...].joined(separator: "\n"), ass: false)
            if !text.isEmpty { cues.append(VelaCue(start: start, end: end, content: .text(text))) }
        }
        return cues
    }
    private static func seconds(_ text: String) -> Double? {
        let parts = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".").split(separator: ":").compactMap { Double($0) }
        guard !parts.isEmpty else { return nil }
        return parts.reduce(0) { $0 * 60 + $1 }
    }
}

// MARK: - AVPlayer for the server's HLS (remux or conversion)

final class VelaHLSBackend: VelaBackend {
    var onChange: (() -> Void)?
    private let player = AVPlayer()
    private let origin: Double
    private var observers: [NSKeyValueObservation] = []
    private var wantsPlay = true
    private var failure: String?

    init(layer: AVPlayerLayer, url: URL, headers: [String: String], start: Double, timelineOrigin: Double) {
        origin = timelineOrigin
        let asset = AVURLAsset(url: url, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = 30
        player.appliesMediaSelectionCriteriaAutomatically = false
        player.replaceCurrentItem(with: item)
        layer.player = player
        if start - origin > 0.5 { item.seek(to: CMTime(seconds: start - origin, preferredTimescale: 600), completionHandler: nil) }
        observers.append(item.observe(\.status) { [weak self] item, _ in
            if item.status == .failed { self?.failure = item.error?.localizedDescription ?? "The stream could not be played" }
            DispatchQueue.main.async { self?.onChange?() }
        })
        observers.append(player.observe(\.timeControlStatus) { [weak self] _, _ in DispatchQueue.main.async { self?.onChange?() } })
        player.play()
    }

    var currentTime: Double { origin + max(0, CMTimeGetSeconds(player.currentTime())) }

    var readout: VelaReadout {
        var r = VelaReadout()
        let item = player.currentItem
        r.position = currentTime
        if let d = item?.duration, d.isNumeric { r.duration = origin + CMTimeGetSeconds(d) }
        if let range = item?.loadedTimeRanges.first?.timeRangeValue { r.bufferedEnd = origin + CMTimeGetSeconds(CMTimeRangeGetEnd(range)) }
        if let event = item?.accessLog()?.events.last { r.throughputBps = event.observedBitrate > 0 ? event.observedBitrate : nil; r.transferredBytes = event.numberOfBytesTransferred }
        if let track = item?.tracks.first(where: { $0.assetTrack?.mediaType == .video })?.assetTrack {
            r.width = Int(track.naturalSize.width); r.height = Int(track.naturalSize.height)
            r.videoCodec = "hls"
        }
        if let failure { r.state = .failed; r.failure = failure; return r }
        switch player.timeControlStatus {
        case .playing: r.state = .playing; r.preparation = nil
        case .paused: r.state = item?.status == .readyToPlay ? (item.map { CMTimeCompare($0.currentTime(), $0.duration) >= 0 } == true ? .ended : .paused) : .loading; r.preparation = r.state == .loading ? "initial-buffer" : nil
        case .waitingToPlayAtSpecifiedRate: r.state = item?.status == .readyToPlay ? .buffering : .loading
        @unknown default: r.state = .loading
        }
        return r
    }

    func play() { wantsPlay = true; player.play() }
    func pause() { wantsPlay = false; player.pause() }
    func seek(to seconds: Double) { player.seek(to: CMTime(seconds: max(0, seconds - origin), preferredTimescale: 600)) }
    func setVolume(_ volume: Float, muted: Bool) { player.volume = volume; player.isMuted = muted }
    func stop() { observers.removeAll(); player.pause(); player.replaceCurrentItem(with: nil) }
}

// MARK: - The audio session and the remote's media buttons

enum VelaAudioSession {
    static func activate() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        try? session.setSupportsMultichannelContent(true)
        try? session.setActive(true)
        // Up to 7.1 PCM when the output takes it (HDMI to a receiver); else tvOS downmixes.
        try? session.setPreferredOutputNumberOfChannels(min(8, session.maximumOutputNumberOfChannels))
    }
}

final class VelaRemote {
    enum Action { case toggle, play, pause, skip(Double) }
    static let shared = VelaRemote()
    private weak var player: VelaPlayerView?
    private var targets: [(MPRemoteCommand, Any)] = []

    func attach(_ view: VelaPlayerView) {
        player = view
        guard targets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()
        let add = { (command: MPRemoteCommand, action: Action) in
            command.isEnabled = true
            self.targets.append((command, command.addTarget { [weak self] _ in
                guard let player = self?.player else { return .noActionableNowPlayingItem }
                player.remote(action); return .success
            }))
        }
        add(center.togglePlayPauseCommand, .toggle)
        add(center.playCommand, .play)
        add(center.pauseCommand, .pause)
        center.skipForwardCommand.preferredIntervals = [10]; center.skipBackwardCommand.preferredIntervals = [10]
        add(center.skipForwardCommand, .skip(10))
        add(center.skipBackwardCommand, .skip(-10))
    }

    func detach(_ view: VelaPlayerView) {
        guard player === view else { return }
        player = nil
        for (command, target) in targets { command.removeTarget(target) }
        targets = []
    }
}

// MARK: - vela-preview: a muted, looping card trailer

final class VelaPreviewView: ExactNativeInstance {
    private let surface = VelaPreviewSurface()
    private var props: [String: String] = [:]
    private var url = ""
    private var looper: AVPlayerLooper?
    private let player = AVQueuePlayer()
    private var observation: NSKeyValueObservation?

    init(_ props: [String: String], _ events: ExactNativeEvents) {
        super.init(events: events)
        player.isMuted = true
        surface.playerLayer.player = player
        surface.playerLayer.videoGravity = .resizeAspectFill
        surface.alpha = 0
        observation = player.observe(\.timeControlStatus) { [weak self] player, _ in
            guard player.timeControlStatus == .playing else { return }
            DispatchQueue.main.async { self?.surface.alpha = 1; self?.events.message("playing") }
        }
        try? setProps(props)
    }
    override var view: ExactNativeView { surface }

    override func setProps(_ props: [String: String]) throws {
        self.props = props
        let expires = Double(props["expiresAt"] ?? "") ?? 0
        let allowed = props["active"] == "true" && props["still"] != "true" && expires > Date().timeIntervalSince1970 * 1000
        guard allowed, let text = props["url"], !text.isEmpty else { stopPreview(); return }
        guard text != url else { return }
        url = text
        let resolved = URL(string: text).flatMap { $0.scheme != nil ? $0 : nil } ?? URL(string: text, relativeTo: URL(string: VelaServer.origin))?.absoluteURL
        guard let resolved else { events.message("refused"); return }
        let headers = (try? VelaMediaAuth(json: props["mediaAuth"] ?? ""))?.headers(for: resolved) ?? [:]
        let item = AVPlayerItem(asset: AVURLAsset(url: resolved, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers]))
        looper = AVPlayerLooper(player: player, templateItem: item)
        player.play()
        events.message("ready")
    }

    private func stopPreview() {
        guard !url.isEmpty else { return }
        url = ""; looper = nil
        player.pause(); player.removeAllItems()
        surface.alpha = 0
        events.message("paused")
    }

    override func destroy() { observation = nil; looper = nil; player.pause(); player.removeAllItems() }
}

final class VelaPreviewSurface: UIView {
    let playerLayer = AVPlayerLayer()
    override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false; layer.addSublayer(playerLayer) }
    required init?(coder: NSCoder) { fatalError() }
    override func layoutSubviews() { super.layoutSubviews(); playerLayer.frame = bounds }
}
