// Music, audiobooks and podcasts (modules/vela-player/src/audio.ts): one AVPlayer for the whole app,
// not tied to a screen, so a queue keeps playing while the viewer browses, in the background and on the
// lock screen. It owns the system's media controls while it plays (Now Playing, Control Center, the
// lock screen, the Siri Remote, headsets and CarPlay); their commands go to JavaScript, which drives the
// queue exactly as the app's own buttons do. AVPlayer plays MP3, AAC and ALAC (MP4/M4A/M4B, ADTS),
// FLAC and WAV; the server transcodes anything else. Speed keeps pitch (spectral time-pitch).
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

    private let player = AVPlayer()
    private var item: AVPlayerItem?
    private var playerObserver: NSKeyValueObservation?
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
    private var interruptedWhilePlaying = false
    /// Background time between an item's end and the next one's start, while JavaScript asks for its plan.
    private var bridging: UIBackgroundTaskIdentifier = .invalid
    private var bridgingTimer: Timer?

    var systemMediaStyle: SystemMediaStyle { info?.spoken == true ? .spoken : .music }

    private override init() {
        super.init()
        player.actionAtItemEnd = .pause
        player.automaticallyWaitsToMinimizeStalling = true
        playerObserver = player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.publish() } }
        }
        player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.publish(tick: true) }
        }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
    }

    // MARK: Commands (from JavaScript)

    func load(id: Int, url: URL, access: VelaMediaAuth?, start: Double, rate: Double) {
        detachItem()
        loadID = id
        ready = false
        failure = nil
        ended = false
        wantsPlay = false
        lastSent = nil
        pendingStart = start > 0 ? start : nil
        self.rate = Float(rate > 0 ? rate : 1)
        let headers = access?.headers(for: url) ?? [:]
        let asset = AVURLAsset(url: url, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
        let item = AVPlayerItem(asset: asset)
        item.audioTimePitchAlgorithm = .spectral
        self.item = item
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
        player.defaultRate = self.rate
        player.replaceCurrentItem(with: item)
        SystemMediaControls.shared.claim(self)
        publish()
    }

    func play() {
        guard item != nil else { return }
        wantsPlay = true
        ended = false
        PlaybackAudioSession.activateForAudio(spoken: info?.spoken == true)
        // An item that starts later in the file waits until it is ready and there; anything else starts buffering now.
        if ready || pendingStart == nil {
            player.playImmediately(atRate: rate)
        }
        publish()
    }

    func pause() {
        wantsPlay = false
        player.pause()
        publish()
    }

    func seek(_ seconds: Double) {
        guard item != nil else { return }
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
                    self.publish(tick: true)
                }
            }
        }
    }

    func setRate(_ value: Double) {
        rate = Float(value > 0 ? value : 1)
        player.defaultRate = rate
        if player.rate != 0 { player.rate = rate }
        publish(tick: true)
    }

    func unload() {
        wantsPlay = false
        player.pause()
        detachItem()
        player.replaceCurrentItem(with: nil)
        endBridging()
        SystemMediaControls.shared.release(self)
    }

    func setNowPlaying(_ value: NowPlaying?) {
        let restyled = (value?.spoken == true) != (info?.spoken == true)
        info = value
        guard item != nil else { return }
        if restyled { SystemMediaControls.shared.claim(self) }
        updateNowPlaying()
    }

    // MARK: SystemMediaOwner

    func systemMediaCommand(_ command: SystemMediaCommand) {
        var body: [String: Any] = ["id": loadID, "type": "remote"]
        switch command {
        case .play: body["command"] = "play"
        case .pause: body["command"] = "pause"
        case .toggle: body["command"] = "toggle"
        case .next: body["command"] = "next"
        case .previous: body["command"] = "previous"
        case .skip(let seconds): body["command"] = "skip"; body["seconds"] = seconds
        case .seek(let position): body["command"] = "seek"; body["seconds"] = position
        }
        emit?(body)
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
                            if self.wantsPlay { self.player.playImmediately(atRate: self.rate) }
                            self.publish(tick: true)
                        }
                    }
                }
            } else if wantsPlay, player.rate == 0 {
                player.playImmediately(atRate: rate)
            }
            publish()
        case .failed:
            fail(changed.error)
        default:
            publish()
        }
    }

    private func finished() {
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
        guard item != nil else { return }
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

    private func buffered() -> [[String: Double]] {
        (item?.loadedTimeRanges ?? []).compactMap { value in
            let range = value.timeRangeValue
            let start = range.start.seconds, end = range.end.seconds
            return start.isFinite && end.isFinite ? ["startSeconds": start, "endSeconds": end] : nil
        }
    }

    private func updateNowPlaying() {
        guard item != nil else { return }
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
            audio: true
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
    }

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
