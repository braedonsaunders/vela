// VelaPlayerView: libmpv drawing into a CAMetalLayer, driven by the contract's props.
//   - `plan`: the server's plan; the selected ready path plays (an original file or the server's HLS).
//     A newer plan of the same source moves the clock only when its seek generation changed.
//   - `command`: { id, type, ... } (client/player/model.ts Command); each id is consumed once.
// Before an original's first frame, the display is asked for its dynamic range and frame rate.
import ExpoModulesCore
import Libmpv
import UIKit

final class VelaPlayerView: ExpoView {
    let onSnapshot = EventDispatcher()
    let onError = EventDispatcher()
    let onObservation = EventDispatcher()
    let onCommand = EventDispatcher()

    private let metalLayer = PlayerMetalLayer()
    private var mpv: MPVClient?
    private var state = PlayerState()
    private lazy var report = PlayerReport(
        snapshot: { [weak self] in self?.onSnapshot($0) },
        observation: { [weak self] in self?.onObservation($0) },
        error: { [weak self] in self?.onError($0) }
    )

    private var plan: VelaPlan?
    private var activeSource = ""
    private var lastCommand = -1
    private var pendingSeek: Double?
    private var wantsPlay = true
    private var ambient = false
    private var displayFacts: VideoFacts?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .black
        clipsToBounds = true
        metalLayer.contentsScale = UIScreen.main.nativeScale
        metalLayer.framebufferOnly = true
        metalLayer.backgroundColor = UIColor.black.cgColor
        layer.addSublayer(metalLayer)
    }

    deinit {
        stop()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        metalLayer.frame = bounds
        CATransaction.commit()
    }

    // MARK: Props

    func setAmbient(_ value: Bool) {
        ambient = value
    }

    func setPlan(_ object: [String: Any]?) {
        guard let object, let next = VelaPlan.decode(object) else {
            return
        }
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
        if source == activeSource {
            if let previous, next.seekGeneration != previous.seekGeneration {
                seekConfirmed(next.positionSeconds)
            }
            applyTracks()
            return
        }
        guard path.readiness == "ready", let text = path.url, let url = resolve(text) else {
            // Preparing or on demand: the chrome shows loading until a ready path arrives.
            report.publish(state, seekTarget: pendingSeek, force: true)
            return
        }
        start(next, path: path, url: url, source: source)
    }

    func setServerError(_ failure: [String: Any]?) {
        guard let message = failure?["message"] as? String else {
            return
        }
        state.failure = message
        state.failureKind = failure?["kind"] as? String ?? "source"
        mpv?.set("pause", flag: true)
        report.publish(state, seekTarget: nil, force: true)
    }

    func setCommand(_ command: [String: Any]?) {
        guard let command, let id = command["id"] as? Int, id > lastCommand else {
            return
        }
        lastCommand = id
        let failure = perform(command)
        var result: [String: Any] = ["id": id, "ok": failure == nil]
        if let failure {
            result["failure"] = ["kind": "action", "message": failure, "recoverable": true]
        }
        onCommand(result)
        report.publish(state, seekTarget: pendingSeek, force: true)
    }

    // MARK: Playback

    private func start(_ plan: VelaPlan, path: VelaPlanPath, url: URL, source: String) {
        stop()
        activeSource = source
        state = PlayerState()
        pendingSeek = nil
        report.pathId = path.id
        report.backend = path.isOriginalFile ? "mpv-original" : "mpv-hls"
        if !ambient {
            PlaybackAudioSession.activate()
        }
        let client: MPVClient
        do {
            client = try MPVClient(layer: metalLayer, options: [
                "target-colorspace-hint": "yes",
                "pause": "yes",
                "mute": ambient ? "yes" : "no",
                "audio-channels": PlaybackAudioSession.outputChannels > 2 ? "auto-safe" : "stereo",
            ])
        } catch {
            state.failure = "\(error)"
            state.failureKind = "decoder"
            report.publish(state, seekTarget: nil, force: true)
            return
        }
        mpv = client
        client.onProperty = { [weak self] name, value in
            self?.propertyChanged(name, value)
        }
        client.onEvent = { [weak self] event in
            self?.event(event)
        }
        for property in PlayerState.observed {
            client.observe(property.name, format: property.format)
        }
        setHeaders(for: url, on: client)
        let subtitle = plan.subtitleTrack(report.subtitleTrackId)
        var options = ["start=\(plan.positionSeconds)"]
        if path.isOriginalFile {
            // Source stream indexes are FFmpeg's; mpv selects by its own ids, mapped once loaded (applyTracks).
            options.append(subtitle == nil || subtitle?.isExternal == true ? "sid=no" : "sid=auto")
        }
        displayFacts = path.isOriginalFile ? DisplayMatching.facts(path.originalVideo) : nil
        // The display switches before the first frame; mpv loads meanwhile, paused.
        if !ambient {
            DisplayMatching.prefer(displayFacts, in: window)
        }
        client.command(["loadfile", url.absoluteString, "replace", "-1", options.joined(separator: ",")])
        report.publish(state, seekTarget: nil, force: true)
    }

    /// Headers only for a URL inside the media access's origin and path (none for Ether's broker URLs).
    private func setHeaders(for url: URL, on client: MPVClient) {
        let fields = VelaMediaAccessStore.headers(for: url).map { "\($0.key): \($0.value)" }
        client.setStringList("http-header-fields", fields)
    }

    private func stop() {
        guard let client = mpv else {
            return
        }
        mpv = nil
        client.destroy()
        if !ambient {
            DisplayMatching.prefer(nil, in: window)
        }
    }

    private func resolve(_ text: String) -> URL? {
        if let url = URL(string: text), url.scheme != nil {
            return url
        }
        guard let origin = VelaMediaAccessStore.origin else {
            return nil
        }
        return URL(string: text, relativeTo: URL(string: origin))?.absoluteURL
    }

    // MARK: mpv

    private func propertyChanged(_ name: String, _ value: Any?) {
        state.update(name, value)
        if name == "track-list" {
            applyTracks()
        }
        if name == "video-params", displayFacts == nil, !ambient {
            // A path without verified facts (the server's HLS) matches once the video is decoded.
            displayFacts = DisplayMatching.facts(videoParams: state.videoParams, frameRate: state.frameRate, codec: state.videoCodec)
            DisplayMatching.prefer(displayFacts, in: window)
        }
        if name == "time-pos", let target = pendingSeek, abs(state.position - target) < 2, !state.seeking {
            pendingSeek = nil
        }
        report.publish(state, seekTarget: pendingSeek)
    }

    private func event(_ event: MPVClient.Event) {
        switch event {
        case .fileLoaded:
            state.loaded = true
            applyTracks()
            resumeAfterDisplaySwitch()
        case .endFile(let reason, let error):
            // MPV_END_FILE_REASON_ERROR
            if reason == 4 {
                state.failure = "The media could not be played (\(String(cString: mpv_error_string(error))))"
                state.failureKind = error == MPV_ERROR_LOADING_FAILED.rawValue ? "network" : "source"
            }
        case .seekDone:
            pendingSeek = nil
        case .shutdown:
            break
        }
        report.publish(state, seekTarget: pendingSeek, force: true)
    }

    /// Unpauses once the display has finished switching modes (it blanks meanwhile).
    private func resumeAfterDisplaySwitch(waited: Double = 0) {
        if DisplayMatching.switching(in: window) && waited < 6 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                self?.resumeAfterDisplaySwitch(waited: waited + 0.1)
            }
            return
        }
        mpv?.set("pause", flag: !wantsPlay)
    }

    /// Selects the plan's chosen audio and subtitle streams by their source stream index.
    private func applyTracks() {
        guard let plan, let path = plan.selectedPath, path.isOriginalFile, !state.tracks.isEmpty else {
            return
        }
        if let index = plan.audioTrack(report.audioTrackId)?.streamIndex, let id = state.trackId(type: "audio", streamIndex: index) {
            if state.audioId != id {
                mpv?.set("aid", String(id))
            }
        }
        let subtitle = plan.subtitleTrack(report.subtitleTrackId)
        if let subtitle, !subtitle.isExternal, let index = subtitle.streamIndex, let id = state.trackId(type: "sub", streamIndex: index) {
            if state.subtitleId != id {
                mpv?.set("sid", String(id))
            }
        } else if subtitle == nil || subtitle?.isExternal == true {
            mpv?.set("sid", "no")
        }
    }

    private func seekConfirmed(_ position: Double) {
        if let target = pendingSeek, abs(target - position) < 1.5 {
            return
        }
        seek(to: position)
    }

    private func seek(to seconds: Double) {
        let end = (state.duration ?? .infinity) - 1
        let target = max(0, min(seconds, end))
        pendingSeek = target
        mpv?.command(["seek", String(target), "absolute+keyframes"])
    }

    // MARK: Commands

    /// Performs a command; a refusal's reason, or nil when done.
    private func perform(_ command: [String: Any]) -> String? {
        let type = command["type"] as? String ?? ""
        switch type {
        case "play":
            wantsPlay = true
            mpv?.set("pause", flag: false)
        case "pause":
            wantsPlay = false
            mpv?.set("pause", flag: true)
        case "seek":
            guard let seconds = number(command["seconds"]) else {
                return "seek needs seconds"
            }
            seek(to: seconds)
        case "seekBy":
            guard let seconds = number(command["seconds"]) else {
                return "seekBy needs seconds"
            }
            seek(to: (pendingSeek ?? state.position) + seconds)
        case "volume":
            guard let value = number(command["value"]) else {
                return "volume needs a value"
            }
            report.volume = max(0, min(1, value))
            mpv?.set("volume", double: report.volume * 100)
        case "mute":
            report.muted = (command["muted"] as? Bool) ?? !report.muted
            mpv?.set("mute", flag: report.muted)
        case "audio":
            return selectAudio(command["trackId"] as? String)
        case "subtitle":
            return selectSubtitle(command["trackId"] as? String)
        case "retry":
            activeSource = ""
            if let plan {
                self.plan = nil
                setPlanObject(plan)
            }
        default:
            return "\(type) is not available in this player yet"
        }
        return nil
    }

    private func selectAudio(_ id: String?) -> String? {
        guard let id, let track = plan?.audioTrack(id) else {
            return "No such audio track"
        }
        guard let index = track.streamIndex, let mpvId = state.trackId(type: "audio", streamIndex: index) else {
            return "This audio track is not in the playing file; the server must switch it"
        }
        report.audioTrackId = id
        report.audioClientOnly = true
        mpv?.set("aid", String(mpvId))
        return nil
    }

    private func selectSubtitle(_ id: String?) -> String? {
        guard let id else {
            report.subtitleTrackId = nil
            report.subtitleClientOnly = true
            mpv?.set("sid", "no")
            return nil
        }
        guard let track = plan?.subtitleTrack(id) else {
            return "No such subtitle track"
        }
        if let url = track.externalURL.flatMap(resolve) {
            report.subtitleTrackId = id
            report.subtitleClientOnly = true
            mpv?.command(["sub-add", url.absoluteString, "select"])
            return nil
        }
        guard let index = track.streamIndex, let mpvId = state.trackId(type: "sub", streamIndex: index) else {
            return "This subtitle track is not in the playing file; the server must switch it"
        }
        report.subtitleTrackId = id
        report.subtitleClientOnly = true
        mpv?.set("sid", String(mpvId))
        return nil
    }

    /// Replays a plan as if it had just arrived (retry).
    private func setPlanObject(_ plan: VelaPlan) {
        guard let path = plan.selectedPath, let text = path.url, let url = resolve(text) else {
            return
        }
        self.plan = plan
        start(plan, path: path, url: url, source: "\(plan.sessionId):\(path.id):\(plan.sourceGeneration)")
    }

    private func number(_ value: Any?) -> Double? {
        (value as? Double) ?? (value as? Int).map(Double.init) ?? (value as? String).flatMap(Double.init)
    }
}

/// A Metal layer that keeps MoltenVK from shrinking its drawable to 1x1 when it forces a present
/// (https://github.com/mpv-player/mpv/pull/13651).
final class PlayerMetalLayer: CAMetalLayer {
    override var drawableSize: CGSize {
        get { super.drawableSize }
        set {
            if Int(newValue.width) > 1 && Int(newValue.height) > 1 {
                super.drawableSize = newValue
            }
        }
    }
}
