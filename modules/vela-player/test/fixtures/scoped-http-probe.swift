import Foundation

struct MPVError: Error { init(_ message: String) {} }

@main struct ScopedHTTPProbe {
    static func main() {
        do {
            let args = CommandLine.arguments
            let access = try VelaMediaAuth(["origin": args[1], "pathPrefix": "/grant", "headers": [
                "Authorization": "Bearer test-authorization", "X-Plex-Token": "test-plex",
                "X-Emby-Token": "test-emby", "X-Plex-Product": "TestProduct",
            ]])
            let request = ScopedMediaRequest(url: URL(string: args[2])!, access: access, offset: 0, count: 1024)
            let result = try request.run()
            print("received=\(result.data.count)")
        } catch {
            print("request_failed")
            exit(1)
        }
    }
}
