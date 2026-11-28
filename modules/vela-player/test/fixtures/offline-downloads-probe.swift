import Foundation

@main
enum OfflineDownloadsProbe {
    static func main() throws {
        let args = CommandLine.arguments
        guard args.count >= 4 else {
            fputs("Usage: offline-downloads-probe <rootDir> <origin> <mode>\n", stderr)
            exit(2)
        }

        let root = URL(fileURLWithPath: args[1], isDirectory: true)
        let origin = args[2]
        let mode = args[3]

        let downloads = OfflineDownloads(rootDirectory: root, sessionIdentifier: "app.ether.vela.downloads.test", useBackgroundSession: false)

        switch mode {
        case "snapshot":
            let values = try root.resourceValues(forKeys: [.isExcludedFromBackupKey])
            guard values.isExcludedFromBackup == true else {
                fputs("root directory not excluded from backup\n", stderr)
                exit(1)
            }
            try downloads.writeSnapshot([
                "items": [["serverId": "srv-1", "viewerId": "v-1", "titleId": "101", "status": "completed"]],
                "outbox": [["serverId": "srv-1", "viewerId": "v-1", "titleId": "101", "positionSeconds": 120]],
            ])
            let read = downloads.readSnapshot()
            let items = (read["items"] as? [[String: Any]]) ?? []
            let outbox = (read["outbox"] as? [[String: Any]]) ?? []
            guard items.count == 1, items[0]["titleId"] as? String == "101",
                  outbox.count == 1, (outbox[0]["positionSeconds"] as? NSNumber)?.intValue == 120 else {
                fputs("snapshot mismatch: \(read)\n", stderr)
                exit(1)
            }
            let indexValues = try root.appendingPathComponent("index.json").resourceValues(forKeys: [.isExcludedFromBackupKey])
            guard indexValues.isExcludedFromBackup == true else {
                fputs("index.json not excluded from backup\n", stderr)
                exit(1)
            }
            let free = downloads.freeBytes() ?? 0
            guard free > 0 else {
                fputs("freeBytes failed\n", stderr)
                exit(1)
            }
            print("snapshot_ok")

        case "transfer":
            let done = DispatchSemaphore(value: 0)
            var events: [[String: Any]] = []
            let lock = NSLock()
            downloads.emit = { event in
                lock.lock()
                events.append(event)
                let status = event["status"] as? String
                lock.unlock()
                if status == "completed" || status == "failed" {
                    done.signal()
                }
            }
            try downloads.writeSnapshot(["items": [["serverId": "srv-plex", "viewerId": "viewer-1", "titleId": "101", "status": "queued"]]])
            try downloads.startTransfer([
                "serverId": "srv-plex",
                "viewerId": "viewer-1",
                "titleId": "101",
                "url": "\(origin)/media/101.mkv",
                "headers": ["X-Plex-Token": "secret-token"],
                "container": "mkv",
                "mimeType": "video/x-matroska",
                "byteLength": 32,
                "etag": "\"etag-101\"",
                "wifiOnly": true,
                "posterUrl": "\(origin)/poster/101.jpg",
                "sidecars": [
                    ["trackId": "sub-1", "format": "srt", "url": "\(origin)/subs/sub-1.srt"],
                    ["trackId": "sub-2", "format": "ass", "url": "\(origin)/subs/sub-2.ass"],
                ],
            ])
            guard done.wait(timeout: .now() + 10) == .success else {
                fputs("transfer timed out\n", stderr)
                exit(1)
            }
            lock.lock()
            let last = events.last ?? [:]
            lock.unlock()
            guard last["status"] as? String == "completed",
                  (last["bytesWritten"] as? NSNumber)?.intValue == 32,
                  last["mediaPath"] as? String == "srv-plex/viewer-1/101/media.mkv",
                  last["posterPath"] as? String == "srv-plex/viewer-1/101/poster.jpg",
                  let sidecars = last["sidecarPaths"] as? [String: String],
                  sidecars["sub-1"] == "srv-plex/viewer-1/101/subtitles/sub-1.srt",
                  sidecars["sub-2"] == "srv-plex/viewer-1/101/subtitles/sub-2.ass" else {
                fputs("unexpected completed event: \(last)\n", stderr)
                exit(1)
            }
            let mediaURL = root.appendingPathComponent("srv-plex/viewer-1/101/media.mkv")
            let mediaData = try Data(contentsOf: mediaURL)
            guard mediaData.count == 32 else {
                fputs("media size mismatch: \(mediaData.count)\n", stderr)
                exit(1)
            }
            let mediaValues = try mediaURL.resourceValues(forKeys: [.isExcludedFromBackupKey])
            guard mediaValues.isExcludedFromBackup == true else {
                fputs("media file not excluded from backup\n", stderr)
                exit(1)
            }
            let relaunched = OfflineDownloads(rootDirectory: root)
            let restored = (relaunched.readSnapshot()["items"] as? [[String: Any]])?.first
            guard restored?["status"] as? String == "completed",
                  restored?["mediaPath"] as? String == "srv-plex/viewer-1/101/media.mkv" else {
                fputs("completed download was not restored from the native transfer status\n", stderr)
                exit(1)
            }
            downloads.removeViewer(serverId: "srv-plex", viewerId: "viewer-1")
            guard !FileManager.default.fileExists(atPath: mediaURL.path) else {
                fputs("removeViewer did not remove media file\n", stderr)
                exit(1)
            }
            print("transfer_ok")

        case "corrupt":
            let done = DispatchSemaphore(value: 0)
            var finalEvent: [String: Any] = [:]
            downloads.emit = { event in
                let status = event["status"] as? String
                if status == "completed" || status == "failed" {
                    finalEvent = event
                    done.signal()
                }
            }
            try downloads.startTransfer([
                "serverId": "srv-plex",
                "viewerId": "viewer-1",
                "titleId": "bad-size",
                "url": "\(origin)/media/truncated.mkv",
                "headers": [:],
                "container": "mkv",
                "mimeType": "video/x-matroska",
                "byteLength": 100,
                "wifiOnly": true,
                "sidecars": [],
            ])
            guard done.wait(timeout: .now() + 10) == .success else {
                fputs("corrupt transfer timed out\n", stderr)
                exit(1)
            }
            guard finalEvent["status"] as? String == "failed",
                  finalEvent["errorCode"] as? String == "corrupt" else {
                fputs("expected corrupt failure, got: \(finalEvent)\n", stderr)
                exit(1)
            }
            let finalMedia = root.appendingPathComponent("srv-plex/viewer-1/bad-size/media.mkv")
            guard !FileManager.default.fileExists(atPath: finalMedia.path) else {
                fputs("corrupt transfer promoted media.mkv\n", stderr)
                exit(1)
            }
            print("corrupt_ok")

        case "resume-regrant", "resume-changed", "resume-invalid":
            let partial = DispatchSemaphore(value: 0)
            let done = DispatchSemaphore(value: 0)
            var final: [String: Any] = [:]
            downloads.emit = { event in
                switch event["status"] as? String {
                case "downloading": partial.signal()
                case "completed", "failed": final = event; done.signal()
                default: break
                }
            }
            var request: [String: Any] = [
                "serverId": "srv", "viewerId": "viewer", "titleId": "title",
                "url": "\(origin)/old-grant", "headers": ["X-Grant": "old"],
                "byteLength": 262144, "etag": "\"original\"",
            ]
            try downloads.startTransfer(request)
            guard partial.wait(timeout: .now() + 10) == .success else {
                throw URLError(.timedOut)
            }
            downloads.pauseTransfer(serverId: "srv", viewerId: "viewer", titleId: "title")
            let titleDir = root.appendingPathComponent("srv/viewer/title")
            let resumeFile = titleDir.appendingPathComponent("resume.data")
            guard FileManager.default.fileExists(atPath: resumeFile.path) else {
                throw URLError(.cannotCreateFile)
            }
            if mode == "resume-invalid" { try Data([0]).write(to: resumeFile) }
            let changed = mode == "resume-changed"
            request["url"] = "\(origin)/" + (changed ? "changed-grant" : "new-grant")
            request["headers"] = ["X-Grant": "fresh"]
            if changed { request["etag"] = "\"changed\"" }
            try downloads.resumeTransfer(request)
            guard done.wait(timeout: .now() + 10) == .success, final["status"] as? String == "completed" else {
                fputs("unexpected transfer result: \(final)\n", stderr)
                exit(1)
            }
            let media = try Data(contentsOf: titleDir.appendingPathComponent("media.mp4"))
            guard media == Data(repeating: changed ? 0x42 : 0x41, count: 262144) else {
                throw URLError(.cannotDecodeContentData)
            }
            print("regrant_ok")

        case "resume-range":
            // Pre-seed a 16-byte .part file, then call resumeTransfer for a 32-byte resource.
            let titleDir = root.appendingPathComponent("srv-plex/viewer-1/resumed", isDirectory: true)
            try FileManager.default.createDirectory(at: titleDir, withIntermediateDirectories: true)
            let partFile = titleDir.appendingPathComponent("media.mkv.part")
            try Data(repeating: 0x41, count: 16).write(to: partFile)

            let done = DispatchSemaphore(value: 0)
            var finalEvent: [String: Any] = [:]
            downloads.emit = { event in
                let status = event["status"] as? String
                if status == "completed" || status == "failed" {
                    finalEvent = event
                    done.signal()
                }
            }
            try downloads.resumeTransfer([
                "serverId": "srv-plex",
                "viewerId": "viewer-1",
                "titleId": "resumed",
                "url": "\(origin)/media/range-resume.mkv",
                "headers": ["X-Plex-Token": "fresh-token"],
                "container": "mkv",
                "mimeType": "video/x-matroska",
                "byteLength": 32,
                "etag": "\"etag-resumed\"",
                "wifiOnly": true,
                "sidecars": [],
            ])
            guard done.wait(timeout: .now() + 10) == .success else {
                fputs("resume transfer timed out\n", stderr)
                exit(1)
            }
            guard finalEvent["status"] as? String == "completed",
                  (finalEvent["bytesWritten"] as? NSNumber)?.intValue == 32 else {
                fputs("expected resumed completion, got: \(finalEvent)\n", stderr)
                exit(1)
            }
            let finalMedia = titleDir.appendingPathComponent("media.mkv")
            let data = try Data(contentsOf: finalMedia)
            guard data.count == 32,
                  data.prefix(16) == Data(repeating: 0x41, count: 16),
                  data.suffix(16) == Data(repeating: 0x42, count: 16) else {
                fputs("resumed file content mismatch\n", stderr)
                exit(1)
            }
            print("resume_ok")

        case "credentials":
            // While a transfer is in flight, nothing on disk holds its credential headers.
            let done = DispatchSemaphore(value: 0)
            downloads.emit = { event in
                let status = event["status"] as? String
                if status == "completed" || status == "failed" { done.signal() }
            }
            try downloads.startTransfer([
                "serverId": "srv-plex", "viewerId": "viewer-1", "titleId": "slow",
                "url": "\(origin)/media/slow.mkv", "headers": ["X-Plex-Token": "secret-token"],
                "container": "mkv", "mimeType": "video/x-matroska", "byteLength": 32, "wifiOnly": true, "sidecars": [],
            ])
            var leaked = false
            var sawMeta = false
            if let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) {
                for case let file as URL in walker {
                    if file.lastPathComponent == "transfer.json" { sawMeta = true }
                    if let data = try? Data(contentsOf: file), let text = String(data: data, encoding: .utf8),
                       text.contains("secret-token") { leaked = true }
                }
            }
            guard sawMeta, !leaked else {
                fputs("credential headers on disk: meta=\(sawMeta) leaked=\(leaked)\n", stderr)
                exit(1)
            }
            guard done.wait(timeout: .now() + 10) == .success else {
                fputs("slow transfer timed out\n", stderr)
                exit(1)
            }
            print("credentials_ok")

        case "redirect":
            // A download that redirects to another origin is refused before any byte; an auxiliary
            // fetch never follows a redirect there.
            let other = origin.replacingOccurrences(of: "127.0.0.1", with: "localhost")
            do {
                try downloads.startTransfer([
                    "serverId": "srv-plex", "viewerId": "viewer-1", "titleId": "away",
                    "url": "\(origin)/redirect?to=\(other)/media/101.mkv", "headers": ["X-Plex-Token": "secret-token"],
                    "container": "mkv", "mimeType": "video/x-matroska", "byteLength": 32, "wifiOnly": true, "sidecars": [],
                ])
                fputs("cross-origin redirect was accepted\n", stderr)
                exit(1)
            } catch {}
            let done = DispatchSemaphore(value: 0)
            var last: [String: Any] = [:]
            downloads.emit = { event in
                let status = event["status"] as? String
                if status == "completed" || status == "failed" { last = event; done.signal() }
            }
            try downloads.startTransfer([
                "serverId": "srv-plex", "viewerId": "viewer-1", "titleId": "101",
                "url": "\(origin)/redirect?to=\(origin)/media/101.mkv", "headers": ["X-Plex-Token": "secret-token"],
                "container": "mkv", "mimeType": "video/x-matroska", "byteLength": 32, "wifiOnly": true,
                "posterUrl": "\(origin)/redirect?to=\(other)/poster/101.jpg", "sidecars": [],
            ])
            guard done.wait(timeout: .now() + 10) == .success, last["status"] as? String == "completed", last["posterPath"] == nil else {
                fputs("same-origin redirect download failed or the poster followed another origin: \(last)\n", stderr)
                exit(1)
            }
            print("redirect_ok")

        default:
            fputs("unknown mode \(mode)\n", stderr)
            exit(2)
        }
    }
}
