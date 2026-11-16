// vela-player on tvOS: the web view's props and messages (client/player/web-module.ts, model.ts,
// protocol.ts) over a native backend.
//   - An original the server offers by byte range plays in VelaOriginalEngine: nothing is converted.
//   - Anything else (the server's remux or conversion HLS) plays in AVPlayer (VelaHLSBackend).
// Seeks and path switches go to the server as session commands, as the web engine sends them.
// A track the original carries (audio or subtitles) switches here, client-side.
import AVKit
import Foundation
import UIKit

final class VelaPlayerView: ExactNativeInstance {
    private let surface = VelaSurface()
    private let report: VelaPlayerReport
    private let ambient: Bool
    private var backend: VelaBackend?
    private var timer: Timer?

    // The server's plan, and what of it this view applies.
    private var planJSON = ""
    private var plan: VelaPlan?
    private var activeSource = ""
    private var mediaAuth: VelaMediaAuth?
    private var mediaAuthJSON = ""
    private var serverError = ""
    private var lastCommand = -1

    // The viewer's choices and the view's own state.
    private var pendingSeek: Double?
    private var pendingSeekAt = Date.distantPast
    private var volume: Float = 1
    private var muted = false
    private var externalCues: [VelaCue] = []

    private var original: VelaOriginalEngine? {
        backend as? VelaOriginalEngine
    }

