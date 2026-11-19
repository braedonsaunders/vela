import Foundation

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

@MainActor
protocol SystemMediaOwner: AnyObject {
    func systemMediaCommand(_ command: SystemMediaCommand)
}


@MainActor
protocol PlaybackHost: AnyObject {
    var attached: Bool { get }
    func makeRendering(retainPausedPicture: Bool) -> PlaybackRendering
    func setBackground(clear: Bool)
    func keepAwake(_ on: Bool)
    func activateAudio()
    func claim(_ owner: SystemMediaOwner)
    func release(_ owner: SystemMediaOwner)
    func updateNowPlaying(_ state: NowPlayingState, owner: SystemMediaOwner)
}
