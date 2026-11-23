// The system's media controls for the one player that owns them: MPRemoteCommandCenter (the Siri
// Remote's and Control Center's play, pause, skip and scrub) and MPNowPlayingInfoCenter (what is playing,
// where, at what rate). Ambient players and previews never claim them. A command arrives at the owner
// as one of the contract's commands, so it takes the same path as the chrome's (a skip on a server path
// is still a session command).
import Foundation
import MediaPlayer
import UIKit

@MainActor
final class SystemMediaControls {
    static let shared = SystemMediaControls()

    private weak var owner: SystemMediaOwner?
    /// The owner's identity, which a release from its deinit can still match (its weak reference is gone there).
    private var ownerID: ObjectIdentifier?
    private var registrations: [(command: MPRemoteCommand, target: Any)] = []
    private var published: NowPlayingState?
    private var publishedAt = Date.distantPast
    private var artworkFor: URL?
    private let skipInterval = 10.0
    /// While set, the remote's play/pause belongs to the app (an alert toast's action), not to the player:
    /// its play, pause and toggle commands call this instead. tvOS delivers that button as a remote command to
    /// the Now Playing app, so JavaScript never sees it as a press while a player owns the controls.
    var playPauseClaim: (() -> Void)?

    /// The commands registered, for the style of the owner they were registered for.
    private var registeredStyle: SystemMediaStyle?

    /// Makes `owner` the player the system's controls reach, with the commands its style takes. An owner
    /// whose style changed (music, then an audiobook) claims again to swap them.
    func claim(_ owner: SystemMediaOwner) {
        self.owner = owner
        ownerID = ObjectIdentifier(owner)
        let style = owner.systemMediaStyle
        if registeredStyle == style, !registrations.isEmpty {
            return
        }
        unregister()
        registeredStyle = style
        let center = MPRemoteCommandCenter.shared()
        register(center.playCommand) { _ in .play }
        register(center.pauseCommand) { _ in .pause }
        register(center.togglePlayPauseCommand) { _ in .toggle }
        register(center.changePlaybackPositionCommand) { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return nil
            }
            return .seek(to: event.positionTime)
        }
        let skips: (back: Double, forward: Double)? = switch style {
        case .video: (skipInterval, skipInterval)
        case .music: nil
        case .spoken: (15, 30)
        }
        if let skips {
            center.skipForwardCommand.preferredIntervals = [NSNumber(value: skips.forward)]
            center.skipBackwardCommand.preferredIntervals = [NSNumber(value: skips.back)]
            register(center.skipForwardCommand) { _ in .skip(seconds: skips.forward) }
            register(center.skipBackwardCommand) { _ in .skip(seconds: -skips.back) }
        }
        if style != .video {
            register(center.nextTrackCommand) { _ in .next }
            register(center.previousTrackCommand) { _ in .previous }
        }
    }

    private func unregister() {
        for registration in registrations {
            registration.command.removeTarget(registration.target)
            registration.command.isEnabled = false
        }
        registrations = []
        registeredStyle = nil
    }

    /// Gives the controls up, if `owner` holds them, and clears Now Playing.
    func release(_ owner: SystemMediaOwner) {
        guard ownerID == ObjectIdentifier(owner) else {
            return
        }
        self.owner = nil
        ownerID = nil
        unregister()
        published = nil
        artworkFor = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    /// Publishes the owner's state when it changed in a way the system cannot extrapolate.
    func update(_ state: NowPlayingState, from owner: SystemMediaOwner) {
        guard self.owner === owner else {
            return
        }
        let elapsed = Date().timeIntervalSince(publishedAt)
        if let previous = published, !Self.differs(previous, state, elapsed: elapsed) {
            return
        }
        published = state
        publishedAt = Date()
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: state.title,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: state.position,
            MPNowPlayingInfoPropertyPlaybackRate: state.playing ? state.rate : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: state.rate,
            MPNowPlayingInfoPropertyMediaType: (state.audio ? MPNowPlayingInfoMediaType.audio : .video).rawValue,
        ]
        info[MPMediaItemPropertyArtist] = state.subtitle
        info[MPMediaItemPropertyAlbumTitle] = state.album
        info[MPMediaItemPropertyPlaybackDuration] = state.duration
        let shownArtwork = MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork]
        if let shownArtwork, artworkFor == state.artworkURL {
            info[MPMediaItemPropertyArtwork] = shownArtwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        if let url = state.artworkURL, url != artworkFor {
            artworkFor = url
            loadArtwork(url)
        }
    }

    /// A change of title, rate or duration, or a jump the system's extrapolation would not reach.
    private static func differs(_ old: NowPlayingState, _ new: NowPlayingState, elapsed: TimeInterval) -> Bool {
        let expected = old.position + (old.playing ? elapsed * old.rate : 0)
        return old.title != new.title || old.subtitle != new.subtitle || old.album != new.album || old.artworkURL != new.artworkURL
            || old.duration != new.duration || old.playing != new.playing || old.rate != new.rate || old.audio != new.audio
            || abs(new.position - expected) > (new.audio ? 2 : 5)
    }

    private func loadArtwork(_ url: URL) {
        var request = URLRequest(url: url)
        for (name, value) in VelaMediaAccessStore.headers(for: url) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else {
                return
            }
            DispatchQueue.main.async {
                let center = MPNowPlayingInfoCenter.default()
                guard let self, self.artworkFor == url, var info = center.nowPlayingInfo else {
                    return
                }
                info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                center.nowPlayingInfo = info
            }
        }.resume()
    }

    /// The remote's play/pause button arrives as toggle, or as play or pause by the state Now Playing shows.
    private static func playPauseButton(_ action: SystemMediaCommand) -> Bool {
        switch action {
        case .toggle, .play, .pause: return true
        default: return false
        }
    }

    private func register(
        _ command: MPRemoteCommand, _ translate: @escaping (MPRemoteCommandEvent) -> SystemMediaCommand?
    ) {
        command.isEnabled = true
        let target = command.addTarget { [weak self] event in
            guard let owner = self?.owner, let action = translate(event) else {
                return .noActionableNowPlayingItem
            }
            if let claim = self?.playPauseClaim, Self.playPauseButton(action) {
                claim()
                return .success
            }
            owner.systemMediaCommand(action)
            return .success
        }
        registrations.append((command, target))
    }
}

/// The audio session for Aether playback, including multichannel HDMI output, and for music and spoken word.
enum PlaybackAudioSession {
    /// Long-form audio (AirPlay 2 routes it as such); spoken word pauses, rather than ducks, for other speech.
    static func activateForAudio(spoken: Bool) {
        let session = AVAudioSession.sharedInstance()
        if (try? session.setCategory(.playback, mode: spoken ? .spokenAudio : .default, policy: .longFormAudio, options: [])) == nil {
            try? session.setCategory(.playback, mode: .default, options: [])
        }
        try? session.setActive(true)
    }

    static func activate() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        #if os(tvOS)
        try? session.setSupportsMultichannelContent(true)
        #endif
        try? session.setActive(true)
        try? session.setPreferredOutputNumberOfChannels(min(8, session.maximumOutputNumberOfChannels))
    }
}
