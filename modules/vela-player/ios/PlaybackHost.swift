import Foundation

/// What the owner is asked to do.
enum SystemMediaCommand {
    case play
    case pause
    case toggle
    case skip(seconds: Double)
    case seek(to: Double)
    case next
    case previous
}

/// Which remote commands an owner takes: a video's 10-second skips, music's next and previous, or spoken
/// word's 15/30-second skips (with next and previous for the headset's double and triple press).
enum SystemMediaStyle: Equatable {
    case video
    case music
    case spoken
}

/// What the owner says about itself for Now Playing.
struct NowPlayingState: Equatable {
    var title: String
    var subtitle: String?
    var artworkURL: URL?
    var duration: Double?
    var position: Double
    var playing: Bool
    var album: String? = nil
    /// The speed while playing (Now Playing extrapolates the position at it).
    var rate: Double = 1
    var audio = false
}

@MainActor
protocol SystemMediaOwner: AnyObject {
    func systemMediaCommand(_ command: SystemMediaCommand)
    var systemMediaStyle: SystemMediaStyle { get }
}

extension SystemMediaOwner {
    var systemMediaStyle: SystemMediaStyle { .video }
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
