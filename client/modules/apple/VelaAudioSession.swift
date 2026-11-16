// The audio session a film needs: playback, movie mode, and multichannel output when the
// HDMI sink takes it (a receiver gets up to 7.1 PCM; a TV gets tvOS's downmix).
import AVFoundation

enum VelaAudioSession {
    static func activate() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        try? session.setSupportsMultichannelContent(true)
        try? session.setActive(true)
        let channels = min(8, session.maximumOutputNumberOfChannels)
        try? session.setPreferredOutputNumberOfChannels(channels)
    }
}
