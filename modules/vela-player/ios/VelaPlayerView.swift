// VelaPlayerView: AetherEngine, driven by the contract's props.
//   - `plan`: the server's plan; the selected ready path plays (an original file or the server's HLS).
//     A newer plan of the same source moves the clock only when its seek generation changed.
//   - `command`: { id, type, ... } (modules/vela-player/web/engine/model.ts Command); each id is consumed once.
// On an original file (direct play) seeks and the file's own tracks change here; anything the server must
// apply (a seek on its HLS, a track the file does not carry, a path switch) is an onSessionCommand, and the
// view moves when the answering plan arrives. A refused media request asks for a fresh plan (onSessionRefresh).
// Before an original's first frame, the display is asked for its dynamic range and frame rate.
import ExpoModulesCore
import UIKit

final class VelaPlayerView: ExpoView {
    let onSnapshot = EventDispatcher()
    let onError = EventDispatcher()
    let onObservation = EventDispatcher()
    let onCommand = EventDispatcher()
    let onSessionCommand = EventDispatcher()
    let onSessionRefresh = EventDispatcher()

    private var player: PlaybackClient?
    private var state = PlayerState()
    private lazy var report = PlayerReport(
        snapshot: { [weak self] in self?.onSnapshot($0) },
        observation: { [weak self] in self?.onObservation($0) },
        error: { [weak self] in self?.onError($0) },
        sessionCommand: { [weak self] in self?.onSessionCommand($0) }
    )

    private var recovery = PathRecovery()
    private var recoveryPosition: Double?
    private var recoveryLimit: Timer?
    private var plan: VelaPlan?
    private var activeSource = ""
    private var lastCommand = -1
    private var pendingSeek: Double?
    private var wantsPlay = true
    private var ambient = false
    private var loggedOutput = false
    private var refreshAsked = ""
    private var heartbeat: Timer?
    /// A seek the server applies (its HLS): asked for, not yet answered by the plan with the next seek
    /// generation. Distinct from `pendingSeek`, which player is carrying out.
    private var awaitedSeek: Double?
    private var awaitedSeekLimit: Timer?

    // A trailer preview (`preview`): it excludes the plan and plays while active and on screen.
    // Made on first use; `madePreview` is what exists, for teardown, which must never make one
    // (the new preview's weak reference to a deallocating view aborts the app).
    private var madePreview: PreviewPlayback?
    private var preview: PreviewPlayback {
        if let madePreview {
            return madePreview
        }
        let made = makePreview()
        madePreview = made
        return made
    }
    private var previewSource: PreviewPlayback.Source?
    private var previewActive = true

    // What Now Playing shows (`metadata`); the title is required by the system.
    private var nowPlayingTitle = ""
    private var nowPlayingSubtitle: String?
    private var nowPlayingArtwork: String?

