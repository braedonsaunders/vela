import Foundation


@main struct ScopedHTTPProbe {
    static func main() {
        do {
            let args = CommandLine.arguments
            let access = try VelaMediaAuth(["origin": args[1], "pathPrefix": "/grant", "headers": [
                "Authorization": "Bearer test-authorization", "X-Plex-Token": "test-plex",
                "X-Emby-Token": "test-emby", "X-Plex-Product": "TestProduct",
            ]])
            if args.count > 3 {
                let reader = ScopedMediaByteReader(url: URL(string: args[2])!, access: access)
                if args[3] == "cancel-before" {
                    reader.cancel()
                    var bytes = [UInt8](repeating: 0, count: 5)
                    guard reader.read(&bytes, size: 5) == -1 else { exit(2) }
                    print("cancelled")
                } else if args[3] == "cancel" {
                    DispatchQueue.global().asyncAfter(deadline: .now() + 0.05) { reader.cancel() }
                    var bytes = [UInt8](repeating: 0, count: 5)
                    guard reader.read(&bytes, size: 5) == -1 else { exit(2) }
                    print("cancelled")
                } else {
                    var bytes = [UInt8](repeating: 0, count: 5)
                    guard reader.read(&bytes, size: 5) == 5, String(bytes: bytes, encoding: .utf8) == "media",
                          reader.seek(offset: 0, whence: 65536 | 131072) == 13,
                          reader.seek(offset: 6, whence: 0) == 6 else { exit(2) }
                    var tail = [UInt8](repeating: 0, count: 7)
                    guard reader.read(&tail, size: 7) == 7, String(bytes: tail, encoding: .utf8) == "payload",
                          reader.seek(offset: Int64.max, whence: 1) == -1 else { exit(2) }
                    reader.close()
                    guard reader.read(&bytes, size: 5) == -1 else { exit(2) }
                    let sibling = reader.makeSiblingReader()
                    guard sibling.read(&bytes, size: 5) == 5 else { exit(2) }
                    sibling.close()
                    print("reader_ok")
                }
                return
            }
            let request = ScopedMediaRequest(url: URL(string: args[2])!, access: access, offset: 0, count: 1024)
            let result = try request.run()
            print("received=\(result.data.count)")
        } catch {
            print("request_failed")
            exit(1)
        }
    }
}
