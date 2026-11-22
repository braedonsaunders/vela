// The viewer's audio and picture delivery choices, kept per device and applied to every full-screen load.
// The player's audio menu changes them with an `outputPreference` command ("surround=lossless").
import AetherEngine
import Foundation

struct PlaybackPreferences: Equatable {
    /// How a lossless or non-streamable surround track (TrueHD, DTS-HD MA, PCM) leaves the device.
    enum Surround: String, CaseIterable {
        /// FLAC to AVPlayer, multichannel LPCM on the link: bit-perfect 7.1 at the source rate. Needs an AVR
        /// over HDMI or a receiver/soundbar on eARC; a legacy-ARC soundbar gets a stereo downmix.
        case lossless
        /// E-AC-3 at 128 kbit/s per channel (5.1 at most): lossy, but surround on every soundbar, legacy ARC too.
        case compatible
    }
    /// TrueHD Atmos objects and DTS:X heights rendered into a speaker bed with heights, which tvOS carries
    /// to the receiver as Dolby MAT (`objectAudioRendering`). Off keeps the lossless 7.1 channel presentation.
    enum Immersive: String, CaseIterable { case on, off }
    /// `base-layer` shows the HDR10/HLG base of a Dolby Vision title (for a remux whose Dolby Vision is broken).
    enum DolbyVision: String, CaseIterable {
        case auto
        case baseLayer = "base-layer"
    }

    var surround: Surround = .lossless
    var immersive: Immersive = .on
    /// The bed object audio is rendered into; it should name the speakers the receiver drives.
    var speakerLayout: SpatialSpeakerLayout = .l714
    var dolbyVision: DolbyVision = .auto

    private static let key = "vela.playbackPreferences"
    private static var store: UserDefaults { .standard }

    static var current: PlaybackPreferences {
        get {
            var value = PlaybackPreferences()
            for (name, setting) in store.dictionary(forKey: key) as? [String: String] ?? [:] {
                _ = value.set(name, setting)
            }
            return value
        }
        set { store.set(newValue.values, forKey: key) }
    }

    /// The settings this build can honour, in menu order. Object audio needs the engine's trait and OS 26.
    static var available: [String] {
        var names = ["surround"]
        if objectAudioBuiltIn {
            names += ["immersive", "speakerLayout"]
        }
        names.append("dolbyVision")
        return names
    }

    static var objectAudioBuiltIn: Bool {
        guard AetherEngine.OptionalComponent.trueHDObjectAudio.isBuiltIn
                || AetherEngine.OptionalComponent.dtsxObjectAudio.isBuiltIn else { return false }
        if #available(iOS 26.0, tvOS 26.0, macOS 26.0, *) { return true }
        return false
    }

    var values: [String: String] {
        ["surround": surround.rawValue, "immersive": immersive.rawValue,
         "speakerLayout": speakerLayout.rawValue, "dolbyVision": dolbyVision.rawValue]
    }

    /// Applies one "name=value" choice; false when the name or value is unknown.
    mutating func apply(_ assignment: String) -> Bool {
        let parts = assignment.split(separator: "=", maxSplits: 1).map(String.init)
        guard parts.count == 2 else { return false }
        return set(parts[0], parts[1])
    }

    private mutating func set(_ name: String, _ value: String) -> Bool {
        switch name {
        case "surround": guard let next = Surround(rawValue: value) else { return false }; surround = next
        case "immersive": guard let next = Immersive(rawValue: value) else { return false }; immersive = next
        case "speakerLayout": guard let next = SpatialSpeakerLayout(rawValue: value) else { return false }; speakerLayout = next
        case "dolbyVision": guard let next = DolbyVision(rawValue: value) else { return false }; dolbyVision = next
        default: return false
        }
        return true
    }

    /// The engine options these choices set. Previews and multiview tiles are muted pictures: they keep the
    /// engine's light defaults and never render object audio.
    func configure(_ options: inout LoadOptions, fullScreen: Bool) {
        guard fullScreen else { return }
        options.audioBridgeMode = surround == .lossless ? .lossless : .surroundCompat
        options.objectAudioRendering = immersive == .on && Self.objectAudioBuiltIn ? .render(speakerLayout) : .off
        options.dolbyVisionHandling = dolbyVision == .baseLayer ? .baseLayerOnly : .automatic
    }
}