    init(_ module: Vela, _ props: [String: String], _ events: ExactNativeEvents) throws {
        ambient = props["ambient"] == "true"
        report = VelaPlayerReport(events: events)
        super.init(events: events)
        if !ambient {
            VelaAudioSession.activate()
            VelaRemote.shared.attach(self)
        }
        try setProps(props)
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    override var view: ExactNativeView {
        surface
    }

    override func destroy() {
        timer?.invalidate()
        timer = nil
        backend?.stop()
        backend = nil
        surface.reset()
        VelaRemote.shared.detach(self)
    }

    // MARK: Props

    override func setProps(_ props: [String: String]) throws {
        let authorization = props["mediaAuth"] ?? ""
        if authorization != mediaAuthJSON {
            mediaAuthJSON = authorization
            mediaAuth = authorization.isEmpty ? nil : try VelaMediaAuth(json: authorization)
            activeSource = ""
        }
        let error = props["serverError"] ?? ""
        if error != serverError {
            serverError = error
            if !error.isEmpty {
                pendingSeek = nil
                report.actionFailed(error)
            }
        }
        if let json = props["plan"], !json.isEmpty, json != planJSON, let next = VelaPlan.decode(json) {
            planJSON = json
            apply(next)
        }
        if let json = props["playerCommand"], !json.isEmpty {
            command(json)
        }
    }

    private func apply(_ next: VelaPlan) {
        let previous = plan
        if let previous, previous.sessionId == next.sessionId {
            let stale = next.revision <= previous.revision
                || next.sourceGeneration < previous.sourceGeneration
                || next.seekGeneration < previous.seekGeneration
            if stale {
                return
            }
        }
        plan = next
        report.adopt(next, newSession: previous?.sessionId != next.sessionId)
        guard let path = next.selectedPath else {
            return
        }
        let source = "\(next.sessionId):\(path.id):\(next.sourceGeneration)"
        if source == activeSource, let backend {
            // The same source: a server-confirmed seek moves the clock, unless this view already has.
            if let previous, next.seekGeneration != previous.seekGeneration {
                if let target = pendingSeek, abs(target - next.positionSeconds) < 1.5 {
                    pendingSeek = nil
                } else {
                    backend.seek(to: next.positionSeconds)
                    pendingSeek = nil
                }
            }
            applyServerTracks(next)
            return
        }
        guard path.readiness == "ready", let text = path.url, let url = resolve(text) else {
            // Preparing or on demand: the chrome shows loading until a ready path arrives.
            publish()
            return
        }
        start(next, path: path, url: url, source: source)
    }

    private func start(_ plan: VelaPlan, path: VelaPlanPath, url: URL, source: String) {
        backend?.stop()
        surface.reset()
        activeSource = source
        pendingSeek = nil
        externalCues = []
        report.pathId = path.id
        let headers = mediaAuth?.headers(for: url) ?? [:]
        if path.isOriginalFile {
            let subtitle = plan.subtitleTrack(report.subtitleTrackId)
            let source = VelaOriginalEngine.Source(
                url: url,
                headers: headers,
                byteLength: path.byteLength,
                start: plan.positionSeconds,
                audioStreamIndex: plan.audioTrack(report.audioTrackId)?.streamIndex,
                subtitleStreamIndex: subtitle?.isExternal == true ? nil : subtitle?.streamIndex
            )
            let surface = self.surface
            backend = VelaOriginalEngine(layer: surface.videoLayer, source: source) { format, rate in
                surface.preferDisplay(format: format, frameRate: rate)
            }
        } else {
            backend = VelaHLSBackend(
                layer: surface.playerLayer,
                url: url,
                headers: headers,
                start: plan.positionSeconds,
                timelineOrigin: path.timelineOriginSeconds ?? 0
            )
        }
        backend?.onChange = { [weak self] in
            self?.publish()
        }
        backend?.setVolume(volume, muted: muted)
        if let track = plan.subtitleTrack(report.subtitleTrackId), track.isExternal {
            loadExternal(track)
        }
        publish()
    }

    /// Track choices the server confirmed in a newer plan of the same source.
    private func applyServerTracks(_ plan: VelaPlan) {
        guard let engine = original else {
            return
        }
        if let index = plan.audioTrack(report.audioTrackId)?.streamIndex {
            engine.selectAudio(streamIndex: index)
        }
        let subtitle = plan.subtitleTrack(report.subtitleTrackId)
        engine.selectSubtitle(streamIndex: subtitle?.isExternal == false ? subtitle?.streamIndex : nil)
    }

    private func resolve(_ text: String) -> URL? {
        if let url = URL(string: text), url.scheme != nil {
            return url
        }
        let base = mediaAuth?.origin ?? VelaServer.origin
        return URL(string: text, relativeTo: URL(string: base))?.absoluteURL
    }

    // MARK: Commands

    private func command(_ json: String) {
        guard
            let value = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
            let id = value["id"] as? Int,
            id > lastCommand
        else {
            return
        }
        lastCommand = id
        let type = value["type"] as? String ?? ""
        let argument = (value["value"] as? String)?.removingPercentEncoding ?? ""
        switch type {
        case "play":
            backend?.play()
        case "pause":
            backend?.pause()
        case "seek":
            if let seconds = Double(argument) {
                requestSeek(seconds)
            }
        case "seekBy":
            if let delta = Double(argument) {
                requestSeek((pendingSeek ?? backend?.currentTime ?? 0) + delta)
            }
        case "volume":
            if let level = Float(argument) {
                volume = max(0, min(1, level))
                backend?.setVolume(volume, muted: muted)
            }
        case "mute":
            muted = argument.isEmpty ? !muted : argument == "true"
            backend?.setVolume(volume, muted: muted)
        case "audio":
            selectAudio(argument)
        case "subtitle":
            selectSubtitle(argument.isEmpty ? nil : argument)
        case "subtitleStyle":
            report.subtitleStyle.apply(argument)
            surface.subtitleStyle = report.subtitleStyle
        case "quality", "switchPath":
            switchPath(argument.hasPrefix("path:") ? String(argument.dropFirst(5)) : argument)
        case "retry":
            retry()
        default:
            report.actionFailed("\(type) is not available on Apple TV")
        }
        publish()
    }

    private func requestSeek(_ seconds: Double) {
        let duration = backend?.readout.duration ?? .infinity
        let target = max(0, min(seconds, duration - 1))
        pendingSeek = target
        pendingSeekAt = Date()
        // The clock moves now; the server records the seek and answers with its next generation.
        backend?.seek(to: target)
        report.sessionCommand(["kind": "seek", "positionSeconds": target])
    }

    private func switchPath(_ pathId: String) {
        guard !pathId.isEmpty, pathId != report.pathId else {
            return
        }
        report.sessionCommand(["kind": "switch", "pathId": pathId, "atSeconds": backend?.currentTime ?? 0])
    }

    private func retry() {
        activeSource = ""
        if let plan {
            self.plan = nil
            apply(plan)
        }
    }

    private func selectAudio(_ id: String) {
        guard let track = plan?.audioTrack(id) else {
            return
        }
        let carried = original?.streams.contains { $0.index == track.streamIndex && $0.isAudio } == true
        if let engine = original, let index = track.streamIndex, carried {
            report.audioTrackId = id
            report.audioClientOnly = true
            engine.selectAudio(streamIndex: index)
        } else {
            report.sessionCommand(["kind": "tracks", "audioTrackId": id])
        }
    }

    private func selectSubtitle(_ id: String?) {
        let track = plan?.subtitleTrack(id)
        if id != nil && track == nil {
            return
        }
        let burnedIn = track?.delivery?.kind == "burn-in"
        guard original != nil || track == nil || track?.isExternal == true, !burnedIn else {
            report.sessionCommand(["kind": "tracks", "subtitleTrackId": id as Any? ?? NSNull()])
            return
        }
        report.subtitleTrackId = id
        report.subtitleClientOnly = true
        externalCues = []
        if let track, track.isExternal {
            original?.selectSubtitle(streamIndex: nil)
            loadExternal(track)
        } else {
            original?.selectSubtitle(streamIndex: track?.streamIndex)
        }
    }

    /// A server-converted WebVTT track.
    private func loadExternal(_ track: VelaPlanTrack) {
        guard let text = track.externalURL, let url = resolve(text) else {
            return
        }
        var request = URLRequest(url: url)
        for (name, value) in mediaAuth?.headers(for: url) ?? [:] {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let wanted = track.id
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            guard let data, let body = String(data: data, encoding: .utf8) else {
                return
            }
            let cues = VelaWebVTT.parse(body)
            DispatchQueue.main.async {
                if self?.report.subtitleTrackId == wanted {
                    self?.externalCues = cues
                }
            }
        }.resume()
    }

    // MARK: Reports

    private func tick() {
        guard let backend else {
            return
        }
        let time = backend.currentTime
        let external = externalCues.last { $0.start <= time && time < $0.end }
        surface.show(external ?? original?.cue(at: time))
        publish()
    }

    private func publish() {
        if pendingSeek != nil, Date().timeIntervalSince(pendingSeekAt) > 15 {
            pendingSeek = nil
        }
        let readout = backend?.readout ?? VelaReadout()
        let kind = original != nil ? "file" : backend != nil ? "native-hls" : nil
        report.publish(readout, backend: kind, seekTarget: pendingSeek, volume: volume, muted: muted)
    }

    // MARK: Remote

    func remote(_ action: VelaRemote.Action) {
        switch action {
        case .toggle:
            if backend?.readout.state == .playing {
                backend?.pause()
            } else {
                backend?.play()
            }
        case .play:
            backend?.play()
        case .pause:
            backend?.pause()
        case .skip(let seconds):
            requestSeek((pendingSeek ?? backend?.currentTime ?? 0) + seconds)
        }
        publish()
    }
}
