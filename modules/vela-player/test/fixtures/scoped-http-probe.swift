import Foundation


@main struct ScopedHTTPProbe {
    static func main() async {
        do {
            let args = CommandLine.arguments
            let access = try VelaMediaAuth(["origin": args[1], "pathPrefix": "/grant", "headers": [
                "Authorization": "Bearer test-authorization", "X-Plex-Token": "test-plex",
                "X-Emby-Token": "test-emby", "X-Plex-Product": "TestProduct",
            ]])
            if args.count > 3, args[3] == "redirect-cancel" {
                VelaMediaAccessStore.set(access, generation: 1)
                let task = Task { await MediaRedirects.resolve(URL(string: args[2])!) }
                try? await Task.sleep(nanoseconds: 250_000_000)
                task.cancel()
                _ = await task.value
                print("redirect_cancelled")
                return
            }
            if args.count > 3 {
                if args[3] == "original-lost" {
                    let received = ReceivedBytes()
                    let request = ScopedMediaRequest(url: URL(string: args[2])!, access: access, offset: 0, count: 1024, received: received)
                    do { _ = try request.run() } catch { }
                    guard received.originalLost else { exit(2) }
                    print("original_lost")
                    return
                }
                if args[3] == "truncated-check" {
                    guard originalResponseTruncated(expectedLength: 13, receivedLength: 5),
                          !originalResponseTruncated(expectedLength: 13, receivedLength: 13),
                          !originalResponseTruncated(expectedLength: nil, receivedLength: 5)
                    else { exit(2) }
                    print("truncated_check_ok")
                    return
                }
                let reader = ScopedMediaByteReader(url: URL(string: args[2])!, access: access)
                if args[3] == "attachment" {
                    let source = URL(string: args[2])!
                    let authorized = URL(string: args[2] + "?api_key=never-log-this&X-Plex-Token=transient-secret#private")!
                    VelaMediaAccessStore.set(access, generation: 1)
                    guard VelaMediaAccessStore.attach(plan: "plan", source: source, authorized: authorized, generation: 1),
                          VelaMediaAccessStore.playbackURL(plan: "plan", source: source) == authorized,
                          VelaMediaAccessStore.playbackURL(plan: "another-plan", source: source) == nil,
                          VelaMediaAccessStore.diagnosticURL(authorized) == args[2],
                          !VelaMediaAccessStore.attach(plan: "escape", source: source, authorized: URL(string: args[1] + "/outside?api_key=never-log-this")!, generation: 1),
                          !VelaMediaAccessStore.attach(plan: "escape", source: source, authorized: URL(string: args[2].replacingOccurrences(of: "127.0.0.1", with: "localhost"))!, generation: 1)
                    else { exit(2) }
                    VelaMediaAccessStore.detach(plan: "plan", generation: 1)
                    guard VelaMediaAccessStore.playbackURL(plan: "plan", source: source) == nil,
                          VelaMediaAccessStore.attach(plan: "plan", source: source, authorized: authorized, generation: 1) else { exit(2) }
                    VelaMediaAccessStore.set(access, generation: 2)
                    guard VelaMediaAccessStore.playbackURL(plan: "plan", source: source) == nil,
                          !VelaMediaAccessStore.attach(plan: "plan", source: source, authorized: authorized, generation: 1) else { exit(2) }
                    VelaMediaAccessStore.set(nil)
                    print("attachment_ok")
                } else if args[3] == "cancel-before" {
                    reader.cancel()
                    var bytes = [UInt8](repeating: 0, count: 5)
                    guard reader.read(&bytes, size: 5) == -1 else { exit(2) }
                    print("cancelled")
                } else if args[3] == "reload" {
                    var bytes = [UInt8](repeating: 0, count: 5)
                    guard reader.read(&bytes, size: 5) == 5 else { exit(2) }
                    reader.cancel()
                    guard reader.read(&bytes, size: 5) == 5,
                          reader.seek(offset: 0, whence: 0) == 0,
                          reader.read(&bytes, size: 5) == 5,
                          String(bytes: bytes, encoding: .utf8) == "media" else { exit(2) }
                    reader.close()
                    guard reader.seek(offset: 0, whence: 0) == -1 else { exit(2) }
                    print("reload_ok")
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