    /// Direct play: the playing source is an original file, so seeks and its tracks are the view's own.
    private var playsOriginal: Bool {
        plan?.selectedPath?.isOriginalFile == true
    }

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .clear
        clipsToBounds = true
    }

    deinit {
        MainActor.assumeIsolated {
            stop()
            madePreview?.stop()
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updatePreview()
        guard previewSource == nil else {
            return
        }
        if window == nil, player != nil {
            // Off screen (its screen popped or replaced): playback stops here, whatever else still
            // holds the view. A film never plays on, unseen, behind the page the viewer went to.
            print("[vela-player] left the window: stopping")
            stop()
            activeSource = ""
        } else if window != nil, player == nil, let plan, plan.selectedPath?.readiness == "ready" {
            // Back on screen with the same plan: start it again.
            setPlanObject(plan)
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        player?.layout()
        madePreview?.layout()
        CATransaction.commit()
    }

    // MARK: Props

    func setAmbient(_ value: Bool) {
        ambient = value
    }

    func setMetadata(_ map: [String: Any]?) {
        nowPlayingTitle = map?["title"] as? String ?? ""
        nowPlayingSubtitle = map?["subtitle"] as? String
        nowPlayingArtwork = map?["artworkUrl"] as? String
        updateNowPlaying()
    }

    func setPreview(_ map: [String: Any]?) {
        let hadPreview = previewSource != nil
        previewSource = PreviewPlayback.Source(map)
        if previewSource != nil {
            stop()
            backgroundColor = .clear
        } else if hadPreview {
            madePreview?.stop()
        }
        updatePreview()
    }

    func setActive(_ value: Bool?) {
        previewActive = value ?? true
        updatePreview()
    }

    private func updatePreview() {
        guard previewSource != nil else {
            return
        }
        preview.update(previewSource, wanted: previewActive && window != nil)
    }

    private func makePreview() -> PreviewPlayback {
        let playback = PreviewPlayback(host: self)
        playback.onState = { [weak self] state in
            self?.onSnapshot(["state": state])
        }
        playback.onFailure = { [weak self] message in
            self?.onError(["kind": "source", "message": message, "recoverable": false])
        }
        return playback
    }

    func setPlan(_ object: [String: Any]?) {
        guard previewSource == nil, let object, let next = VelaPlan.decode(object) else {
            return
        }
        backgroundColor = .black
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
        if recovery.awaitsFallback(next), next.fallback?.state == "ready", recoverPath() { return }
        guard let path = next.selectedPath else {
            return
        }
        let source = "\(next.sessionId):\(path.id):\(next.sourceGeneration)"
        // A server may increment the source generation for a track choice even though the
        // original file is unchanged. player can apply its streams without loading that file again.
        let sameFile = previous?.sessionId == next.sessionId && path.isOriginalFile &&
            previous?.selectedPath?.isOriginalFile == true &&
            (previous?.selectedPath?.url == path.url || (path.sourceId != nil && previous?.selectedPath?.sourceId == path.sourceId && previous?.selectedPath?.timelineId == path.timelineId)) &&
            previous?.selectedPath?.id == path.id
        let tracksChanged = previous?.selectedAudioTrackId != next.selectedAudioTrackId ||
            previous?.selectedSubtitleTrackId != next.selectedSubtitleTrackId
        if source == activeSource || (sameFile && tracksChanged && previous?.seekGeneration == next.seekGeneration) {
            activeSource = source
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
        // Not on screen (not yet attached, or already left): keep the plan; it starts on attaching.
        guard window != nil else {
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
        player?.set("pause", flag: true)
        report.publish(state, seekTarget: nil, force: true)
    }

    func setCommand(_ command: [String: Any]?) {
        guard let command, let id = command["id"] as? Int, id > lastCommand else {
            return
        }
        lastCommand = id
        let failure = previewSource == nil ? perform(command) : performOnPreview(command)
        var result: [String: Any] = ["id": id, "ok": failure == nil]
        if let failure {
            result["failure"] = ["kind": "action", "message": failure, "recoverable": true]
        }
        onCommand(result)
        report.publish(state, seekTarget: pendingSeek, force: true)
        updateNowPlaying()
    }

    // MARK: System media controls

    private func updateNowPlaying() {
        guard !ambient, previewSource == nil, player != nil, state.loaded else {
            return
        }
        let artwork = nowPlayingArtwork.flatMap(resolve)
        let title = nowPlayingTitle.isEmpty ? "Vela" : nowPlayingTitle
        let now = NowPlayingState(
            title: title,
            subtitle: nowPlayingSubtitle,
            artworkURL: artwork,
            duration: state.duration,
            position: pendingSeek ?? state.position,
            playing: state.phase == .playing
        )
        SystemMediaControls.shared.update(now, from: self)
    }

    // MARK: Playback

    private func start(_ plan: VelaPlan, path: VelaPlanPath, url: URL, source: String) {
        stop()
        activeSource = source
        recoveryPosition = nil
        state = PlayerState()
        pendingSeek = nil
        report.pathId = path.id
        report.backend = path.isOriginalFile ? "aether-original" : "aether-hls"
        if !ambient {
            PlaybackAudioSession.activate()
        }
        let client = PlaybackClient(host: self, paused: true, muted: ambient || report.muted)
        player = client
        client.set("volume", double: report.volume * 100)
        client.onBackend = { [weak self] backend in
            guard let self else { return }
            self.report.backend = backend + (path.isOriginalFile ? "-original" : "-hls")
            print("[vela-player] backend \(backend), session \(plan.sessionId), path \(path.id)")
        }
        if !ambient {
            SystemMediaControls.shared.claim(self)
        }
        let heartbeat = Timer(timeInterval: PlayerReport.heartbeatInterval / 4, repeats: true) { [weak self] _ in
            guard let self else {
                return
            }
            self.report.heartbeat(self.state)
        }
        RunLoop.main.add(heartbeat, forMode: .common)
        self.heartbeat = heartbeat
        client.onProperty = { [weak self] name, value in
            self?.propertyChanged(name, value)
        }
        client.onEvent = { [weak self] event in
            self?.event(event)
        }
        let subtitle = plan.subtitleTrack(report.subtitleTrackId)
        if let index = plan.audioTrack(report.audioTrackId)?.streamIndex { client.set("aid", String(index)) }
        client.set("sid", subtitle?.isExternal == false ? subtitle?.streamIndex.map(String.init) ?? "no" : "no")
        var options = ["start=\(plan.positionSeconds)"]
        if path.isOriginalFile {
            // Source stream indexes are FFmpeg's; player selects by its own ids, mapped once loaded (applyTracks).
            options.append(subtitle == nil || subtitle?.isExternal == true ? "sid=no" : "sid=auto")
        }
        // The display switches before the first frame; player loads meanwhile, paused.

        report.publish(state, seekTarget: nil, force: true)
        Task { @MainActor [weak self] in
            let media = await MediaRedirects.resolve(url)
            guard let self, self.activeSource == source, self.player === client else {
                return
            }
            self.load(media, options: options, on: client)
        }
    }

    /// Whether this player holds the screen awake: no screensaver or auto-lock while a film plays
    /// (or loads or buffers to play). Paused, ended or gone, the device sleeps as it normally would.
    private var holdsAwake = false
    private func keepAwake(_ on: Bool) {
        guard on != holdsAwake else {
            return
        }
        holdsAwake = on
        let apply = { UIApplication.shared.isIdleTimerDisabled = on }
        if Thread.isMainThread { apply() } else { DispatchQueue.main.async(execute: apply) }
    }

    /// Loads the resolved URL with its headers; with headers attached, FFmpeg follows no redirect.
    private func load(_ media: ResolvedMedia, options: [String], on client: PlaybackClient) {
        client.setStringList("http-header-fields", media.headers.map { "\($0.key): \($0.value)" })
        client.command(["loadfile", media.url.absoluteString, "replace", "-1", options.joined(separator: ",")])
    }

    private func stop() {
        recoveryLimit?.invalidate()
        recoveryLimit = nil
        heartbeat?.invalidate()
        heartbeat = nil
        endAwaitedSeek()
        keepAwake(false)
        guard let client = player else {
            return
        }
        player = nil
        client.destroy()
        SystemMediaControls.shared.release(self)
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

    // MARK: player

    private func propertyChanged(_ name: String, _ value: Any?) {
        state.update(name, value)
        keepAwake(!ambient && (state.phase == .playing || state.phase == .buffering || state.phase == .loading))
        if name == "track-list" {
            applyTracks()
        }
        if name == "video-params", !state.videoParams.isEmpty {
            logOutput()
        }
        if name == "time-pos", let target = pendingSeek, abs(state.position - target) < 2, !state.seeking {
            pendingSeek = nil
        }
        report.publish(state, seekTarget: pendingSeek)
        updateNowPlaying()
    }

    private func event(_ event: PlaybackClient.Event) {
        switch event {
        case .fileLoaded:
            state.loaded = true
            applyTracks()
            resumeAfterDisplaySwitch()
        case .endFile(let reason, _):
            if reason == 4, !recoverPath() {
                state.failure = "AetherEngine could not play any server path"
                state.failureKind = "decoder"
            }
        case .refused(let status):
            askForFreshPlan("media request refused (\(status))")
        case .seekDone:
            pendingSeek = nil
            if !loggedOutput {
                loggedOutput = true
                logOutput()
            }
        case .shutdown:
            break
        }
        report.publish(state, seekTarget: pendingSeek, force: true)
    }

    private func recoverPath() -> Bool {
        guard let plan else { return false }
        let position = recoveryPosition ?? (state.loaded ? state.position : plan.positionSeconds)
        guard let command = recovery.next(plan, at: position) else { return false }
        recoveryPosition = position
        state.loaded = false
        state.pausedForCache = true
        recoveryLimit?.invalidate()
        recoveryLimit = Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.state.failure = "The server did not provide a playable replacement path"
            self.state.failureKind = "source"
            self.report.publish(self.state, seekTarget: nil, force: true)
        }
        report.sessionCommand(command)
        return true
    }

    /// Asks once per source for a fresh plan: the grant behind the media URL has expired or was revoked.
    private func askForFreshPlan(_ reason: String) {
        guard let plan, refreshAsked != activeSource else {
            return
        }
        refreshAsked = activeSource
        print("[vela-player] session refresh: \(reason)")
        onSessionRefresh(["sessionId": plan.sessionId])
    }

    private func logOutput() {
        print("[vela-player] decoded video range=\(state.dynamicRange ?? "unknown")")
    }

    /// Aether load completes after its own display matching.
    private func resumeAfterDisplaySwitch() {
        player?.set("pause", flag: !wantsPlay)
    }

    /// Selects the plan's chosen audio and subtitle streams by their source stream index.
    private func applyTracks() {
        guard let plan, let path = plan.selectedPath, path.isOriginalFile, !state.tracks.isEmpty else {
            return
        }
        let audioIndex = plan.audioTrack(report.audioTrackId)?.streamIndex
        if let audioIndex, let id = state.trackId(type: "audio", streamIndex: audioIndex) {
            if state.audioId != id {
                player?.set("aid", String(id))
            }
        }
        let subtitle = plan.subtitleTrack(report.subtitleTrackId)
        let subtitleIndex = subtitle?.isExternal == false ? subtitle?.streamIndex : nil
        if let subtitleIndex, let id = state.trackId(type: "sub", streamIndex: subtitleIndex) {
            if state.subtitleId != id {
                player?.set("sid", String(id))
            }
        } else if (subtitle == nil && report.subtitleTrackId?.hasPrefix("mpv-sub-") != true) || subtitle?.isExternal == true {
            player?.set("sid", "no")
        }
    }

    /// A plan with a new seek generation: player moves to the server's position, unless it is already going there.
    private func seekConfirmed(_ position: Double) {
        if awaitedSeek != nil {
            endAwaitedSeek()
            seek(to: position)
            return
        }
        if let target = pendingSeek, abs(target - position) < 1.5 {
            return
        }
        seek(to: position)
    }

    /// Shows `target` until the server's answer arrives; observations of the old position are held meanwhile.
    /// An answer that never comes is given up after ten seconds, and playback carries on where it is.
    private func awaitSeek(_ target: Double) {
        awaitedSeek = target
        pendingSeek = target
        report.holdsObservations = true
        awaitedSeekLimit?.invalidate()
        awaitedSeekLimit = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in
            self?.giveUpAwaitedSeek()
        }
    }

    private func endAwaitedSeek() {
        awaitedSeek = nil
        awaitedSeekLimit?.invalidate()
        awaitedSeekLimit = nil
        report.holdsObservations = false
    }

    private func giveUpAwaitedSeek() {
        guard awaitedSeek != nil else {
            return
        }
        endAwaitedSeek()
        pendingSeek = nil
        report.publish(state, seekTarget: nil, force: true)
    }

    private func seek(to seconds: Double) {
        let end = (state.duration ?? .infinity) - 1
        let target = max(0, min(seconds, end))
        pendingSeek = target
        player?.command(["seek", String(target), "absolute+keyframes"])
    }

    // MARK: Commands

    /// A preview takes play and pause only.
    private func performOnPreview(_ command: [String: Any]) -> String? {
        switch command["type"] as? String {
        case "play":
            preview.setPaused(false)
        case "pause":
            preview.setPaused(true)
        default:
            return "A preview takes play and pause only"
        }
        return nil
    }

    /// Performs a command; a refusal's reason, or nil when done.
    private func perform(_ command: [String: Any]) -> String? {
        let type = command["type"] as? String ?? ""
        switch type {
        case "play":
            wantsPlay = true
            player?.set("pause", flag: false)
        case "pause":
            wantsPlay = false
            player?.set("pause", flag: true)
        case "seek":
            guard let seconds = number(command["seconds"]) else {
                return "seek needs seconds"
            }
            requestSeek(to: seconds)
        case "seekBy":
            guard let seconds = number(command["seconds"]) else {
                return "seekBy needs seconds"
            }
            requestSeek(to: (pendingSeek ?? state.position) + seconds)
        case "quality", "switchPath":
            let value = (command["renditionId"] as? String) ?? (command["pathId"] as? String) ?? ""
            let pathId = value.hasPrefix("path:") ? String(value.dropFirst(5)) : value
            guard !pathId.isEmpty, pathId != report.pathId else {
                return pathId.isEmpty ? "Automatic quality is the server's choice on this player" : nil
            }
            report.sessionCommand(["kind": "switch", "pathId": pathId, "atSeconds": state.position])
        case "volume":
            guard let value = number(command["value"]) else {
                return "volume needs a value"
            }
            report.volume = max(0, min(1, value))
            player?.set("volume", double: report.volume * 100)
        case "mute":
            report.muted = (command["muted"] as? Bool) ?? !report.muted
            player?.set("mute", flag: report.muted)
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

    /// A seek: local on an original file; on the server's HLS, a session command whose plan moves the clock.
    private func requestSeek(to seconds: Double) {
        let end = (state.duration ?? .infinity) - 1
        let target = max(0, min(seconds, end))
        if playsOriginal {
            seek(to: target)
            return
        }
        awaitSeek(target)
        report.sessionCommand(["kind": "seek", "positionSeconds": target])
    }

    private func selectAudio(_ id: String?) -> String? {
        if id == report.audioTrackId { return nil }
        guard let id, let track = plan?.audioTrack(id) else {
            return "No such audio track"
        }
        let index = track.streamIndex
        guard playsOriginal, let index, let trackId = state.trackId(type: "audio", streamIndex: index) else {
            report.sessionCommand(["kind": "tracks", "audioTrackId": id])
            return nil
        }
        report.audioTrackId = id
        report.audioClientOnly = true
        player?.set("aid", String(trackId))
        return nil
    }

    private func selectSubtitle(_ id: String?) -> String? {
        if id == report.subtitleTrackId { return nil }
        if playsOriginal, let id, id.hasPrefix("mpv-sub-"), let trackId = Int64(id.dropFirst(8)),
           state.tracks.contains(where: { $0["type"] as? String == "sub" && $0["id"] as? Int64 == trackId }) {
            report.subtitleTrackId = id
            report.subtitleClientOnly = true
            player?.set("sid", String(trackId))
            report.publish(state, seekTarget: pendingSeek, force: true)
            return nil
        }
        guard let id else {
            if !playsOriginal {
                report.sessionCommand(["kind": "tracks", "subtitleTrackId": NSNull()])
                return nil
            }
            report.subtitleTrackId = nil
            report.subtitleClientOnly = true
            player?.set("sid", "no")
            return nil
        }
        guard let track = plan?.subtitleTrack(id) else {
            return "No such subtitle track"
        }
        if let url = track.externalURL.flatMap(resolve) {
            report.subtitleTrackId = id
            report.subtitleClientOnly = true
            player?.command(["sub-add", url.absoluteString, "select"])
            return nil
        }
        let index = track.streamIndex
        guard playsOriginal, let index, let trackId = state.trackId(type: "sub", streamIndex: index) else {
            report.sessionCommand(["kind": "tracks", "subtitleTrackId": id])
            return nil
        }
        report.subtitleTrackId = id
        report.subtitleClientOnly = true
        player?.set("sid", String(trackId))
        return nil
    }

    /// Replays a plan as if it had just arrived (retry).
    private func setPlanObject(_ plan: VelaPlan) {
        guard let path = plan.selectedPath, let text = path.url, let url = resolve(text) else {
            return
        }
        self.plan = plan
        guard window != nil else {
            return
        }
        start(plan, path: path, url: url, source: "\(plan.sessionId):\(path.id):\(plan.sourceGeneration)")
    }

    private func number(_ value: Any?) -> Double? {
        (value as? Double) ?? (value as? Int).map(Double.init) ?? (value as? String).flatMap(Double.init)
    }
}

extension VelaPlayerView: SystemMediaOwner {
    /// The Siri Remote's or Control Center's command, through the same paths as the `command` prop.
    func systemMediaCommand(_ command: SystemMediaCommand) {
        switch command {
        case .play:
            _ = perform(["type": "play"])
        case .pause:
            _ = perform(["type": "pause"])
        case .toggle:
            _ = perform(["type": state.phase == .playing ? "pause" : "play"])
        case .skip(let seconds):
            _ = perform(["type": "seekBy", "seconds": seconds])
        case .seek(let position):
            _ = perform(["type": "seek", "seconds": position])
        }
        report.publish(state, seekTarget: pendingSeek, force: true)
        updateNowPlaying()
    }
}
