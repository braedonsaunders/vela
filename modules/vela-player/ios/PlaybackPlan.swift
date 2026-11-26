// The parts of a Vela v0 playback plan (packages/protocol/types.ts, PlaybackPlan) the player reads.
import Foundation

struct VelaPlan: Decodable {
    let channelId: String?
    /// Present on every live plan: a Live TV channel, or a library's live stream (no channel).
    let live: VelaPlanLive?
    let sessionId: String
    let revision: Int
    let sourceGeneration: Int
    let seekGeneration: Int
    let positionSeconds: Double
    let durationSeconds: Double?
    let paths: [VelaPlanPath]
    let selectedPathId: String
    let audioTracks: [VelaPlanTrack]
    let subtitleTracks: [VelaPlanTrack]
    let selectedAudioTrackId: String?
    let selectedSubtitleTrackId: String?
    let fallback: VelaFallback?
    let chapters: [VelaPlanChapter]?

    var isLive: Bool { channelId != nil || live != nil }

    var mediaIdentity: String { "\(sessionId):\(sourceGeneration):\(seekGeneration):\(revision):\(selectedPathId)" }

    var selectedPath: VelaPlanPath? {
        paths.first { $0.id == selectedPathId }
    }

    func audioTrack(_ id: String?) -> VelaPlanTrack? {
        audioTracks.first { $0.id == id }
    }

    func subtitleTrack(_ id: String?) -> VelaPlanTrack? {
        subtitleTracks.first { $0.id == id }
    }

    /// The server path a quality choice stands for: `path:<id>` or a path id, or an HLS rendition of a
    /// path's ladder (a Quality id). AVPlayer chooses inside the ladder itself, so a rendition is the
    /// converted path of the same height when the server offers one; otherwise nil.
    func switchTarget(_ choice: String) -> String? {
        let id = choice.hasPrefix("path:") ? String(choice.dropFirst(5)) : choice
        if paths.contains(where: { $0.id == id }) { return id }
        guard let height = paths.lazy.compactMap({ $0.qualities?.first { $0.id == id }?.height }).first else { return nil }
        return paths.first {
            $0.original != true && $0.quality?.height == height && ["ready", "on-demand"].contains($0.readiness)
        }?.id
    }

    /// The loaded item's identity: a plan with the same key plays on in the item already loaded. A server's
    /// VOD HLS is replaced when a seek restarts its encoder, under the same URL and source generation: only
    /// the seek generation (and the playlist's timeline origin) move, so they are part of its identity and
    /// the new item loads once. An original file and a live window keep their item across seeks.
    func sourceKey(_ path: VelaPlanPath) -> String {
        let key = "\(sessionId):\(path.id):\(sourceGeneration)"
        guard MediaTimeline.applies(to: self, path: path) else { return key }
        return key + ":\(seekGeneration):\(MediaTimeline(plan: self, path: path).origin)"
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
    /// The HLS ladder the server publishes for this path, when it has one.
    let qualities: [VelaRendition]?

    /// An original file the server serves by byte range: the native engine's input.
    var isOriginalFile: Bool {
        original == true && transport == "file"
    }
}

/// Title seconds at the protocol boundary, item seconds at the player. A server's VOD HLS may start partway
/// into the title (`timelineOriginSeconds`): its playlist time zero is that title second, and the engine's
/// clock, duration and buffered end are on the playlist's axis. Plans, commands, snapshots and observations
/// are all on the title's. A live window has its own clock and an original file is the title itself: origin 0.
/// The same mapping as Android's (PlaybackPlan.kt MediaTimeline) and the web's (host/position.ts nativeOrigin).
struct MediaTimeline: Equatable {
    let origin: Double

    init(origin: Double = 0) {
        self.origin = origin.isFinite && origin > 0 ? origin : 0
    }

    init(plan: VelaPlan, path: VelaPlanPath? = nil) {
        let path = path ?? plan.selectedPath
        guard let path, Self.applies(to: plan, path: path) else {
            self.init()
            return
        }
        self.init(origin: path.timelineOriginSeconds ?? 0)
    }

    /// Whether the plan's path plays on a playlist clock that a timeline origin rebases: a server's VOD HLS.
    static func applies(to plan: VelaPlan, path: VelaPlanPath) -> Bool {
        !plan.isLive && !path.isOriginalFile && path.transport == "hls"
    }

    /// The item's time for a title position: where the engine starts or seeks.
    func mediaTime(_ title: Double) -> Double {
        guard title.isFinite else { return title }
        return max(0, title - origin)
    }

    /// The title's time for the item's: what is shown and reported.
    func titleTime(_ media: Double) -> Double {
        guard media.isFinite else { return media }
        return origin + max(0, media)
    }

    /// An engine property's value on the title's axis: its clock (`time-pos`), the item's duration (the
    /// playlist runs to the title's end, so it ends at the title's duration) and the buffered end.
    func titleProperty(_ name: String, _ value: Any?) -> Any? {
        guard origin > 0, ["time-pos", "duration", "demuxer-cache-time"].contains(name), let seconds = value as? Double else {
            return value
        }
        return titleTime(seconds)
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

/// One rung of a path's HLS ladder (Quality): optional fields, so an unexpected rung never fails the plan.
struct VelaRendition: Decodable {
    let id: String?
    let height: Int?
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
        /// External only: "webvtt", "webvtt-window", or "ass" (the authored ASS/SSA file).
        let format: String?
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

    /// The engine's format hint for an external file whose URL may not name it ("ass"); nil lets it sniff.
    var externalFormatHint: String? {
        isExternal && delivery?.format == "ass" ? "ass" : nil
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
            value["format"] = delivery.format
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

struct VelaPlanLive: Decodable {
    let mode: String?
}
