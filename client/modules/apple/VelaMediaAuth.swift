// A native server's media authorization (Plex, Jellyfin): scoped request headers, as
// client/player/media-auth.ts parses and applies them. Held in memory only; never logged.
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

    init(json: String) throws {
        let value = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
        guard
            let value,
            let origin = value["origin"] as? String,
            let prefix = value["pathPrefix"] as? String,
            prefix.hasPrefix("/"),
            let headers = value["headers"] as? [String: String],
            !headers.isEmpty,
            headers.count <= 8,
            headers.keys.allSatisfy(VelaMediaAuth.isAllowed)
        else {
            throw ExactNativeRefusal("Invalid media authorization")
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
