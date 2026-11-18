// The parts of a Vela v0 playback plan (packages/protocol/types.ts, PlaybackPlan) the player reads.
import Foundation

struct VelaPlan: Decodable {
    let sessionId: String
    let revision: Int
    let sourceGeneration: Int
    let seekGeneration: Int
    let positionSeconds: Double
    let paths: [VelaPlanPath]
    let selectedPathId: String
    let audioTracks: [VelaPlanTrack]
    let subtitleTracks: [VelaPlanTrack]
    let selectedAudioTrackId: String?
    let selectedSubtitleTrackId: String?
    let fallback: VelaFallback?
    let chapters: [VelaPlanChapter]?

    var selectedPath: VelaPlanPath? {
        paths.first { $0.id == selectedPathId }
    }

    func audioTrack(_ id: String?) -> VelaPlanTrack? {
        audioTracks.first { $0.id == id }
    }

    func subtitleTrack(_ id: String?) -> VelaPlanTrack? {
        subtitleTracks.first { $0.id == id }
    }

    /// A plan from the view's `plan` prop (the JSON object React Native passes).
    static func decode(_ object: [String: Any]) -> VelaPlan? {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else {
            return nil
        }
        return try? JSONDecoder().decode(VelaPlan.self, from: data)
    }
}

struct VelaPlanPath: Decodable {
    let sourceId: String?
    let timelineId: String?
    let id: String
    let kind: String
    let transport: String
    let readiness: String
    let url: String?
    let original: Bool?
    let range: Bool?
    let byteLength: Int64?
    let timelineOriginSeconds: Double?
    let originalVideo: VelaOriginalVideo?
    let quality: VelaQualityTarget?

    /// An original file the server serves by byte range: the native engine's input.
    var isOriginalFile: Bool {
        original == true && transport == "file"
    }
}

/// Verified facts of the original's video (OriginalVideo), for display matching before the first frame.
struct VelaOriginalVideo: Decodable {
    let codec: String?
    let width: Int?
    let height: Int?
    let frameRate: Double?
    let colorTransfer: String?
    let colorPrimaries: String?
    let dvProfile: Int?
}

/// The output a converted path targets (QualityTarget).
struct VelaQualityTarget: Decodable {
    let width: Int
    let height: Int
    let dynamicRange: String?
}

struct VelaPlanTrack: Decodable {
    struct Delivery: Decodable {
        let kind: String
        let url: String?
    }

    let id: String
    let name: String
    let language: String?
    let codec: String?
    let channels: Int?
    let streamIndex: Int?
    let forced: Bool?
    let hearingImpaired: Bool?
    let url: String?
    let delivery: Delivery?

    var isExternal: Bool {
        delivery?.kind == "external"
    }

    var externalURL: String? {
        isExternal ? (delivery?.url ?? url) : nil
    }

    /// The model.ts Track a snapshot carries.
    var snapshot: [String: Any] {
        var out: [String: Any] = ["id": id, "label": name]
        out["language"] = language
        out["codec"] = codec
        out["channels"] = channels
        out["streamIndex"] = streamIndex
        out["forced"] = forced
        out["hearingImpaired"] = hearingImpaired
        if let delivery {
            var value: [String: Any] = ["kind": delivery.kind]
            value["url"] = delivery.url
            out["delivery"] = value
        }
        return out
    }
}

struct VelaPlanChapter: Decodable {
    let id: String
    let name: String
    let startSeconds: Double
    let endSeconds: Double?

    var snapshot: [String: Any] {
        var out: [String: Any] = ["id": id, "name": name, "startSeconds": startSeconds]
        out["endSeconds"] = endSeconds
        return out
    }
}

struct VelaFallback: Decodable {
    let state: String
    let pathId: String?
}
