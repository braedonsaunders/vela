// Music, audiobooks and podcasts (modules/vela-player/src/audio.ts): one AVPlayer for the whole app,
// not tied to a screen, so a queue keeps playing while the viewer browses, in the background and on the
// lock screen. It owns the system's media controls while it plays (Now Playing, Control Center, the
// lock screen, the Siri Remote, headsets and CarPlay); their commands go to JavaScript, which drives the
// queue exactly as the app's own buttons do. AVPlayer plays MP3, AAC and ALAC (MP4/M4A/M4B, ADTS),
// FLAC and WAV; the server transcodes anything else. Speed keeps pitch (spectral time-pitch).
// Gapless: an AVQueuePlayer holds the next queue item behind the current one (`preload`) and moves on to
// it with no gap, trimming the encoder delay and padding the file declares (iTunes gapless metadata, MP4
// edit lists, the LAME header); JavaScript hears `advanced` and Now Playing follows.
// Sound (docs/sound.md): a player's items share one processing tap (SoundTap.swift) with their levelling
// gains and the shared EQ; a gapless join changes gain on the next item's first sample, and the queue
// stays gapless (a tap per item would make AVQueuePlayer stop and restart between items). AutoMix: a
// crossfade's incoming item waits, prerolled, in a second queue player; a boundary observer on the
// outgoing item starts it at the exact host time the outgoing item reaches `at` (setRate(_:time:
// atHostTime:)), both taps run their equal-power fades on their own item clocks, and the players swap
// roles: the incoming one becomes the player JavaScript, Now Playing and the remote commands follow,
// and the outgoing one plays out its fade and is released.
import AVFoundation
import Foundation
import MediaPlayer
import UIKit

@MainActor
final class AudioPlayback: NSObject, SystemMediaOwner {
    static let shared = AudioPlayback()

    /// The module's event sink ("onAudio").
    var emit: (([String: Any]) -> Void)?

    struct NowPlaying {
        var title: String
        var artist: String
        var album: String
        var artwork: URL?
        var spoken: Bool
    }

    /// The playing player: the one JavaScript, Now Playing and the remote commands follow.
    private var player = AudioPlayback.makePlayer()
    /// AutoMix's second player: a crossfade's incoming item waits in it until it starts and takes over.
    private var spare = AudioPlayback.makePlayer()
    private var item: AVPlayerItem?
    /// The next item, waiting behind `item` in the queue player (once its tap is on), JavaScript's id
    /// for it, and its levelling gain.
    private var queued: (item: AVPlayerItem, id: Int, gain: Double)?
    private var playerObservers: [NSKeyValueObservation] = []
    private var timeObserver: Any?
    /// The playing player's tap (levelling, fades and the EQ), and the spare's for a crossfade.
    private var lane = SoundLane()
    private var spareLane: SoundLane?
    /// A crossfade waiting for its moment, and the outgoing item playing out its fade.
    private var crossfade: PendingCrossfade?
    private var fading: Fading?
    #if DEBUG
    private var captureTimer: Timer?
    #endif
    /// After an advance Now Playing waits for JavaScript's title for the new item (a second at most),
    /// rather than showing the finished item's title over the new item's position.
    private var nowPlayingHeld = false
    private var nowPlayingRelease: Timer?
    private var itemObservers: [NSKeyValueObservation] = []
    private var itemNotifications: [NSObjectProtocol] = []
    private var loadID = 0
    /// Where the item starts once it is ready (or a seek asked for before then).
    private var pendingStart: Double?
    /// A seek on its way: the position until it lands.
    private var seekTarget: Double?
    private var wantsPlay = false
    private var rate: Float = 1
    private var ready = false
    private var failure: String?
    private var ended = false
    private var info: NowPlaying?
    private var lastSent: (state: String, duration: Double)?
    /// The item's clock as last sampled, and whether it moved since the sample before: after an advance
    /// the new item stands still for a moment while the player says it plays.
    private var clockSample: (item: ObjectIdentifier, time: Double)?
    private var clockRunning = false
    private var interruptedWhilePlaying = false
    /// Background time between an item's end and the next one's start, while JavaScript asks for its plan.
    private var bridging: UIBackgroundTaskIdentifier = .invalid
    private var bridgingTimer: Timer?

    var systemMediaStyle: SystemMediaStyle { info?.spoken == true ? .spoken : .music }

