// The viewer's text subtitle appearance (the player's subtitle menu: size, background, colour, position),
// kept per device. Same names and values as the web player (SubtitlePreferences). ASS drawn by libass
// keeps its authored look; bitmap subtitles keep their pixels.
import Foundation

struct SubtitleAppearance: Equatable {
    var size = "medium"
    var background = "shadow"
    var color = "white"
    var position = "bottom"

    static let choices: [String: [String]] = [
        "subtitleSize": ["small", "medium", "large", "xl"],
        "subtitleBackground": ["none", "shadow", "box"],
        "subtitleColor": ["white", "yellow"],
        "subtitlePosition": ["bottom", "raised"],
    ]
    /// Whether this platform's caption drawing honours the appearance (the UIKit overlay does).
    static var honoured: Bool {
        #if canImport(UIKit)
        return true
        #else
        return false
        #endif
    }
    private static let key = "vela.subtitleAppearance"
    private static var cached: SubtitleAppearance?

    static var current: SubtitleAppearance {
        get {
            if let cached { return cached }
            var value = SubtitleAppearance()
            for (name, setting) in UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:] {
                _ = value.apply("\(name)=\(setting)")
            }
            cached = value
            return value
        }
        set {
            cached = newValue
            UserDefaults.standard.set(newValue.snapshot.compactMapValues { $0 as? String }, forKey: key)
        }
    }

    /// Snapshot.subtitleStyle.
    var snapshot: [String: Any] {
        ["subtitleSize": size, "subtitleBackground": background, "subtitleColor": color,
         "subtitlePosition": position, "offsetSeconds": 0]
    }

    /// Applies one "name=value" choice; false when unknown.
    mutating func apply(_ assignment: String) -> Bool {
        let parts = assignment.split(separator: "=", maxSplits: 1).map(String.init)
        guard parts.count == 2, Self.choices[parts[0]]?.contains(parts[1]) == true else { return false }
        switch parts[0] {
        case "subtitleSize": size = parts[1]
        case "subtitleBackground": background = parts[1]
        case "subtitleColor": color = parts[1]
        default: position = parts[1]
        }
        return true
    }

    /// Text height as a fraction of the picture's height.
    var heightFraction: CGFloat {
        switch size {
        case "small": return 0.042
        case "large": return 0.062
        case "xl": return 0.074
        default: return 0.052
        }
    }
}
