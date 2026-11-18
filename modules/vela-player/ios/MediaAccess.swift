// A server's media access (VelaPlayer.setMediaAccess): scoped request headers, as
// modules/vela-player/web/engine/media-auth.ts applies them. Held in native memory only; never logged or reported.
import Foundation

struct VelaMediaAuth {
    let origin: String
    let pathPrefix: String
    let fields: [String: String]

    private static let allowedHeader = try! NSRegularExpression(
        pattern: "^(accept|authorization|x-plex-token|x-emby-token|x-emby-authorization|x-plex-product"
            + "|x-plex-version|x-plex-client-identifier|x-plex-platform|x-plex-device-name)$",
        options: .caseInsensitive
    )

    init(_ value: [String: Any]) throws {
        guard
            let origin = value["origin"] as? String,
            let prefix = value["pathPrefix"] as? String,
            prefix.hasPrefix("/"),
            let headers = value["headers"] as? [String: String],
            headers.count <= 8,
            headers.keys.allSatisfy(VelaMediaAuth.isAllowed)
        else {
            throw MediaAccessError.invalid
        }
        self.origin = origin
        pathPrefix = prefix
        fields = headers
    }

    private static func isAllowed(_ name: String) -> Bool {
        allowedHeader.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
    }

    /// The headers for `url`, only when it is inside the authorized origin and path.
    func headers(for url: URL) -> [String: String] {
        guard let scheme = url.scheme, let host = url.host,
              url.user == nil, url.password == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return [:]
        }
        let encoded = components.percentEncodedPath.lowercased()
        let traversal = encoded.split(separator: "/").contains { part in
            let decoded = String(part).removingPercentEncoding
            return decoded == "." || decoded == ".."
        }
        guard !traversal, !encoded.contains("%2f"), !encoded.contains("%5c"), !encoded.contains("%25") else {
            return [:]
        }
        let port = url.port.map { ":\($0)" } ?? ""
        guard "\(scheme)://\(host)\(port)" == origin else {
            return [:]
        }
        let directory = pathPrefix.hasSuffix("/") ? pathPrefix : pathPrefix + "/"
        let inside = pathPrefix == "/" || url.path == pathPrefix || url.path.hasPrefix(directory)
        return inside ? fields : [:]
    }
}

/// The one media access the trusted playback controller set, for every player view. Its origin also
/// resolves a plan's relative URLs (Ether's broker paths need no headers: `headers` may be empty).
enum VelaMediaAccessStore {
    private static let lock = NSLock()
    private static var current: VelaMediaAuth?
    private static var generation = 0
    private struct Attachment { let source: URL; let authorized: URL }
    private static var attachments: [String: Attachment] = [:]

    static func set(_ access: VelaMediaAuth?, generation: Int = 0) {
        lock.lock()
        current = access
        self.generation = generation
        attachments.removeAll()
        lock.unlock()
    }

    // Only adapter-minted URLs within the unchanged grant may reach AVPlayer.
    // These attachments never enter plans, snapshots, diagnostics or event payloads.
    static func attach(plan: String, source: URL, authorized: URL, generation: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let sourceScoped = current?.headers(for: source).isEmpty == false
        let authorizedScoped = current?.headers(for: authorized).isEmpty == false
        guard self.generation == generation, sourceScoped, authorizedScoped else {
            print("[vela-player] native attachment refused: stale=\(self.generation != generation) sourceScoped=\(sourceScoped) authorizedScoped=\(authorizedScoped)")
            return false
        }
        attachments[plan] = Attachment(source: source, authorized: authorized)
        return true
    }

    static func playbackURL(plan: String, source: URL) -> URL? {
        lock.lock()
        defer { lock.unlock() }
        guard let attachment = attachments[plan], attachment.source == source else { return nil }
        return attachment.authorized
    }

    static func detach(plan: String, generation: Int? = nil) {
        lock.lock()
        defer { lock.unlock() }
        if generation == nil || self.generation == generation { attachments.removeValue(forKey: plan) }
    }

    static func diagnosticURL(_ url: URL) -> String {
        guard var value = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return "[media URL]" }
        value.query = nil
        value.fragment = nil
        value.user = nil
        value.password = nil
        return value.string ?? "[media URL]"
    }

    static var activeGeneration: Int {
        lock.lock()
        defer { lock.unlock() }
        return generation
    }

    static func headers(for url: URL) -> [String: String] {
        lock.lock()
        defer { lock.unlock() }
        return current?.headers(for: url) ?? [:]
    }

    static var snapshot: VelaMediaAuth? {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    static var origin: String? {
        lock.lock()
        defer { lock.unlock() }
        return current?.origin
    }
}

enum MediaAccessError: Error { case invalid }