    private override init() {
        super.init()
        bind(player)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
    }

    @discardableResult private func updateVisualizerAvailability() -> Bool {
        let available = item.map { !lane.hasNoTap($0) && !lane.context.visualizerFeed.unsupported } ?? true
        VisualizerAvailability.shared.update(available)
        return available
    }

    /// The same monotonic instant projected onto each audible item's clock. Subscribing
    /// observes existing taps only, including a scheduled incoming lane during handover.
    func visualizerLanes() -> [VisualizerHeardLane]? {
        guard let item else { return [] }
        guard updateVisualizerAvailability() else { return nil }
        let host = CMClockGetHostTimeClock()
        let now = CMClockGetTime(host)
        var lanes: [VisualizerHeardLane] = []
        func observe(_ item: AVPlayerItem, _ id: Int, _ lane: SoundLane, audible: Bool = true) {
            guard let clock = item.timebase else { return }
            let seconds = CMSyncConvertTime(now, from: host, to: clock).seconds
            let rate = CMTimebaseGetRate(clock)
            guard seconds.isFinite else { return }
            lanes.append(VisualizerHeardLane(buffer: lane.context.visualizerFeed.subscribe(), id: id, seconds: seconds,
                                             speed: audible && wantsPlay && seekTarget == nil ? rate : 0))
        }
        observe(item, loadID, lane)
        if let fading { observe(fading.item, fading.id, fading.lane) }
        if let pending = crossfade, let spareLane {
            observe(pending.item, pending.id, spareLane, audible: pending.startHost.map { now >= $0 } ?? false)
        }
        return lanes
    }

    private static func makePlayer() -> AVQueuePlayer {
        let player = AVQueuePlayer()
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        player.isMuted = PlaybackSilence.on
        #if DEBUG
        if SoundCapture.silent { quiet(player) }
        #endif
        return player
    }

