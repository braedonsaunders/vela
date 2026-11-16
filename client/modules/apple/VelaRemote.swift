// The Siri Remote's media buttons (Play/Pause, skip) for the player on screen, through
// MPRemoteCommandCenter. Arrows and Select stay the focus engine's (Exact's chrome).
import MediaPlayer

final class VelaRemote {
    enum Action {
        case toggle
        case play
        case pause
        case skip(Double)
    }

    static let shared = VelaRemote()

    private weak var player: VelaPlayerView?
    private var registrations: [(command: MPRemoteCommand, target: Any)] = []

    func attach(_ view: VelaPlayerView) {
        player = view
        guard registrations.isEmpty else {
            return
        }
        let center = MPRemoteCommandCenter.shared()
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.preferredIntervals = [10]
        register(center.togglePlayPauseCommand, .toggle)
        register(center.playCommand, .play)
        register(center.pauseCommand, .pause)
        register(center.skipForwardCommand, .skip(10))
        register(center.skipBackwardCommand, .skip(-10))
    }

    func detach(_ view: VelaPlayerView) {
        guard player === view else {
            return
        }
        player = nil
        for registration in registrations {
            registration.command.removeTarget(registration.target)
        }
        registrations = []
    }

    private func register(_ command: MPRemoteCommand, _ action: Action) {
        command.isEnabled = true
        let target = command.addTarget { [weak self] _ in
            guard let player = self?.player else {
                return .noActionableNowPlayingItem
            }
            player.remote(action)
            return .success
        }
        registrations.append((command, target))
    }
}
