// Video audio and subtitle choices for MPNowPlayingInfoCenter and MPRemoteCommandCenter.
// Each published option carries an identifier scoped to the session, source generation, track
// kind and track ID, so commands from an older session or source are rejected before acting.
import Foundation
import MediaPlayer

enum NowPlayingLanguageOptions {
    enum Kind: String, Equatable {
        case audio
        case subtitle
    }

    struct ScopedIdentifier: Equatable {
        let sessionId: String
        let sourceGeneration: Int
        let kind: Kind
        let trackId: String
    }

    struct Built {
        let available: [MPNowPlayingInfoLanguageOptionGroup]
        let current: [MPNowPlayingInfoLanguageOption]
    }

    private static let identifierPrefix = "vela-lang"
    private static let componentAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-._~")
        return set
    }()

    /// Builds NowPlayingLanguages from the same track choices and selected IDs the player snapshot publishes,
    /// including embedded subtitles discovered only by the engine and the observed audio track.
    static func languages(for plan: VelaPlan, state: PlayerState, report: PlayerReport) -> NowPlayingLanguages {
        let audioTracks = plan.audioTracks.map { track in
            NowPlayingTrack(
                id: track.id,
                name: track.name,
                language: track.language,
                codec: track.codec,
                channels: track.channels,
                forced: track.forced == true,
                hearingImpaired: track.hearingImpaired == true
            )
        }
        let planSubtitles = plan.subtitleTracks.map { track in
            NowPlayingTrack(
                id: track.id,
                name: track.name,
                language: track.language,
                codec: track.codec,
                channels: track.channels,
                forced: track.forced == true,
                hearingImpaired: track.hearingImpaired == true
            )
        }
        let embeddedSubtitles = report.discoveredSubtitles(plan, state).map { sub in
            NowPlayingTrack(
                id: sub.id,
                name: sub.label,
                language: sub.language,
                codec: sub.codec.isEmpty ? nil : sub.codec,
                channels: nil,
                forced: sub.forced,
                hearingImpaired: sub.hearingImpaired
            )
        }
        return NowPlayingLanguages(
            sessionId: plan.sessionId,
            sourceGeneration: plan.sourceGeneration,
            audioTracks: audioTracks,
            subtitleTracks: planSubtitles + embeddedSubtitles,
            selectedAudioTrackId: report.effectiveAudioTrackId(plan, state),
            selectedSubtitleTrackId: report.subtitleTrackId
        )
    }

    static func encodeIdentifier(sessionId: String, sourceGeneration: Int, kind: Kind, trackId: String) -> String {
        let encodedSession = sessionId.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? sessionId
        let encodedTrack = trackId.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? trackId
        return "\(identifierPrefix):\(encodedSession):\(sourceGeneration):\(kind.rawValue):\(encodedTrack)"
    }

    static func decodeIdentifier(_ raw: String?) -> ScopedIdentifier? {
        guard let raw else { return nil }
        let parts = raw.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 5,
              parts[0] == identifierPrefix,
              let sessionId = String(parts[1]).removingPercentEncoding,
              !sessionId.isEmpty,
              let sourceGeneration = Int(parts[2]),
              let kind = Kind(rawValue: String(parts[3])),
              let trackId = String(parts[4]).removingPercentEncoding,
              !trackId.isEmpty
        else {
            return nil
        }
        return ScopedIdentifier(
            sessionId: sessionId,
            sourceGeneration: sourceGeneration,
            kind: kind,
            trackId: trackId
        )
    }

    static func languageTag(_ raw: String?) -> String {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty,
              trimmed.lowercased() != "und"
        else {
            return "und"
        }
        return trimmed
    }

    static func displayName(for track: NowPlayingTrack, kind: Kind, in tracks: [NowPlayingTrack]) -> String {
        let tag = languageTag(track.language)
        let knownTag: String? = tag == "und" ? nil : tag
        let trimmed = track.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let base: String = {
            if !trimmed.isEmpty { return trimmed }
            if let knownTag, let localized = Locale.current.localizedString(forIdentifier: knownTag), !localized.isEmpty {
                return localized
            }
            return kind == .audio ? "Audio" : "Subtitle"
        }()

        let normalizedBase = base.lowercased()
        let normalizedTag = knownTag?.lowercased()
        let hasSibling = tracks.count > 1 && tracks.contains { other in
            guard other.id != track.id else { return false }
            let otherBase = other.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let otherTag = languageTag(other.language)
            let otherKnownTag: String? = otherTag == "und" ? nil : otherTag.lowercased()
            return (!normalizedBase.isEmpty && otherBase == normalizedBase)
                || (normalizedTag != nil && otherKnownTag == normalizedTag)
        }

        var parts: [String] = [base]
        var seen = normalizedBase

        if track.forced && !seen.contains("forced") {
            parts.append("Forced")
            seen += " forced"
        }
        if track.hearingImpaired
            && !seen.contains("sdh")
            && !seen.contains("hearing")
            && !seen.contains("cc")
            && !seen.contains("closed caption")
        {
            parts.append("SDH")
            seen += " sdh"
        }

        if hasSibling {
            if let codec = formattedCodec(track.codec), !seen.contains(codec.lowercased()) {
                parts.append(codec)
                seen += " " + codec.lowercased()
            }
            if kind == .audio, let channels = formattedChannels(track.channels), !seen.contains(channels.lowercased()) {
                parts.append(channels)
                seen += " " + channels.lowercased()
            }
        }

        return parts.joined(separator: " · ")
    }

    static func characteristics(for track: NowPlayingTrack, kind: Kind) -> [String]? {
        switch kind {
        case .audio:
            return [MPLanguageOptionCharacteristicIsMainProgramContent]
        case .subtitle:
            var values: [String] = []
            if track.forced {
                values.append(MPLanguageOptionCharacteristicContainsOnlyForcedSubtitles)
            }
            if track.hearingImpaired {
                values.append(MPLanguageOptionCharacteristicTranscribesSpokenDialog)
                values.append(MPLanguageOptionCharacteristicDescribesMusicAndSound)
            }
            return values.isEmpty ? nil : values
        }
    }

    static func build(_ languages: NowPlayingLanguages) -> Built {
        var available: [MPNowPlayingInfoLanguageOptionGroup] = []
        var current: [MPNowPlayingInfoLanguageOption] = []

        if !languages.audioTracks.isEmpty {
            var audioOptions: [MPNowPlayingInfoLanguageOption] = []
            var selectedAudio: MPNowPlayingInfoLanguageOption?
            for track in languages.audioTracks {
                let option = MPNowPlayingInfoLanguageOption(
                    type: .audible,
                    languageTag: languageTag(track.language),
                    characteristics: characteristics(for: track, kind: .audio),
                    displayName: displayName(for: track, kind: .audio, in: languages.audioTracks),
                    identifier: encodeIdentifier(
                        sessionId: languages.sessionId,
                        sourceGeneration: languages.sourceGeneration,
                        kind: .audio,
                        trackId: track.id
                    )
                )
                audioOptions.append(option)
                if track.id == languages.selectedAudioTrackId {
                    selectedAudio = option
                }
            }
            available.append(MPNowPlayingInfoLanguageOptionGroup(
                languageOptions: audioOptions,
                defaultLanguageOption: selectedAudio ?? audioOptions.first,
                allowEmptySelection: false
            ))
            if let selectedAudio {
                current.append(selectedAudio)
            }
        }

        if !languages.subtitleTracks.isEmpty {
            var subtitleOptions: [MPNowPlayingInfoLanguageOption] = []
            var selectedSubtitle: MPNowPlayingInfoLanguageOption?
            for track in languages.subtitleTracks {
                let option = MPNowPlayingInfoLanguageOption(
                    type: .legible,
                    languageTag: languageTag(track.language),
                    characteristics: characteristics(for: track, kind: .subtitle),
                    displayName: displayName(for: track, kind: .subtitle, in: languages.subtitleTracks),
                    identifier: encodeIdentifier(
                        sessionId: languages.sessionId,
                        sourceGeneration: languages.sourceGeneration,
                        kind: .subtitle,
                        trackId: track.id
                    )
                )
                subtitleOptions.append(option)
                if track.id == languages.selectedSubtitleTrackId {
                    selectedSubtitle = option
                }
            }
            available.append(MPNowPlayingInfoLanguageOptionGroup(
                languageOptions: subtitleOptions,
                defaultLanguageOption: nil,
                allowEmptySelection: true
            ))
            if let selectedSubtitle {
                current.append(selectedSubtitle)
            }
        }

        return Built(available: available, current: current)
    }

    static func enableCommand(
        for option: MPNowPlayingInfoLanguageOption,
        in languages: NowPlayingLanguages
    ) -> SystemMediaCommand? {
        guard !option.isAutomaticLegibleLanguageOption(), !option.isAutomaticAudibleLanguageOption() else {
            return nil
        }
        guard let scoped = decodeIdentifier(option.identifier),
              scoped.sessionId == languages.sessionId,
              scoped.sourceGeneration == languages.sourceGeneration
        else {
            return nil
        }
        switch (scoped.kind, option.languageOptionType) {
        case (.audio, .audible):
            guard languages.audioTracks.contains(where: { $0.id == scoped.trackId }) else { return nil }
            return .enableAudio(trackId: scoped.trackId)
        case (.subtitle, .legible):
            guard languages.subtitleTracks.contains(where: { $0.id == scoped.trackId }) else { return nil }
            return .enableSubtitle(trackId: scoped.trackId)
        default:
            return nil
        }
    }

    static func disableCommand(
        for option: MPNowPlayingInfoLanguageOption,
        in languages: NowPlayingLanguages
    ) -> SystemMediaCommand? {
        guard !option.isAutomaticLegibleLanguageOption(), !option.isAutomaticAudibleLanguageOption() else {
            return nil
        }
        guard option.languageOptionType == .legible,
              let scoped = decodeIdentifier(option.identifier),
              scoped.kind == .subtitle,
              scoped.sessionId == languages.sessionId,
              scoped.sourceGeneration == languages.sourceGeneration,
              languages.selectedSubtitleTrackId == scoped.trackId,
              languages.subtitleTracks.contains(where: { $0.id == scoped.trackId })
        else {
            return nil
        }
        return .disableSubtitle
    }

    /// Populates or omits the Now Playing language keys on `info`. Audio playback omits both keys.
    static func apply(to info: inout [String: Any], state: NowPlayingState) {
        guard !state.audio, let languages = state.languages else {
            return
        }
        let built = build(languages)
        guard !built.available.isEmpty else {
            return
        }
        info[MPNowPlayingInfoPropertyAvailableLanguageOptions] = built.available
        info[MPNowPlayingInfoPropertyCurrentLanguageOptions] = built.current
    }

    private static func formattedCodec(_ raw: String?) -> String? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        switch trimmed.lowercased() {
        case "eac3", "ec-3", "ec3": return "EAC3"
        case "ac3", "ac-3": return "AC3"
        case "truehd": return "TrueHD"
        case "dts", "dca": return "DTS"
        case "aac": return "AAC"
        case "flac": return "FLAC"
        case "opus": return "Opus"
        case "mp3": return "MP3"
        case "pcm": return "PCM"
        case "subrip", "srt": return "SRT"
        case "ass", "ssa": return "ASS"
        case "webvtt", "vtt": return "VTT"
        case "hdmv_pgs_subtitle", "pgs", "pgssub": return "PGS"
        case "dvd_subtitle", "vobsub": return "VobSub"
        default: return trimmed.uppercased()
        }
    }

    private static func formattedChannels(_ channels: Int?) -> String? {
        guard let channels, channels > 0 else { return nil }
        switch channels {
        case 1: return "Mono"
        case 2: return "Stereo"
        case 6: return "5.1"
        case 8: return "7.1"
        default: return "\(channels)ch"
        }
    }
}
