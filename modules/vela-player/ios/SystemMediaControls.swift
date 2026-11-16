// The system's media controls for the one player that owns them: MPRemoteCommandCenter (the Siri
// Remote's and Control Center's play, pause, skip and scrub) and MPNowPlayingInfoCenter (what is playing,
// where, at what rate). Ambient players and previews never claim them. A command arrives at the owner
// as one of the contract's commands, so it takes the same path as the chrome's (a skip on a server path
// is still a session command).
import Foundation
import MediaPlayer
import UIKit

/// What the owner is asked to do.
enum SystemMediaCommand {
    case play
    case pause
    case toggle
    case skip(seconds: Double)
    case seek(to: Double)
}

/// What the owner says about itself for Now Playing.
struct NowPlayingState: Equatable {
    var title: String
    var subtitle: String?
    var artworkURL: URL?
    var duration: Double?
    var position: Double
    var playing: Bool
}

protocol SystemMediaOwner: AnyObject {
    func systemMediaCommand(_ command: SystemMediaCommand)
}

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

    /// Makes `owner` the player the system's controls reach.
    func claim(_ owner: SystemMediaOwner) {
        self.owner = owner
        ownerID = ObjectIdentifier(owner)
        guard registrations.isEmpty else {
            return
        }
        let center = MPRemoteCommandCenter.shared()
        center.skipForwardCommand.preferredIntervals = [NSNumber(value: skipInterval)]
        center.skipBackwardCommand.preferredIntervals = [NSNumber(value: skipInterval)]
        register(center.playCommand) { _ in .play }
        register(center.pauseCommand) { _ in .pause }
        register(center.togglePlayPauseCommand) { _ in .toggle }
        register(center.skipForwardCommand) { [skipInterval] _ in .skip(seconds: skipInterval) }
        register(center.skipBackwardCommand) { [skipInterval] _ in .skip(seconds: -skipInterval) }
        register(center.changePlaybackPositionCommand) { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return nil
            }
            return .seek(to: event.positionTime)
        }
    }

    /// Gives the controls up, if `owner` holds them, and clears Now Playing.
    func release(_ owner: SystemMediaOwner) {
        guard ownerID == ObjectIdentifier(owner) else {
            return
        }
        self.owner = nil
        ownerID = nil
        for registration in registrations {
            registration.command.removeTarget(registration.target)
            registration.command.isEnabled = false
        }
        registrations = []
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
            MPNowPlayingInfoPropertyPlaybackRate: state.playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
        ]
        info[MPMediaItemPropertyArtist] = state.subtitle
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
        let expected = old.position + (old.playing ? elapsed : 0)
        return old.title != new.title || old.subtitle != new.subtitle || old.artworkURL != new.artworkURL
            || old.duration != new.duration || old.playing != new.playing || abs(new.position - expected) > 5
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

    private func register(
        _ command: MPRemoteCommand, _ translate: @escaping (MPRemoteCommandEvent) -> SystemMediaCommand?
    ) {
        command.isEnabled = true
        let target = command.addTarget { [weak self] event in
            guard let owner = self?.owner, let action = translate(event) else {
                return .noActionableNowPlayingItem
            }
            owner.systemMediaCommand(action)
            return .success
        }
        registrations.append((command, target))
    }
}