    /// Follows the playing player's state, item and clock.
    private func bind(_ player: AVQueuePlayer) {
        playerObservers = [
            player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        // A crossfade due while the player waited (a resume, a stall) is fixed once it plays.
                        self?.checkCrossfadeBoundary()
                        self?.publish()
                    }
                }
            },
            player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.currentItemChanged() } }
            },
        ]
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.checkCrossfadeBoundary()
                self?.publish(tick: true)
            }
        }
    }

    private func unbind(_ player: AVQueuePlayer) {
        playerObservers.forEach { $0.invalidate() }
        playerObservers = []
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
    }

    // MARK: Commands (from JavaScript)

    func load(id: Int, url: URL, access: VelaMediaAuth?, start: Double, rate: Double) {
        cancelCrossfade()
        stopFading()
        detachItem()
        loadID = id
        ready = false
        failure = nil
        ended = false
        wantsPlay = false
        lastSent = nil
        clockSample = nil
        clockRunning = false
        pendingStart = start > 0 ? start : nil
        self.rate = Float(rate > 0 ? rate : 1)
        let item = Self.item(url: url, access: access)
        queued = nil
        self.item = item
        observe(item)
        player.defaultRate = self.rate
        player.actionAtItemEnd = .pause
        player.removeAllItems()
        lane = SoundLane()
        lane.context.start(id: id, gain: 1)
        lane.attach(item) { [weak self] tapped in
            guard let self, self.item === item else { return }
            self.tapAttached(id, tapped)
            self.startIfWanted()
        }
        player.insert(item, after: nil)
        SystemMediaControls.shared.claim(self)
        publish()
    }

    private static func item(url: URL, access: VelaMediaAuth?) -> AVPlayerItem {
        let headers = access?.headers(for: url) ?? [:]
        let asset = AVURLAsset(url: url, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let item = AVPlayerItem(asset: asset)
        item.audioTimePitchAlgorithm = .spectral
        return item
    }

    /// Follows the playing item's status, duration, end and failure.
    private func observe(_ item: AVPlayerItem) {
        itemObservers = [
            item.observe(\.status, options: [.new]) { [weak self] item, _ in
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.statusChanged(item) } }
            },
            item.observe(\.duration, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.publish() } }
            },
        ]
        let center = NotificationCenter.default
        itemNotifications = [
            center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.finished() }
            },
            center.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main) { [weak self] note in
                let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
                MainActor.assumeIsolated { self?.fail(error) }
            },
        ]
    }

    /// Queues the next item behind the current one (nil drops it), so the player goes straight on to it.
    /// An item that starts part-way (an audiobook part's resume point) is not queued: the current one ends
    /// and JavaScript loads it. `gain` is the next item's levelling; with `crossfade` (AutoMix) the next
    /// item starts `seconds` before the current one's audible end, at `at` on the current item's clock.
    func preload(id: Int?, url: URL?, access: VelaMediaAuth?, start: Double, gain: Double = 1, crossfade fade: (seconds: Double, at: Double)? = nil) {
        // The same handover again (the sound settings changed): only the id and gain follow.
        if let id, let url, let pending = crossfade, let fade, pending.url == url, pending.start == max(0, start),
           pending.seconds == fade.seconds, pending.at == fade.at {
            pending.id = id
            spareLane?.context.setGain(gain)
            return
        }
        if let id, let url, fade == nil, start <= 0, let waiting = queued, (waiting.item.asset as? AVURLAsset)?.url == url {
            queued = (waiting.item, id, gain)
            if player.items().contains(waiting.item) { lane.context.queue(.init(id: id, gain: gain)) }
            return
        }
        if let waiting = queued?.item {
            player.remove(waiting)
            lane.forget(waiting)
        }
        queued = nil
        lane.context.queue(nil)
        cancelCrossfade()
        player.actionAtItemEnd = .pause
        guard let id, let url, let current = item, player.currentItem === current, !ended else { return }
        if let fade, fade.seconds > 0, fade.at.isFinite, fade.at >= 0 {
            prepareCrossfade(id: id, url: url, access: access, start: max(0, start), gain: gain, seconds: fade.seconds, at: fade.at)
            return
        }
        guard start <= 0 else { return }
        let next = Self.item(url: url, access: access)
        queued = (next, id, gain)
        // Queued once the tap is on it: the queue player then goes on to it in the same audio pipeline.
        let lane = self.lane
        lane.attach(next) { [weak self] tapped in
            guard let self, self.lane === lane, let waiting = self.queued, waiting.item === next, let current = self.item,
                  self.player.currentItem === current, !self.ended else { return }
            self.tapAttached(waiting.id, tapped)
            guard lane.ready(next), self.player.canInsert(next, after: current) else {
                self.queued = nil
                return
            }
            lane.context.queue(.init(id: waiting.id, gain: waiting.gain))
            self.player.insert(next, after: current)
            self.player.actionAtItemEnd = .advance
        }
    }

    /// Levelling and the EQ: `gain` for the playing item, the EQ for every item until it changes.
    func setSound(gain: Double, eq: SoundEQ?) {
        if item != nil { lane.context.setGain(gain) }
        SoundSharedEQ.shared.set(eq)
    }

    /// The queue player moved on to the queued item: it is now the one JavaScript hears about.
    private func currentItemChanged() {
        guard let next = queued, player.currentItem === next.item else { return }
        if let finished = item { lane.forget(finished) }
        lane.context.advanced()
        detachItem()
        queued = nil
        player.actionAtItemEnd = .pause
        item = next.item
        loadID = next.id
        ready = next.item.status == .readyToPlay
        failure = nil
        ended = false
        pendingStart = nil
        lastSent = nil
        clockSample = nil
        clockRunning = false
        observe(next.item)
        holdNowPlaying()
        emit?(["id": next.id, "type": "advanced", "position": position, "duration": duration])
        publish(tick: true)
    }

    func play() {
        guard item != nil else { return }
        wantsPlay = true
        ended = false
        PlaybackAudioSession.activateForAudio(spoken: info?.spoken == true)
        // An item that starts later in the file waits until it is ready and there; anything else starts buffering now.
        startIfWanted(always: true)
        if let fading { fading.player.playImmediately(atRate: rate) }
        checkCrossfadeBoundary()
        publish()
    }

    /// Starts the player if JavaScript wants it playing, the item can start, and its tap is in place:
    /// an item never plays its first moments at the wrong gain or without the EQ.
    private func startIfWanted(always: Bool = false) {
        guard wantsPlay, let item, ready || pendingStart == nil, lane.ready(item) else { return }
        if always || player.rate == 0 { player.playImmediately(atRate: rate) }
    }

    func pause() {
        wantsPlay = false
        player.pause()
        fading?.player.pause()
        unscheduleCrossfade()
        publish()
    }

    func seek(_ seconds: Double) {
        guard item != nil else { return }
        stopFading()
        unscheduleCrossfade()
        lane.context.seeked()
        ended = false
        guard ready else {
            pendingStart = max(0, seconds)
            return
        }
        // AVPlayer's currentTime stays at the old place until the seek lands: report the target meanwhile.
        let target = max(0, seconds)
        seekTarget = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, self.seekTarget == target else { return }
                    self.seekTarget = nil
                    self.checkCrossfadeBoundary()
                    self.publish(tick: true)
                }
            }
        }
    }

    func setRate(_ value: Double) {
        rate = Float(value > 0 ? value : 1)
        player.defaultRate = rate
        if player.rate != 0 { player.rate = rate }
        if let fading, fading.player.rate != 0 { fading.player.rate = rate }
        publish(tick: true)
    }

    func unload() {
        wantsPlay = false
        player.pause()
        cancelCrossfade()
        stopFading()
        detachItem()
        queued = nil
        player.actionAtItemEnd = .pause
        player.removeAllItems()
        lane = SoundLane()
        endBridging()
        SystemMediaControls.shared.release(self)
    }

    func setNowPlaying(_ value: NowPlaying?) {
        let restyled = (value?.spoken == true) != (info?.spoken == true)
        info = value
        releaseNowPlaying()
        guard item != nil else { return }
        if restyled { SystemMediaControls.shared.claim(self) }
        updateNowPlaying()
    }

    // MARK: SystemMediaOwner

    @discardableResult
    func systemMediaCommand(_ command: SystemMediaCommand) -> Bool {
        var body: [String: Any] = ["id": loadID, "type": "remote"]
        switch command {
        case .play: body["command"] = "play"
        case .pause: body["command"] = "pause"
        case .toggle: body["command"] = "toggle"
        case .next: body["command"] = "next"
        case .previous: body["command"] = "previous"
        case .skip(let seconds): body["command"] = "skip"; body["seconds"] = seconds
        case .seek(let position): body["command"] = "seek"; body["seconds"] = position
        case .enableAudio, .enableSubtitle, .disableSubtitle:
            return false
        }
        emit?(body)
        return true
    }

    // MARK: Player state

    private func statusChanged(_ changed: AVPlayerItem) {
        guard changed === item else { return }
        switch changed.status {
        case .readyToPlay where !ready:
            ready = true
            if let start = pendingStart {
                pendingStart = nil
                seekTarget = start
                changed.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                    DispatchQueue.main.async {
                        MainActor.assumeIsolated {
                            guard let self, self.item === changed else { return }
                            if self.seekTarget == start { self.seekTarget = nil }
                            self.startIfWanted(always: true)
                            self.publish(tick: true)
                        }
                    }
                }
            } else {
                startIfWanted()
            }
            publish()
        case .failed:
            fail(changed.error)
        default:
            publish()
        }
    }

    private func finished() {
        // The queue player goes on to the queued item; that is an advance, not an end.
        if let next = queued, player.items().contains(next.item) { return }
        queued = nil
        // A crossfade that could not start in time: the incoming item starts now, without a fade.
        if crossfade != nil, startCrossfadeAtEnd() { return }
        ended = true
        wantsPlay = false
        // JavaScript loads the next item's plan; keep the app running in the background until it plays.
        beginBridging()
        publish()
    }

    private func fail(_ error: Error?) {
        guard item != nil else { return }
        failure = Self.message(error)
        wantsPlay = false
        publish()
    }

    /// A viewer-facing reason; URLs and server messages never leave the device.
    private static func message(_ error: Error?) -> String {
        let code = (error as NSError?)?.code ?? 0
        switch code {
        case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut, NSURLErrorCannotConnectToHost:
            return "The server could not be reached. Please try again."
        case AVError.Code.fileFormatNotRecognized.rawValue, AVError.Code.decoderNotFound.rawValue, AVError.Code.failedToParse.rawValue:
            return "This audio format cannot be played on this device."
        default:
            return "This audio could not be played. Please try again."
        }
    }

    private var state: String {
        guard item != nil else { return "idle" }
        if failure != nil { return "failed" }
        if ended { return "ended" }
        switch player.timeControlStatus {
        case .playing: return "playing"
        case .waitingToPlayAtSpecifiedRate: return "buffering"
        default: return wantsPlay ? (ready ? "paused" : "buffering") : (ready ? "paused" : "loading")
        }
    }

    private var position: Double {
        if let start = pendingStart { return start }
        if let target = seekTarget { return target }
        let seconds = player.currentTime().seconds
        return seconds.isFinite ? max(0, seconds) : 0
    }

    private var duration: Double {
        guard let seconds = item?.duration.seconds, seconds.isFinite, seconds > 0 else { return 0 }
        return seconds
    }

    /// Reports the state to JavaScript when it changed, and every half second while playing.
    private func publish(tick: Bool = false) {
        updateVisualizerAvailability()
        guard let item else { return }
        sampleClock(item)
        let state = self.state
        let duration = self.duration
        if state == "playing" { endBridging() }
        let changed = lastSent?.state != state || lastSent?.duration != duration
        guard changed || (tick && (state == "playing" || state == "paused")) else {
            return
        }
        lastSent = (state, duration)
        var body: [String: Any] = [
            "id": loadID, "type": "status", "state": state, "position": position, "duration": duration,
            "rate": Double(rate), "buffered": buffered(),
        ]
        if let failure { body["error"] = failure }
        emit?(body)
        updateNowPlaying()
    }

    /// Whether the item's clock moved since the last sample. A seek on its way, or a start not yet
    /// reached, is not the clock moving.
    private func sampleClock(_ item: AVPlayerItem) {
        let time = item.currentTime().seconds
        let id = ObjectIdentifier(item)
        guard time.isFinite, seekTarget == nil, pendingStart == nil, player.timeControlStatus == .playing else {
            clockRunning = false
            clockSample = time.isFinite ? (id, time) : nil
            return
        }
        if let sample = clockSample, sample.item == id, time != sample.time {
            clockRunning = time > sample.time
        }
        clockSample = (id, time)
    }

    private func buffered() -> [[String: Double]] {
        (item?.loadedTimeRanges ?? []).compactMap { value in
            let range = value.timeRangeValue
            let start = range.start.seconds, end = range.end.seconds
            return start.isFinite && end.isFinite ? ["startSeconds": start, "endSeconds": end] : nil
        }
    }

    private func holdNowPlaying() {
        nowPlayingHeld = true
        nowPlayingRelease?.invalidate()
        nowPlayingRelease = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.nowPlayingHeld else { return }
                self.releaseNowPlaying()
                self.updateNowPlaying()
            }
        }
    }

    private func releaseNowPlaying() {
        nowPlayingHeld = false
        nowPlayingRelease?.invalidate()
        nowPlayingRelease = nil
    }

    private func updateNowPlaying() {
        guard item != nil, !nowPlayingHeld else { return }
        let state = self.state
        let now = NowPlayingState(
            title: info?.title.isEmpty == false ? info!.title : "Vela",
            subtitle: info?.artist.isEmpty == false ? info?.artist : nil,
            artworkURL: info?.artwork,
            duration: duration > 0 ? duration : nil,
            position: position,
            playing: state == "playing",
            album: info?.album.isEmpty == false ? info?.album : nil,
            rate: Double(rate),
            audio: true,
            clockRunning: clockRunning
        )
        SystemMediaControls.shared.update(now, from: self)
    }

    private func detachItem() {
        seekTarget = nil
        itemObservers.forEach { $0.invalidate() }
        itemObservers = []
        itemNotifications.forEach { NotificationCenter.default.removeObserver($0) }
        itemNotifications = []
        item = nil
        updateVisualizerAvailability()
    }

    // MARK: Sound and AutoMix

    /// How long before `at` the incoming item's host start time is fixed. The outgoing tap renders a
    /// little ahead of what is heard, so its fade must be set well before it is due.
    private static let crossfadeLead = 1.0

    /// Main thread only.
    private final class PendingCrossfade: @unchecked Sendable {
        let item: AVPlayerItem
        let url: URL
        var id: Int
        let seconds: Double
        let at: Double
        let start: Double
        /// The outgoing player's boundary observer at `at` minus the lead.
        var boundary: (player: AVQueuePlayer, token: Any)?
        var status: NSKeyValueObservation?
        var positioned: Bool
        var positioning = false
        var prerolled = false
        var prerolling = false
        /// The outgoing item reached the lead: start as soon as everything is ready.
        var due = false
        /// Once fixed: the host time it starts, and where the outgoing fade ends on the outgoing item's clock.
        var startHost: CMTime?
        var fadeEnd: Double?
        var started: DispatchWorkItem?

        init(item: AVPlayerItem, url: URL, id: Int, seconds: Double, at: Double, start: Double) {
            self.item = item
            self.url = url
            self.id = id
            self.seconds = seconds
            self.at = at
            self.start = start
            positioned = start <= 0
        }
    }

    private struct Fading {
        let player: AVQueuePlayer
        let item: AVPlayerItem
        let id: Int
        let lane: SoundLane
        var boundary: Any?
        var ended: NSObjectProtocol?
    }

    private func tapAttached(_ id: Int, _ tapped: Bool) {
        if id == loadID { updateVisualizerAvailability() }
        #if DEBUG
        SoundCapture.shared.event("tap", ["id": id, "tapped": tapped])
        #endif
        if !tapped { print("[vela-sound] item \(id) plays without its tap (no audio track or no tap)") }
    }

    private func prepareCrossfade(id: Int, url: URL, access: VelaMediaAuth?, start: Double, gain: Double, seconds: Double, at: Double) {
        let next = Self.item(url: url, access: access)
        let pending = PendingCrossfade(item: next, url: url, id: id, seconds: seconds, at: at, start: start)
        crossfade = pending
        let lane = SoundLane()
        spareLane = lane
        lane.context.start(id: id, gain: gain)
        // The incoming fade runs on the incoming item's own clock from where it starts, so it is set
        // before anything is prerolled: the item's first sample is already silent.
        lane.context.setFade(.into(start: start, seconds: seconds))
        lane.attach(next) { [weak self] tapped in
            guard let self, self.crossfade === pending else { return }
            self.tapAttached(id, tapped)
            self.readyCrossfade()
        }
        spare.pause()
        spare.removeAllItems()
        // A start at a host time needs a player that does not wait to minimize stalling.
        spare.automaticallyWaitsToMinimizeStalling = false
        spare.defaultRate = rate
        spare.insert(next, after: nil)
        pending.status = next.observe(\.status, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.readyCrossfade() } }
        }
        let lead = CMTime(seconds: max(0, at - Self.crossfadeLead), preferredTimescale: 1000)
        let token = player.addBoundaryTimeObserver(forTimes: [NSValue(time: lead)], queue: .main) { [weak self] in
            MainActor.assumeIsolated { self?.checkCrossfadeBoundary() }
        }
        pending.boundary = (player, token)
        readyCrossfade()
        checkCrossfadeBoundary()
    }

    /// Readies the incoming item: at its start, tapped and prerolled, so it starts on the host time given.
    private func readyCrossfade() {
        guard let pending = crossfade, pending.startHost == nil, pending.item.status == .readyToPlay else { return }
        if !pending.positioned {
            guard !pending.positioning else { return }
            pending.positioning = true
            pending.item.seek(to: CMTime(seconds: pending.start, preferredTimescale: 48000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        guard let self, self.crossfade === pending else { return }
                        pending.positioning = false
                        pending.positioned = true
                        self.readyCrossfade()
                    }
                }
            }
            return
        }
        if !pending.prerolled {
            guard !pending.prerolling, spareLane?.ready(pending.item) == true else { return }
            guard spare.status == .readyToPlay else {
                pending.prerolled = true
                scheduleCrossfade()
                return
            }
            pending.prerolling = true
            spare.preroll(atRate: rate) { [weak self] _ in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        guard let self, self.crossfade === pending else { return }
                        pending.prerolling = false
                        pending.prerolled = true
                        self.scheduleCrossfade()
                    }
                }
            }
            return
        }
        scheduleCrossfade()
    }

    /// The outgoing item is within the lead of `at`, or past it: time to fix the start.
    private func checkCrossfadeBoundary() {
        guard let pending = crossfade, pending.startHost == nil, let current = item, seekTarget == nil else { return }
        let now = current.currentTime().seconds
        if now.isFinite, now >= pending.at - Self.crossfadeLead - 0.01 { pending.due = true }
        scheduleCrossfade()
    }

    /// Fixes the crossfade on the host clock: the incoming player starts at the host time the outgoing
    /// item reaches `at`, and the outgoing tap's fade starts at `at` on its own item clock.
    private func scheduleCrossfade() {
        guard let pending = crossfade, pending.due, pending.startHost == nil, wantsPlay, let current = item,
              player.timeControlStatus == .playing, let timebase = current.timebase, CMTimebaseGetRate(timebase) > 0,
              pending.item.status == .readyToPlay, pending.positioned, pending.prerolled, spareLane?.ready(pending.item) == true else { return }
        let nowA = CMTimebaseGetTime(timebase).seconds
        // Normally fixed a second ahead; a late one (a late preload, a seek, a slow item) starts shortly,
        // though never sooner than the taps render ahead of what is heard (~0.4 s).
        let startA = max(pending.at, nowA + 0.6)
        let duration = current.duration.seconds
        // Too late for a fade: the incoming item starts when the outgoing one ends (finished()).
        if duration.isFinite, duration > 0, startA > duration - 0.5 { return }
        let hostClock = CMClockGetHostTimeClock()
        let startHost = CMSyncConvertTime(CMTime(seconds: startA, preferredTimescale: 1_000_000_000), from: timebase, to: hostClock)
        lane.context.setFade(.out(start: startA, seconds: pending.seconds))
        spare.setRate(rate, time: .invalid, atHostTime: startHost)
        pending.startHost = startHost
        pending.fadeEnd = startA + pending.seconds
        let work = DispatchWorkItem { [weak self] in MainActor.assumeIsolated { self?.crossfadeStarted() } }
        pending.started = work
        let wait = (startHost - CMClockGetTime(hostClock)).seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, wait), execute: work)
        #if DEBUG
        SoundCapture.shared.event("crossfade-scheduled", ["outgoing": loadID, "incoming": pending.id, "startHost": startHost.seconds,
                                                          "startA": startA, "nowA": nowA, "at": pending.at, "seconds": pending.seconds,
                                                          "incomingTime": pending.item.currentTime().seconds])
        #endif
    }

    /// Pause or a seek before the crossfade started: it is fixed again when playback reaches it.
    private func unscheduleCrossfade() {
        guard let pending = crossfade, pending.startHost != nil else { return }
        pending.started?.cancel()
        pending.started = nil
        pending.startHost = nil
        pending.fadeEnd = nil
        pending.due = false
        pending.prerolled = false
        pending.positioned = false
        spare.pause()
        lane.context.setFade(.none)
        readyCrossfade()
    }

    /// The incoming item is playing: it becomes the item JavaScript, Now Playing and the remote commands
    /// follow, and the outgoing one plays out its fade.
    private func crossfadeStarted() {
        guard let pending = crossfade, let outgoingItem = item, let incomingLane = spareLane else { return }
        let outgoing = player
        let outgoingLane = lane
        let outgoingID = loadID
        let incoming = spare
        if let boundary = pending.boundary { boundary.player.removeTimeObserver(boundary.token) }
        pending.status?.invalidate()
        crossfade = nil
        unbind(outgoing)
        detachItem()
        player = incoming
        lane = incomingLane
        spareLane = nil
        spare = Self.makePlayer()
        incoming.automaticallyWaitsToMinimizeStalling = true
        incoming.actionAtItemEnd = .pause
        bind(incoming)
        item = pending.item
        loadID = pending.id
        ready = pending.item.status == .readyToPlay
        failure = nil
        ended = false
        pendingStart = nil
        lastSent = nil
        clockSample = nil
        clockRunning = false
        observe(pending.item)
        var fading = Fading(player: outgoing, item: outgoingItem, id: outgoingID, lane: outgoingLane)
        if let fadeEnd = pending.fadeEnd {
            fading.boundary = outgoing.addBoundaryTimeObserver(forTimes: [NSValue(time: CMTime(seconds: fadeEnd + 0.05, preferredTimescale: 1000))],
                                                               queue: .main) { [weak self] in
                MainActor.assumeIsolated { self?.stopFading() }
            }
        }
        fading.ended = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: outgoingItem, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.stopFading() }
        }
        self.fading = fading
        #if DEBUG
        SoundCapture.shared.event("crossfade-started", ["outgoing": outgoingID, "incoming": pending.id])
        #endif
        holdNowPlaying()
        emit?(["id": pending.id, "type": "advanced", "position": position, "duration": duration])
        publish(tick: true)
    }

    /// The outgoing item ended before its crossfade could start: the incoming item starts now, unfaded.
    private func startCrossfadeAtEnd() -> Bool {
        guard let pending = crossfade, pending.startHost == nil, pending.item.status != .failed, spareLane?.ready(pending.item) == true else { return false }
        spareLane?.context.setFade(.none)
        pending.fadeEnd = nil
        let incoming = spare
        incoming.automaticallyWaitsToMinimizeStalling = true
        let rate = self.rate
        // Back to its start (anything prerolled was rendered silent for the fade).
        pending.item.seek(to: CMTime(seconds: pending.start, preferredTimescale: 48000), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
            DispatchQueue.main.async { incoming.playImmediately(atRate: rate) }
        }
        crossfadeStarted()
        stopFading()
        return true
    }

    /// Drops a crossfade that has not started.
    private func cancelCrossfade() {
        guard let pending = crossfade else { return }
        crossfade = nil
        if let boundary = pending.boundary { boundary.player.removeTimeObserver(boundary.token) }
        pending.status?.invalidate()
        pending.started?.cancel()
        spare.pause()
        spare.removeAllItems()
        spareLane = nil
        lane.context.setFade(.none)
    }

    /// Releases the outgoing item of a crossfade (its fade is over, or playback moved on).
    private func stopFading() {
        guard let fading else { return }
        self.fading = nil
        if let boundary = fading.boundary { fading.player.removeTimeObserver(boundary) }
        if let ended = fading.ended { NotificationCenter.default.removeObserver(ended) }
        fading.player.pause()
        fading.player.removeAllItems()
        #if DEBUG
        SoundCapture.shared.event("fading-released", ["id": fading.id])
        #endif
    }

    // MARK: Measurement capture (debug builds)

    /// Starts capturing every tap's output to `path` (.f32 and .json), silencing the output for the rest
    /// of the process; nil stops and writes the capture.
    func capture(path: String?) {
        #if DEBUG
        if let path {
            SoundCapture.shared.begin(path: path)
            [player, spare, fading?.player].compactMap { $0 }.forEach(Self.quiet)
            captureTimer?.invalidate()
            captureTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.sampleClocks() }
            }
        } else {
            captureTimer?.invalidate()
            captureTimer = nil
            SoundCapture.shared.finish()
        }
        #endif
    }

    #if DEBUG
    /// While capturing, a player's own volume (the taps already output silence). Not mute: a muted
    /// player feeds its taps silence after a few seconds.
    static var captureVolume: Float = 0

    private static func quiet(_ player: AVQueuePlayer) {
        player.isMuted = false
        player.volume = captureVolume
    }

    private func sampleClocks() {
        var entries: [(id: Int, role: String, item: AVPlayerItem)] = []
        if let item { entries.append((loadID, "playing", item)) }
        if let fading { entries.append((fading.id, "fading", fading.item)) }
        if let crossfade { entries.append((crossfade.id, "incoming", crossfade.item)) }
        SoundCapture.shared.clock(entries)
    }
    #endif

    // MARK: Background between items

    private func beginBridging() {
        endBridging()
        bridging = UIApplication.shared.beginBackgroundTask(withName: "vela-audio-next") { [weak self] in
            MainActor.assumeIsolated { self?.endBridging() }
        }
        bridgingTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.endBridging() }
        }
    }

    private func endBridging() {
        bridgingTimer?.invalidate()
        bridgingTimer = nil
        if bridging != .invalid {
            UIApplication.shared.endBackgroundTask(bridging)
            bridging = .invalid
        }
    }

    // MARK: Audio session

    @objc private nonisolated func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                guard self.item != nil else { return }
                switch type {
                case .began:
                    // The system paused the player (a call, an alarm, Siri); the store hears it as a pause.
                    self.interruptedWhilePlaying = self.wantsPlay
                    self.wantsPlay = false
                    self.publish()
                case .ended:
                    if options.contains(.shouldResume), self.interruptedWhilePlaying { self.play() }
                    self.interruptedWhilePlaying = false
                @unknown default:
                    break
                }
            }
        }
    }

    @objc private nonisolated func routeChanged(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        // Headphones unplugged, a Bluetooth speaker gone: pause rather than play out loud.
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                guard self.item != nil, self.wantsPlay else { return }
                self.pause()
            }
        }
    }
}
