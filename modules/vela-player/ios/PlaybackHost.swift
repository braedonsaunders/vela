import Foundation

/// What the owner is asked to do.
enum SystemMediaCommand: Equatable {
    case play
    case pause
    case toggle
    case skip(seconds: Double)
    case seek(to: Double)
    case next
    case previous
    case enableAudio(trackId: String)
    case enableSubtitle(trackId: String)
    case disableSubtitle
}

/// Which remote commands an owner takes: a video's 10-second skips, music's next and previous, or spoken
/// word's 15/30-second skips (with next and previous for the headset's double and triple press).
enum SystemMediaStyle: Equatable {
    case video
    case music
    case spoken
}

/// One audio or subtitle track published through Now Playing.
struct NowPlayingTrack: Equatable {
    let id: String
    let name: String
    let language: String?
    let codec: String?
    let channels: Int?
    let forced: Bool
    let hearingImpaired: Bool
}

/// The video track choices currently available and selected, scoped to one session and source generation.
struct NowPlayingLanguages: Equatable {
    let sessionId: String
    let sourceGeneration: Int
    let audioTracks: [NowPlayingTrack]
    let subtitleTracks: [NowPlayingTrack]
    let selectedAudioTrackId: String?
    let selectedSubtitleTrackId: String?
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
    /// The player's clock is moving. A queue player's next item stands still for a moment after it
    /// takes over; Now Playing must not extrapolate over that, or it stays ahead for the whole track.
    var clockRunning = true
    /// Audio and subtitle choices for video playback; omitted when audio playback owns Now Playing.
    var languages: NowPlayingLanguages? = nil

    /// A change of title, rate, duration or language choices, or a jump the system's extrapolation would not reach.
    static func differs(_ old: NowPlayingState, _ new: NowPlayingState, elapsed: TimeInterval) -> Bool {
        let expected = old.position + (old.playing && old.clockRunning ? elapsed * old.rate : 0)
        return old.title != new.title || old.subtitle != new.subtitle || old.album != new.album || old.artworkURL != new.artworkURL
            || old.duration != new.duration || old.playing != new.playing || old.rate != new.rate || old.audio != new.audio
            || old.clockRunning != new.clockRunning || old.languages != new.languages
            || abs(new.position - expected) > (new.audio ? 2 : 5)
    }
}

@MainActor
protocol SystemMediaOwner: AnyObject {
    @discardableResult
    func systemMediaCommand(_ command: SystemMediaCommand) -> Bool
    var systemMediaStyle: SystemMediaStyle { get }
}

extension SystemMediaOwner {
    var systemMediaStyle: SystemMediaStyle { .video }
}


/// A test launch silences every player (`-VelaSilent YES` among the launch arguments): a simulator
/// plays through the Mac's speakers, and the app's own mute is the viewer's to undo.
enum PlaybackSilence {
    static let on = UserDefaults.standard.bool(forKey: "VelaSilent")
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
