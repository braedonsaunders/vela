// Media credentials never follow a redirect out of their scope (packages/player-api MediaAccess).
// When a URL carries headers, its redirects are resolved here first, one hop at a time: a hop
// inside the authorized origin and path keeps the headers, a hop outside drops them for good.
// The scoped byte reader enforces the grant on every later redirect, seek and reconnect.
import Foundation

struct ResolvedMedia {
    let url: URL
    /// The headers for `url`: empty once a redirect left the authorized scope.
    let headers: [String: String]

}

enum MediaRedirects {
    private static let maximumHops = 8

    /// The final URL and its headers. Without headers there is nothing to protect: Aether follows redirects itself.
    static func resolve(_ url: URL) async -> ResolvedMedia {
        var current = url
        var headers = VelaMediaAccessStore.headers(for: url)
        guard !headers.isEmpty else {
            return ResolvedMedia(url: url, headers: [:])
        }
        let session = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        for _ in 0..<maximumHops {
            guard let next = await redirectTarget(of: current, headers: headers, in: session) else {
                break
            }
            current = next
            // Out of scope once means out of scope: a later hop back does not regain the credentials.
            if VelaMediaAccessStore.headers(for: next).isEmpty {
                headers = [:]
            }
            if headers.isEmpty {
                break
            }
        }
        return ResolvedMedia(url: current, headers: headers)
    }

    /// The Location of a redirect answer for the first byte, or nil when the URL answers itself.
    private static func redirectTarget(of url: URL, headers: [String: String], in session: URLSession) async -> URL? {
        var request = URLRequest(url: url)
        request.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        guard
            let (_, response) = try? await session.data(for: request),
            let http = response as? HTTPURLResponse,
            (300..<400).contains(http.statusCode),
            let location = http.value(forHTTPHeaderField: "Location")
        else {
            return nil
        }
        return URL(string: location, relativeTo: url)?.absoluteURL
    }
}

/// Answers every redirect with no request, so its Location can be checked against the scope.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
