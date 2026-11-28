import Foundation
#if os(iOS) || os(tvOS)
import AetherEngine
#endif

struct SubtitleWindow {
    struct Cue {
        let start: Double
        let end: Double
        let text: String
    }

    let origin: Double

    func cursor(mediaTime: Double, previous: Int64?) -> Int64 {
        let now = Int64(max(0, (mediaTime + origin) * 1000).rounded(.down))
        guard let previous, now >= previous, now - previous < 100_000 else { return now }
        return previous
    }

    static func url(_ source: URL, from: Int64) -> URL? {
        guard var target = URLComponents(url: source, resolvingAgainstBaseURL: false),
              ["http", "https"].contains(target.scheme?.lowercased() ?? ""),
              target.user == nil, target.password == nil else { return nil }
        var query = (target.percentEncodedQuery ?? "").split(separator: "&").filter {
            $0.split(separator: "=", maxSplits: 1).first?.removingPercentEncoding != "from_ms"
        }.map(String.init)
        query.append("from_ms=\(from)")
        target.percentEncodedQuery = query.joined(separator: "&")
        return target.url
    }

    func cues(_ data: Data) throws -> [Cue] {
        let document = String(decoding: data, as: UTF8.self)
            .replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: CharacterSet(charactersIn: "\u{FEFF}"))
        let blocks = document.components(separatedBy: "\n\n")
        let header = blocks.first?.components(separatedBy: "\n").first ?? ""
        guard header == "WEBVTT" || header.hasPrefix("WEBVTT ") || header.hasPrefix("WEBVTT\t") else {
            throw URLError(.cannotDecodeContentData)
        }
        return blocks.dropFirst().compactMap { block in
            let lines = block.split(separator: "\n")
            guard let first = lines.first,
                  first != "STYLE", first != "REGION", first != "NOTE", !first.hasPrefix("NOTE ") else { return nil }
            let timingIndex = first.contains("-->") ? 0 : 1
            guard lines.indices.contains(timingIndex) else { return nil }
            let timing = lines[timingIndex].components(separatedBy: "-->")
            guard timing.count == 2, let start = Self.seconds(timing[0]),
                  let endToken = timing[1].split(whereSeparator: \.isWhitespace).first,
                  let end = Self.seconds(String(endToken)), end > start else { return nil }
            var text = lines.dropFirst(timingIndex + 1).joined(separator: "\n")
                .replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
            for (entity, character) in [("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", "\u{00a0}"),
                                         ("&lrm;", "\u{200e}"), ("&rlm;", "\u{200f}"), ("&amp;", "&")] {
                text = text.replacingOccurrences(of: entity, with: character)
            }
            guard !text.isEmpty else { return nil }
            return Cue(start: start - origin, end: end - origin, text: text)
        }
    }

    private static func seconds(_ token: String) -> Double? {
        let parts = token.trimmingCharacters(in: .whitespaces).split(separator: ":")
        guard parts.count == 2 || parts.count == 3,
              let minutes = Int(parts[parts.count - 2]), minutes >= 0, minutes < 60,
              let seconds = Double(parts[parts.count - 1]), seconds >= 0, seconds < 60 else { return nil }
        let hours = parts.count == 3 ? Int(parts[0]) : 0
        guard let hours, hours >= 0 else { return nil }
        return Double(hours) * 3600 + Double(minutes) * 60 + seconds
    }
}

#if os(iOS) || os(tvOS)
@MainActor
final class WindowedSubtitles {
    private let source: URL
    private let access: VelaMediaAuth?
    private let timeline: SubtitleWindow
    private var request: ScopedMediaRequest?
    private var base: Int64?
    private var nextPoll: TimeInterval = 0
    private var complete = false
    private(set) var cues: [SubtitleCue] = []

    init(url: URL, origin: Double, access: VelaMediaAuth?) {
        source = url
        timeline = SubtitleWindow(origin: origin)
        self.access = access
    }

    func reset() {
        request?.cancel()
        request = nil
        base = nil
        nextPoll = 0
        complete = false
        cues = []
    }

    func poll(mediaTime: Double, changed: @escaping @MainActor () -> Void) {
        guard mediaTime.isFinite, !complete, request == nil,
              ProcessInfo.processInfo.systemUptime >= nextPoll else { return }
        let from = timeline.cursor(mediaTime: mediaTime, previous: base)
        guard let url = SubtitleWindow.url(source, from: from) else { return }
        let operation = ScopedMediaRequest(url: url, access: access, offset: nil, count: 8 * 1024 * 1024)
        request = operation
        let timeline = timeline
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let result = try? operation.run()
            let parsed = result.flatMap { try? timeline.cues($0.data) }
            Task { @MainActor [weak self] in
                guard let self, self.request === operation else { return }
                self.request = nil
                self.nextPoll = ProcessInfo.processInfo.systemUptime + 1
                guard let result, let parsed else { return }
                self.base = from
                self.complete = result.subtitleComplete
                self.cues = parsed.enumerated().map { index, cue in
                    SubtitleCue(id: index, startTime: cue.start, endTime: cue.end, body: .text(cue.text))
                }
                changed()
            }
        }
    }
}
#endif
