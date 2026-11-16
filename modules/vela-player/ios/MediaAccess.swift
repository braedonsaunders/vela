// A server's media access (VelaPlayer.setMediaAccess): scoped request headers, as
// client/player/media-auth.ts applies them. Held in native memory only; never logged or reported.
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
            throw MPVError("Invalid media access")
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
        guard let scheme = url.scheme, let host = url.host else {
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

    static func set(_ access: VelaMediaAuth?) {
        lock.lock()
        current = access
        lock.unlock()
    }

    static func headers(for url: URL) -> [String: String] {
        lock.lock()
        defer { lock.unlock() }
        return current?.headers(for: url) ?? [:]
    }

    static var origin: String? {
        lock.lock()
        defer { lock.unlock() }
        return current?.origin
    }
}
