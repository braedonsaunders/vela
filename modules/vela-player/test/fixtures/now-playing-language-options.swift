// Compiled with ../../ios/PlaybackHost.swift, PlaybackPlan.swift, PlaybackRendering.swift,
// PlayerReport.swift, PlayerState.swift, SubtitleAppearance.swift and NowPlayingLanguageOptions.swift
// by now-playing-language-options.test.ts.
import Foundation
import MediaPlayer

protocol PlaybackRendering {}
struct PlaybackPreferences {
    static let current = PlaybackPreferences()
    static let available: [String] = []
    let values: [String: String] = [:]
}

func check(_ ok: Bool, _ message: String) {
    if !ok {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

func makePlan(
    sessionId: String = "sess:1/alpha",
    sourceGeneration: Int = 2,
    original: Bool = true,
    selectedAudio: String? = "aud:1",
    selectedSubtitle: String? = nil,
    audioTracks: [[String: Any]]? = nil,
    subtitleTracks: [[String: Any]]? = nil
) -> VelaPlan {
    let defaultAudio: [[String: Any]] = [
        ["id": "aud:1", "name": "English", "language": "en", "codec": "truehd", "channels": 8, "streamIndex": 1],
        ["id": "aud:2", "name": "English", "language": "en", "codec": "ac3", "channels": 6, "streamIndex": 2],
        ["id": "aud:3", "name": "French", "language": "fr", "codec": "aac", "channels": 2, "streamIndex": 3],
    ]
    let defaultSubtitles: [[String: Any]] = [
        ["id": "sub-1", "name": "English", "language": "en", "codec": "subrip", "streamIndex": 4],
        ["id": "sub-2", "name": "English", "language": "en", "codec": "hdmv_pgs_subtitle", "streamIndex": 5, "forced": true],
        ["id": "sub-3", "name": "English", "language": "en", "codec": "subrip", "streamIndex": 6, "hearingImpaired": true],
        ["id": "sub-4", "name": "Spanish (Forced)", "language": "es", "codec": "ass", "forced": true, "delivery": ["kind": "external", "url": "/sub.ass"]],
    ]
    var obj: [String: Any] = [
        "sessionId": sessionId,
        "revision": 1,
        "sourceGeneration": sourceGeneration,
        "seekGeneration": 0,
        "positionSeconds": 0,
        "paths": [[
            "id": original ? "orig" : "hls",
            "kind": original ? "direct" : "transcode",
            "transport": original ? "file" : "hls",
            "readiness": "ready",
            "original": original,
        ]],
        "selectedPathId": original ? "orig" : "hls",
        "audioTracks": audioTracks ?? defaultAudio,
        "subtitleTracks": subtitleTracks ?? defaultSubtitles,
    ]
    if let selectedAudio { obj["selectedAudioTrackId"] = selectedAudio }
    if let selectedSubtitle { obj["selectedSubtitleTrackId"] = selectedSubtitle }
    guard let plan = VelaPlan.decode(obj) else {
        fatalError("Invalid test plan")
    }
    return plan
}

@main
struct NowPlayingLanguageOptionsProbe {
    static func main() {
        // 1. Scoped identifier round-trip with reserved characters.
        let encoded = NowPlayingLanguageOptions.encodeIdentifier(
            sessionId: "sess:1%20/alpha",
            sourceGeneration: 7,
            kind: .subtitle,
            trackId: "mpv-sub-42:raw%1"
        )
        let decoded = NowPlayingLanguageOptions.decodeIdentifier(encoded)
        check(decoded?.sessionId == "sess:1%20/alpha", "sessionId round-trip")
        check(decoded?.sourceGeneration == 7, "sourceGeneration round-trip")
        check(decoded?.kind == .subtitle, "kind round-trip")
        check(decoded?.trackId == "mpv-sub-42:raw%1", "trackId round-trip")
        check(NowPlayingLanguageOptions.decodeIdentifier("bogus") == nil, "rejects malformed identifier")
        check(NowPlayingLanguageOptions.decodeIdentifier(nil) == nil, "rejects nil identifier")

        // 2. Snapshot track reuse: observed audio fallback + engine-discovered embedded subtitles.
        let plan = makePlan(selectedAudio: nil, selectedSubtitle: nil)
        let report = PlayerReport(snapshot: { _ in }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in })
        report.adopt(plan, newSession: true)
        var state = PlayerState()
        state.tracks = [
            ["type": "audio", "id": Int64(1), "ff-index": Int64(1)],
            ["type": "audio", "id": Int64(2), "ff-index": Int64(2)],
            // ff-index 4 is already in plan.subtitleTracks -> must not duplicate.
            ["type": "sub", "id": Int64(1), "ff-index": Int64(4), "lang": "eng", "title": "English"],
            // Engine-only embedded subtitle (ff-index 9 not in plan) -> must be included as mpv-sub-7.
            ["type": "sub", "id": Int64(7), "ff-index": Int64(9), "lang": "jpn", "title": "Japanese", "codec": "ass"],
            // Undetermined language embedded subtitle.
            ["type": "sub", "id": Int64(8), "ff-index": Int64(10), "lang": "und", "title": "Commentary"],
            // External track in mpv must not be re-added as mpv-sub.
            ["type": "sub", "id": Int64(9), "external": true, "lang": "fr", "title": "Sidecar"],
        ]
        state.audioId = 2 // ff-index 2 -> aud:2

        let languages = NowPlayingLanguageOptions.languages(for: plan, state: state, report: report)
        check(languages.selectedAudioTrackId == "aud:2", "falls back to observed audio track when report has none")
        check(languages.selectedSubtitleTrackId == nil, "subtitles start Off")
        check(languages.subtitleTracks.map(\.id) == ["sub-1", "sub-2", "sub-3", "sub-4", "mpv-sub-7", "mpv-sub-8"],
              "includes plan subtitles plus unmapped embedded subtitles only: got \(languages.subtitleTracks.map(\.id))")

        // On non-original HLS paths, engine-discovered mpv-sub tracks are excluded.
        let hlsPlan = makePlan(original: false, selectedAudio: "aud:1", selectedSubtitle: "sub-1")
        let hlsReport = PlayerReport(snapshot: { _ in }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in })
        hlsReport.adopt(hlsPlan, newSession: true)
        let hlsLanguages = NowPlayingLanguageOptions.languages(for: hlsPlan, state: state, report: hlsReport)
        check(hlsLanguages.subtitleTracks.map(\.id) == ["sub-1", "sub-2", "sub-3", "sub-4"],
              "HLS path omits mpv-sub tracks")

        // 3. Groups, display names, characteristics, and Off omission.
        let builtOff = NowPlayingLanguageOptions.build(languages)
        check(builtOff.available.count == 2, "publishes audio and subtitle groups")
        let audioGroup = builtOff.available[0]
        let subGroup = builtOff.available[1]
        check(audioGroup.allowEmptySelection == false, "audio group disallows empty selection")
        check(subGroup.allowEmptySelection == true, "subtitle group allows empty selection")
        check(audioGroup.defaultLanguageOption?.identifier == audioGroup.languageOptions[1].identifier,
              "audio default matches selected observed track")
        check(subGroup.defaultLanguageOption?.identifier == nil, "subtitle default has no track identifier")
        check(builtOff.current.count == 1 && builtOff.current[0].languageOptionType == .audible,
              "current omits subtitle when Off")

        // Same-language disambiguation & characteristics.
        let audioNames = audioGroup.languageOptions.map { $0.displayName ?? "" }
        check(audioNames[0] == "English · TrueHD · 7.1", "distinguishes English TrueHD 7.1: got \(audioNames[0])")
        check(audioNames[1] == "English · AC3 · 5.1", "distinguishes English AC3 5.1: got \(audioNames[1])")
        check(audioNames[2] == "French", "single-language track stays clean: got \(audioNames[2])")

        let subNames = subGroup.languageOptions.map { $0.displayName ?? "" }
        check(subNames[0] == "English · SRT", "English regular sub: got \(subNames[0])")
        check(subNames[1] == "English · Forced · PGS", "English forced PGS sub: got \(subNames[1])")
        check(subNames[2] == "English · SDH · SRT", "English SDH sub: got \(subNames[2])")
        check(subNames[3] == "Spanish (Forced)", "does not duplicate Forced already in name: got \(subNames[3])")
        check(subGroup.languageOptions[1].languageOptionCharacteristics?.contains(MPLanguageOptionCharacteristicContainsOnlyForcedSubtitles) == true,
              "forced subtitle sets forced characteristic")
        check(subGroup.languageOptions[2].languageOptionCharacteristics?.contains(MPLanguageOptionCharacteristicTranscribesSpokenDialog) == true,
              "SDH subtitle sets accessibility characteristic")
        check(subGroup.languageOptions[5].languageTag == "und", "und language maps to und BCP-47 tag")

        // 4. Enable command validation.
        check(NowPlayingLanguageOptions.enableCommand(for: audioGroup.languageOptions[0], in: languages) == .enableAudio(trackId: "aud:1"),
              "enables valid audio track")
        check(NowPlayingLanguageOptions.enableCommand(for: subGroup.languageOptions[4], in: languages) == .enableSubtitle(trackId: "mpv-sub-7"),
              "enables valid embedded subtitle track")

        // Automatic options are rejected cleanly (commandFailed), even if their identifier matches.
        final class FakeAutomaticOption: MPNowPlayingInfoLanguageOption {
            let autoLegible: Bool
            let autoAudible: Bool
            init(type: MPNowPlayingInfoLanguageOptionType, identifier: String, autoLegible: Bool = false, autoAudible: Bool = false) {
                self.autoLegible = autoLegible
                self.autoAudible = autoAudible
                super.init(type: type, languageTag: "und", characteristics: nil, displayName: "Auto", identifier: identifier)
            }
            override func isAutomaticLegibleLanguageOption() -> Bool { autoLegible }
            override func isAutomaticAudibleLanguageOption() -> Bool { autoAudible }
        }
        let emptyIdOption = MPNowPlayingInfoLanguageOption(
            type: .legible,
            languageTag: "und",
            characteristics: nil,
            displayName: "",
            identifier: ""
        )
        let realAutoLegible = FakeAutomaticOption(type: .legible, identifier: subGroup.languageOptions[0].identifier!, autoLegible: true)
        let realAutoAudible = FakeAutomaticOption(type: .audible, identifier: audioGroup.languageOptions[0].identifier!, autoAudible: true)
        check(NowPlayingLanguageOptions.enableCommand(for: realAutoLegible, in: languages) == nil,
              "rejects automatic legible option on enable")
        check(NowPlayingLanguageOptions.enableCommand(for: realAutoAudible, in: languages) == nil,
              "rejects automatic audible option on enable")
        check(NowPlayingLanguageOptions.disableCommand(for: realAutoLegible, in: languages) == nil,
              "rejects automatic legible option on disable")
        check(NowPlayingLanguageOptions.enableCommand(for: emptyIdOption, in: languages) == nil,
              "rejects empty identifier option")

        // Stale session or source generation rejected.
        let olderSession = NowPlayingLanguages(
            sessionId: "sess:old",
            sourceGeneration: languages.sourceGeneration,
            audioTracks: languages.audioTracks,
            subtitleTracks: languages.subtitleTracks,
            selectedAudioTrackId: "aud:1",
            selectedSubtitleTrackId: "sub-1"
        )
        let olderGen = NowPlayingLanguages(
            sessionId: languages.sessionId,
            sourceGeneration: languages.sourceGeneration - 1,
            audioTracks: languages.audioTracks,
            subtitleTracks: languages.subtitleTracks,
            selectedAudioTrackId: "aud:1",
            selectedSubtitleTrackId: "sub-1"
        )
        let oldSessionOpt = NowPlayingLanguageOptions.build(olderSession).available[0].languageOptions[0]
        let oldGenOpt = NowPlayingLanguageOptions.build(olderGen).available[1].languageOptions[0]
        check(NowPlayingLanguageOptions.enableCommand(for: oldSessionOpt, in: languages) == nil,
              "rejects option from previous session")
        check(NowPlayingLanguageOptions.enableCommand(for: oldGenOpt, in: languages) == nil,
              "rejects option from previous sourceGeneration")

        // Mismatched type (audio identifier presented as legible) rejected.
        let mismatched = MPNowPlayingInfoLanguageOption(
            type: .legible,
            languageTag: "en",
            characteristics: nil,
            displayName: "Spoof",
            identifier: audioGroup.languageOptions[0].identifier!
        )
        check(NowPlayingLanguageOptions.enableCommand(for: mismatched, in: languages) == nil,
              "rejects option whose type mismatches scoped kind")

        // 5. Disable command validation: only currently selected subtitle can be disabled.
        check(NowPlayingLanguageOptions.disableCommand(for: subGroup.languageOptions[0], in: languages) == nil,
              "rejects disabling subtitle when subtitles are Off")
        check(NowPlayingLanguageOptions.disableCommand(for: audioGroup.languageOptions[1], in: languages) == nil,
              "rejects disabling audio")

        let withSub = NowPlayingLanguages(
            sessionId: languages.sessionId,
            sourceGeneration: languages.sourceGeneration,
            audioTracks: languages.audioTracks,
            subtitleTracks: languages.subtitleTracks,
            selectedAudioTrackId: "aud:2",
            selectedSubtitleTrackId: "sub-2"
        )
        let builtOn = NowPlayingLanguageOptions.build(withSub)
        check(builtOn.current.count == 2, "current includes both audio and subtitle when subtitle is selected")
        check(NowPlayingLanguageOptions.disableCommand(for: builtOn.available[1].languageOptions[1], in: withSub) == .disableSubtitle,
              "accepts disabling the currently selected subtitle")
        check(NowPlayingLanguageOptions.disableCommand(for: builtOn.available[1].languageOptions[0], in: withSub) == nil,
              "rejects disabling a non-selected subtitle")
        check(NowPlayingLanguageOptions.disableCommand(for: oldGenOpt, in: withSub) == nil,
              "rejects disabling a subtitle from a stale sourceGeneration")

        // 6. NowPlayingState.differs & audio takeover.
        let baseState = NowPlayingState(
            title: "Arrival",
            subtitle: nil,
            artworkURL: nil,
            duration: 7000,
            position: 100,
            playing: true,
            rate: 1,
            audio: false,
            clockRunning: true,
            languages: languages
        )
        var ticked = baseState
        ticked.position = 101
        check(!NowPlayingState.differs(baseState, ticked, elapsed: 1),
              "does not republish on ordinary clock tick")

        var selectedSubChanged = baseState
        selectedSubChanged.languages = withSub
        check(NowPlayingState.differs(baseState, selectedSubChanged, elapsed: 0.1),
              "republishes when only selected subtitle changes")

        var infoVideo: [String: Any] = [:]
        NowPlayingLanguageOptions.apply(to: &infoVideo, state: selectedSubChanged)
        check(infoVideo[MPNowPlayingInfoPropertyAvailableLanguageOptions] != nil, "video populates available language options")
        check(infoVideo[MPNowPlayingInfoPropertyCurrentLanguageOptions] != nil, "video populates current language options")

        var infoAudio: [String: Any] = [:]
        var musicState = selectedSubChanged
        musicState.audio = true
        NowPlayingLanguageOptions.apply(to: &infoAudio, state: musicState)
        check(infoAudio[MPNowPlayingInfoPropertyAvailableLanguageOptions] == nil, "audio omits available language options")
        check(infoAudio[MPNowPlayingInfoPropertyCurrentLanguageOptions] == nil, "audio omits current language options")

        // Empty track lists omit both language keys.
        let emptyPlan = makePlan(selectedAudio: nil, selectedSubtitle: nil, audioTracks: [], subtitleTracks: [])
        let emptyLangs = NowPlayingLanguageOptions.languages(for: emptyPlan, state: PlayerState(), report: PlayerReport(snapshot: { _ in }, observation: { _ in }, error: { _ in }, sessionCommand: { _ in }))
        var emptyVideoState = baseState
        emptyVideoState.languages = emptyLangs
        var infoEmpty: [String: Any] = [:]
        NowPlayingLanguageOptions.apply(to: &infoEmpty, state: emptyVideoState)
        check(infoEmpty[MPNowPlayingInfoPropertyAvailableLanguageOptions] == nil, "empty track lists omit available key")
        check(infoEmpty[MPNowPlayingInfoPropertyCurrentLanguageOptions] == nil, "empty track lists omit current key")
    }
}
