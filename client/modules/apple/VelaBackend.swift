// What every playback backend offers the player view, and what it reports back.
import Foundation

/// A backend's state, which the view turns into the web engine's snapshot (client/player/model.ts).
struct VelaReadout {
    enum State: String {
        case loading, playing, paused, buffering, ended, failed
    }

    var state = State.loading
    var position: Double = 0
    var duration: Double?
    /// The media time read ahead to.
    var bufferedEnd: Double?
    var throughputBps: Double?
    var transferredBytes: Int64?
    var failure: String?
    /// model.ts FailureKind: network, source, decoder.
    var failureKind = "source"
    var videoCodec: String?
    var width = 0
    var height = 0
    /// sdr, hdr10, hlg or dv.
    var dynamicRange: String?
    /// How the audio is rendered, for the info card ("truehd → PCM", "eac3").
    var audioRoute: String?
    /// model.ts preparation: media-metadata, initial-buffer or nil.
    var preparation: String? = "media-metadata"
}

protocol VelaBackend: AnyObject {
    /// Called on the main thread whenever the readout changes meaningfully.
    var onChange: (() -> Void)? { get set }
    var readout: VelaReadout { get }
    /// The media time now, in seconds.
    var currentTime: Double { get }
    func play()
    func pause()
    func seek(to seconds: Double)
    func setVolume(_ volume: Float, muted: Bool)
    /// Stops for good: no further callbacks, requests or frames.
    func stop()
}
