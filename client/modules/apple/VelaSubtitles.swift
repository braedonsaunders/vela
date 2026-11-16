// Subtitle cues and their text: what the overlay shows, from embedded streams (VelaMedia's
// decoders) or a server-converted WebVTT track, and the viewer's subtitle style.
import CoreGraphics
import Foundation

/// One cue in media time.
struct VelaCue {
    enum Content {
        case text(String)
        case bitmaps([VelaBitmap], canvas: CGSize)
    }

    let start: Double
    var end: Double
    let content: Content
}

/// A subtitle bitmap (PGS, DVD, DVB) and where it sits on its canvas.
struct VelaBitmap {
    let image: CGImage
    let frame: CGRect
}

/// The viewer's subtitle look (SubtitlePreferences in client/player/universal/subtitles/types.ts).
struct VelaSubtitleStyle {
    var size = "medium"
    var background = "shadow"
    var color = "white"
    var position = "bottom"

    /// Text height as a fraction of the picture's height.
    var scale: CGFloat {
        switch size {
        case "small": return 0.04
        case "large": return 0.062
        case "xl": return 0.075
        default: return 0.05
        }
    }

    var raised: Bool {
        position == "raised"
    }

    var snapshot: [String: Any] {
        [
            "subtitleSize": size,
            "subtitleBackground": background,
            "subtitleColor": color,
            "subtitlePosition": position,
            "offsetSeconds": 0,
        ]
    }

    /// A `subtitleStyle` command's value: a JSON object of preferences, or one `name:value` pair.
    mutating func apply(_ raw: String) {
        if let value = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] {
            for (name, setting) in value {
                if let setting = setting as? String {
                    set(name, setting)
                }
            }
            return
        }
        let pair = raw.split(separator: ":", maxSplits: 1).map(String.init)
        if pair.count == 2 {
            set(pair[0], pair[1])
        }
    }

    private mutating func set(_ name: String, _ value: String) {
        switch name {
        case "subtitleSize": size = value
        case "subtitleBackground": background = value
        case "subtitleColor": color = value
        case "subtitlePosition": position = value
        default: break
        }
    }
}

enum VelaSubtitleText {
    /// An ASS event's text without its fields and override tags, or plain text without markup.
    static func plain(_ line: String, ass: Bool) -> String {
        var text = line
        if ass {
            text = assEventText(text)
            text = text.replacingOccurrences(of: #"\{[^}]*\}"#, with: "", options: .regularExpression)
            text = text.replacingOccurrences(of: "\\N", with: "\n")
            text = text.replacingOccurrences(of: "\\n", with: "\n")
            text = text.replacingOccurrences(of: "\\h", with: " ")
        }
        text = text.replacingOccurrences(of: #"</?[a-zA-Z][^>]*>"#, with: "", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The Text field of `ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text`.
    private static func assEventText(_ line: String) -> String {
        var commas = 0
        for index in line.indices where line[index] == "," {
            commas += 1
            if commas == 8 {
                return String(line[line.index(after: index)...])
            }
        }
        return line
    }

    /// A premultiplied RGBA bitmap as an image.
    static func image(_ rgba: UnsafePointer<UInt32>, width: Int, height: Int) -> CGImage? {
        let data = Data(bytes: rgba, count: width * height * 4)
        guard let provider = CGDataProvider(data: data as CFData) else {
            return nil
        }
        return CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        )
    }
}

enum VelaWebVTT {
    static func parse(_ body: String) -> [VelaCue] {
        let blocks = body.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n")
        return blocks.compactMap(cue)
    }

    private static func cue(_ block: String) -> VelaCue? {
        let lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let timing = lines.firstIndex(where: { $0.contains("-->") }) else {
            return nil
        }
        let ends = lines[timing].components(separatedBy: "-->")
        let endText = ends.count == 2 ? ends[1].split(separator: " ").first.map(String.init) ?? "" : ""
        guard let start = seconds(ends[0]), let end = seconds(endText) else {
            return nil
        }
        let text = VelaSubtitleText.plain(lines[(timing + 1)...].joined(separator: "\n"), ass: false)
        return text.isEmpty ? nil : VelaCue(start: start, end: end, content: .text(text))
    }

    /// `hh:mm:ss.mmm` or `mm:ss.mmm` in seconds.
    private static func seconds(_ text: String) -> Double? {
        let clean = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        let parts = clean.split(separator: ":").compactMap { Double($0) }
        guard !parts.isEmpty else {
            return nil
        }
        return parts.reduce(0) { total, part in total * 60 + part }
    }
}
