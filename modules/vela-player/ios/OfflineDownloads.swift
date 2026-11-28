// Background downloads and local original-file storage for iPhone and iPad (packages/core DownloadsPort).
// Stored under Application Support/vela-downloads/<serverId>/<viewerId>/<titleId>/ with isExcludedFromBackup = true.
// Paths in index.json and outbox.json stay relative to vela-downloads/ and are resolved against the current
// Application Support URL on every read so an iOS container UUID change never breaks offline playback.
// Credential headers never reach a plain file: transfer.json keeps the request without them, and a
// transfer the system finishes after a relaunch reads them from the Keychain (this device only),
// deleted as soon as the transfer ends. Credentials go only to the download's own origin
// (docs/downloads.md): auxiliary fetches refuse redirects elsewhere, a download that redirects
// elsewhere is refused before the background session takes it, and one that ended elsewhere fails.
import Foundation
import Security

/// Where an in-flight transfer's credential headers survive an app relaunch.
protocol TransferCredentialStore: AnyObject {
    func save(_ headers: [String: String], forKey key: String)
    func load(forKey key: String) -> [String: String]
    func remove(forKey key: String)
}

/// The Keychain, readable after the first unlock so background completion works while locked.
final class KeychainTransferCredentials: TransferCredentialStore {
    private let service = "app.ether.vela.downloads.transfer"
    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }
    func save(_ headers: [String: String], forKey key: String) {
        SecItemDelete(query(key) as CFDictionary)
        guard !headers.isEmpty, let data = try? JSONEncoder().encode(headers) else { return }
        var item = query(key)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
    func load(forKey key: String) -> [String: String] {
        var item = query(key)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return [:] }
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }
    func remove(forKey key: String) { SecItemDelete(query(key) as CFDictionary) }
}

/// Memory only: a relaunched process has no credentials (tests, and hosts without a background session).
final class MemoryTransferCredentials: TransferCredentialStore {
    private var values: [String: [String: String]] = [:]
    private let lock = NSLock()
    func save(_ headers: [String: String], forKey key: String) { lock.lock(); values[key] = headers; lock.unlock() }
    func load(forKey key: String) -> [String: String] { lock.lock(); defer { lock.unlock() }; return values[key] ?? [:] }
    func remove(forKey key: String) { lock.lock(); values.removeValue(forKey: key); lock.unlock() }
}

/// Scheme, host and port as a connection uses them; two URLs share credentials only when equal.
func downloadOrigin(_ url: URL?) -> String? {
    guard let url, let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
          let host = url.host?.lowercased(), !host.isEmpty, url.user == nil, url.password == nil else { return nil }
    let port = url.port ?? (scheme == "https" ? 443 : 80)
    return "\(scheme)://\(host):\(port)"
}

/// Follows redirects only within the request's own origin; anything else ends the request unfollowed.
final class SameOriginRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        let from = downloadOrigin(task.originalRequest?.url)
        completionHandler(from != nil && downloadOrigin(request.url) == from ? request : nil)
    }
}

final class OfflineDownloads: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let shared = OfflineDownloads()

    private struct SidecarRequest: Codable {
        let trackId: String
        let format: String
        let url: String
    }

    private struct TransferMeta: Codable {
        let key: String
        let serverId: String
        let viewerId: String
        let titleId: String
        let url: String
        var headers: [String: String]
        let container: String
        let mimeType: String
        let byteLength: Int64?
        let etag: String?
        let wifiOnly: Bool
        let posterUrl: String?
        let sidecars: [SidecarRequest]

        enum CodingKeys: String, CodingKey {
            case key, serverId, viewerId, titleId, url, container, mimeType, byteLength, etag, wifiOnly, posterUrl, sidecars
        }

        init(key: String, serverId: String, viewerId: String, titleId: String, url: String, headers: [String: String],
             container: String, mimeType: String, byteLength: Int64?, etag: String?, wifiOnly: Bool, posterUrl: String?,
             sidecars: [SidecarRequest]) {
            self.key = key; self.serverId = serverId; self.viewerId = viewerId; self.titleId = titleId; self.url = url
            self.headers = headers; self.container = container; self.mimeType = mimeType; self.byteLength = byteLength
            self.etag = etag; self.wifiOnly = wifiOnly; self.posterUrl = posterUrl; self.sidecars = sidecars
        }

        /// Headers are never encoded: transfer.json holds the request without its credentials.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            key = try c.decode(String.self, forKey: .key)
            serverId = try c.decode(String.self, forKey: .serverId)
            viewerId = try c.decode(String.self, forKey: .viewerId)
            titleId = try c.decode(String.self, forKey: .titleId)
            url = try c.decode(String.self, forKey: .url)
            headers = [:]
            container = try c.decode(String.self, forKey: .container)
            mimeType = try c.decode(String.self, forKey: .mimeType)
            byteLength = try c.decodeIfPresent(Int64.self, forKey: .byteLength)
            etag = try c.decodeIfPresent(String.self, forKey: .etag)
            wifiOnly = try c.decode(Bool.self, forKey: .wifiOnly)
            posterUrl = try c.decodeIfPresent(String.self, forKey: .posterUrl)
            sidecars = try c.decode([SidecarRequest].self, forKey: .sidecars)
        }
    }

    private let rootDirectory: URL
    private let sessionIdentifier: String
    private let useBackgroundSession: Bool
    private let lock = NSLock()
    private let credentials: TransferCredentialStore
    private let redirects = SameOriginRedirects()
    private lazy var auxiliarySession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: redirects, delegateQueue: nil)
    }()
    private var transfers: [String: TransferMeta] = [:]
    private var activeTasks: [String: URLSessionDownloadTask] = [:]
    private var lastProgressAt: [String: TimeInterval] = [:]
    private var backgroundCompletionHandlers: [String: () -> Void] = [:]
    private lazy var wifiSession: URLSession = makeSession(identifier: "\(sessionIdentifier).wifi", allowsCellular: false)
    private lazy var cellularSession: URLSession = makeSession(identifier: "\(sessionIdentifier).cellular", allowsCellular: true)
    var emit: (([String: Any]) -> Void)?

    override convenience init() {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let root = appSupport.appendingPathComponent("vela-downloads", isDirectory: true)
        #if os(iOS)
        let background = true
        #else
        let background = false
        #endif
        self.init(rootDirectory: root, sessionIdentifier: "app.ether.vela.downloads", useBackgroundSession: background,
                  credentials: background ? KeychainTransferCredentials() : MemoryTransferCredentials())
    }

    init(rootDirectory: URL, sessionIdentifier: String = "app.ether.vela.downloads", useBackgroundSession: Bool = false,
         credentials: TransferCredentialStore = MemoryTransferCredentials()) {
        var standardized = rootDirectory.standardizedFileURL
        self.credentials = credentials
        self.rootDirectory = standardized
        self.sessionIdentifier = sessionIdentifier
        self.useBackgroundSession = useBackgroundSession
        super.init()
        ensureDirectory(&standardized, excludeFromBackup: true)
        loadPersistedTransfers()
    }

    private func makeSession(identifier: String, allowsCellular: Bool) -> URLSession {
        let config: URLSessionConfiguration
        if useBackgroundSession {
            config = URLSessionConfiguration.background(withIdentifier: identifier)
            config.isDiscretionary = false
            config.sessionSendsLaunchEvents = true
        } else {
            config = URLSessionConfiguration.default
        }
        config.allowsCellularAccess = allowsCellular
        config.allowsExpensiveNetworkAccess = allowsCellular
        config.allowsConstrainedNetworkAccess = allowsCellular
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.httpShouldSetCookies = false
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }

    func handleEventsForBackgroundURLSession(identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier.hasPrefix(sessionIdentifier) else {
            completionHandler()
            return
        }
        lock.lock()
        backgroundCompletionHandlers[identifier] = completionHandler
        lock.unlock()
        // Touching the matching session reconnects the background daemon to this delegate.
        if identifier.hasSuffix(".cellular") {
            _ = cellularSession
        } else {
            _ = wifiSession
        }
    }

    // MARK: Directory & Snapshot Persistence

    func baseDirectoryUrl() -> String {
        var str = rootDirectory.absoluteString
        if !str.hasSuffix("/") { str += "/" }
        return str
    }

    func freeBytes() -> Int64? {
        var dir = rootDirectory
        ensureDirectory(&dir, excludeFromBackup: true)
        return PlaybackCacheBudget.freeBytes(at: dir)
    }

    func readSnapshot() -> [String: Any] {
        // Reattach to transfers still owned by the system after the app has relaunched.
        if useBackgroundSession {
            reconnectTasks(in: wifiSession)
            reconnectTasks(in: cellularSession)
        }
        lock.lock()
        defer { lock.unlock() }
        let records = (readJSON(at: rootDirectory.appendingPathComponent("index.json")) as? [[String: Any]]) ?? []
        let items = records.map { record -> [String: Any] in
            guard let directory = eventDirectory(record),
                  let event = readJSON(at: directory.appendingPathComponent("transfer-status.json")) as? [String: Any] else {
                return record
            }
            var updated = record.merging(event) { _, latest in latest }
            if event["status"] as? String == "completed" {
                updated.removeValue(forKey: "previousCompleted")
                updated.removeValue(forKey: "error")
                updated.removeValue(forKey: "errorCode")
                updated.removeValue(forKey: "neededBytes")
            }
            return updated
        }
        let outbox = (readJSON(at: rootDirectory.appendingPathComponent("outbox.json")) as? [[String: Any]]) ?? []
        return ["items": items, "outbox": outbox]
    }

    private func reconnectTasks(in session: URLSession) {
        session.getAllTasks { [weak self] tasks in
            guard let self else { return }
            self.lock.lock()
            for case let task as URLSessionDownloadTask in tasks {
                guard let key = task.taskDescription, self.transfers[key] != nil, self.activeTasks[key] == nil,
                      task.state == .running || task.state == .suspended else { continue }
                self.activeTasks[key] = task
            }
            self.lock.unlock()
            self.reportOrphanedTransfers(wifiOnly: session === self.wifiSession)
        }
    }

    /// A persisted transfer the system no longer runs (a force-quit, a reboot) is interrupted: core
    /// resumes it with fresh credentials from the partial file.
    private func reportOrphanedTransfers(wifiOnly: Bool) {
        lock.lock()
        let orphans = transfers.values.filter { $0.wifiOnly == wifiOnly && activeTasks[$0.key] == nil }
        lock.unlock()
        for meta in orphans {
            let part = partialMediaURL(for: meta)
            let written = ((try? FileManager.default.attributesOfItem(atPath: part.path)[.size] as? NSNumber)?.int64Value) ?? 0
            interruptTransfer(meta, bytesWritten: written)
        }
    }

    private func interruptTransfer(_ meta: TransferMeta, bytesWritten: Int64) {
        emitEvent([
            "serverId": meta.serverId,
            "viewerId": meta.viewerId,
            "titleId": meta.titleId,
            "status": "paused",
            "bytesWritten": bytesWritten,
            "byteLength": meta.byteLength as Any,
            "error": "The download was interrupted before it finished",
            "errorCode": "interrupted",
        ])
    }

    func writeSnapshot(_ snapshot: [String: Any]) throws {
        lock.lock()
        defer { lock.unlock() }
        var dir = rootDirectory
        ensureDirectory(&dir, excludeFromBackup: true)
        let items = (snapshot["items"] as? [Any]) ?? []
        let outbox = (snapshot["outbox"] as? [Any]) ?? []
        try writeJSONAtomically(items, to: rootDirectory.appendingPathComponent("index.json"))
        try writeJSONAtomically(outbox, to: rootDirectory.appendingPathComponent("outbox.json"))
    }

    // MARK: Transfer Control

    func startTransfer(_ request: [String: Any]) throws {
        let meta = try parseTransferRequest(request)
        try launchTransfer(meta, preferResumeData: false)
    }

    func resumeTransfer(_ request: [String: Any]) throws {
        let meta = try parseTransferRequest(request)
        try launchTransfer(meta, preferResumeData: true)
    }

    func pauseTransfer(serverId: String, viewerId: String, titleId: String) {
        let key = Self.transferKey(serverId: serverId, viewerId: viewerId, titleId: titleId)
        lock.lock()
        let task = activeTasks[key]
        let meta = transfers[key]
        lock.unlock()
        guard let task else { return }
        let resumeFile = resumeDataURL(serverId: serverId, viewerId: viewerId, titleId: titleId)
        let semaphore = DispatchSemaphore(value: 0)
        task.cancel { [weak self] data in
            defer { semaphore.signal() }
            guard let self else { return }
            self.lock.lock()
            defer { self.lock.unlock() }
            guard self.activeTasks[key] === task, let data, !data.isEmpty else { return }
            try? data.write(to: resumeFile, options: .atomic)
            self.excludeItemFromBackup(resumeFile)
        }
        _ = semaphore.wait(timeout: .now() + 2)
        lock.lock()
        let isCurrent = activeTasks[key] === task
        if isCurrent { activeTasks.removeValue(forKey: key) }
        lock.unlock()
        if isCurrent, let meta {
            emitEvent([
                "serverId": meta.serverId,
                "viewerId": meta.viewerId,
                "titleId": meta.titleId,
                "status": "paused",
                "bytesWritten": task.countOfBytesReceived,
                "byteLength": meta.byteLength as Any,
            ])
        }
    }

    func removeTitle(serverId: String, viewerId: String, titleId: String) {
        let key = Self.transferKey(serverId: serverId, viewerId: viewerId, titleId: titleId)
        cancelTask(forKey: key)
        guard let dir = safeChildDirectory([serverId, viewerId, titleId]) else { return }
        try? FileManager.default.removeItem(at: dir)
    }

    func removeViewer(serverId: String, viewerId: String) {
        let prefix = "\(serverId)/\(viewerId)/"
        cancelTasks(withPrefix: prefix)
        guard let dir = safeChildDirectory([serverId, viewerId]) else { return }
        try? FileManager.default.removeItem(at: dir)
    }

    func removeServer(serverId: String) {
        let prefix = "\(serverId)/"
        cancelTasks(withPrefix: prefix)
        guard let dir = safeChildDirectory([serverId]) else { return }
        try? FileManager.default.removeItem(at: dir)
    }

    // MARK: Internal Transfer Management

    private static func transferKey(serverId: String, viewerId: String, titleId: String) -> String {
        "\(serverId)/\(viewerId)/\(titleId)"
    }

    private func parseTransferRequest(_ dict: [String: Any]) throws -> TransferMeta {
        guard
            let serverId = dict["serverId"] as? String, Self.isSafeComponent(serverId),
            let viewerId = dict["viewerId"] as? String, Self.isSafeComponent(viewerId),
            let titleId = dict["titleId"] as? String, Self.isSafeComponent(titleId),
            let urlText = dict["url"] as? String, let url = URL(string: urlText),
            ["http", "https"].contains(url.scheme?.lowercased() ?? "")
        else {
            throw NSError(domain: "VelaDownloads", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid download transfer request"])
        }
        let rawHeaders = (dict["headers"] as? [String: Any]) ?? [:]
        var headers: [String: String] = [:]
        for (k, v) in rawHeaders {
            if let s = v as? String { headers[k] = s }
        }
        let container = Self.sanitizeExtension((dict["container"] as? String) ?? "mp4", fallback: "mp4")
        let mimeType = (dict["mimeType"] as? String) ?? "video/mp4"
        let byteLength = (dict["byteLength"] as? NSNumber)?.int64Value
        let etag = dict["etag"] as? String
        let wifiOnly = (dict["wifiOnly"] as? Bool) ?? true
        let posterUrl = dict["posterUrl"] as? String
        let rawSidecars = (dict["sidecars"] as? [[String: Any]]) ?? []
        let sidecars: [SidecarRequest] = rawSidecars.compactMap { item in
            guard let trackId = item["trackId"] as? String, Self.isSafeComponent(trackId),
                  let url = item["url"] as? String, !url.isEmpty else { return nil }
            let format = Self.sanitizeExtension((item["format"] as? String) ?? "srt", fallback: "srt")
            return SidecarRequest(trackId: trackId, format: format, url: url)
        }
        let key = Self.transferKey(serverId: serverId, viewerId: viewerId, titleId: titleId)
        return TransferMeta(
            key: key,
            serverId: serverId,
            viewerId: viewerId,
            titleId: titleId,
            url: urlText,
            headers: headers,
            container: container,
            mimeType: mimeType,
            byteLength: byteLength,
            etag: etag,
            wifiOnly: wifiOnly,
            posterUrl: posterUrl,
            sidecars: sidecars
        )
    }

    /// CFNetwork keeps the partial file. Replace both archived requests and the URL that names
    /// the download, leaving the byte count, validator and temporary file reference intact.
    /// Only accept the keyed-archive layout we recognize. A new OS layout can start from scratch.
    private static func retargetResumeData(_ data: Data, previous: TransferMeta, request: URLRequest) -> Data? {
        let rootKey = "NSKeyedArchiveRootObjectKey"
        let urlKey = "NSURLSessionDownloadURL"
        let currentKey = "NSURLSessionResumeCurrentRequest"
        let originalKey = "NSURLSessionResumeOriginalRequest"
        guard let url = request.url, let etag = previous.etag, etag.hasPrefix("\""), etag.hasSuffix("\""),
              let length = previous.byteLength,
              downloadOrigin(url) == downloadOrigin(URL(string: previous.url)),
              let decoder = try? NSKeyedUnarchiver(forReadingFrom: data) else { return nil }
        decoder.requiresSecureCoding = true
        decoder.decodingFailurePolicy = .setErrorAndReturn
        guard decoder.containsValue(forKey: rootKey),
              var info = decoder.decodeObject(
                  of: [NSDictionary.self, NSString.self, NSNumber.self, NSData.self, NSDate.self], forKey: rootKey
              ) as? [String: Any] else { return nil }
        decoder.finishDecoding()
        guard decoder.error == nil,
              info[urlKey] as? String == previous.url,
              info[currentKey] is Data, info[originalKey] is Data,
              info["NSURLSessionResumeEntityTag"] as? String == etag,
              let offset = (info["NSURLSessionResumeBytesReceived"] as? NSNumber)?.int64Value,
              offset > 0, offset < length,
              let tempFile = info["NSURLSessionResumeInfoTempFileName"] as? String,
              isSafeComponent(tempFile),
              request.value(forHTTPHeaderField: "Range") == nil else { return nil }

        let requestEncoder = NSKeyedArchiver(requiringSecureCoding: true)
        requestEncoder.encode(request as NSURLRequest, forKey: rootKey)
        let encodedRequest = requestEncoder.encodedData
        info[currentKey] = encodedRequest
        info[originalKey] = encodedRequest
        info[urlKey] = url.absoluteString

        let encoder = NSKeyedArchiver(requiringSecureCoding: true)
        encoder.encode(info as NSDictionary, forKey: rootKey)
        return encoder.encodedData
    }

    private func launchTransfer(_ meta: TransferMeta, preferResumeData: Bool) throws {
        guard let titleDir = safeChildDirectory([meta.serverId, meta.viewerId, meta.titleId]),
              let url = URL(string: meta.url) else {
            throw NSError(domain: "VelaDownloads", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid download directory or URL"])
        }
        if let refusal = preflightRedirect(url: url, headers: meta.headers) {
            throw NSError(domain: "VelaDownloads", code: 3, userInfo: [NSLocalizedDescriptionKey: refusal])
        }
        lock.lock()
        let previous = transfers[meta.key]
        lock.unlock()
        let sameFile = previous.map {
            $0.key == meta.key && $0.etag == meta.etag && $0.container == meta.container && $0.byteLength == meta.byteLength
        } ?? true
        let session = meta.wifiOnly ? wifiSession : cellularSession
        let resumeFile = resumeDataURL(serverId: meta.serverId, viewerId: meta.viewerId, titleId: meta.titleId)
        let partFile = partialMediaURL(for: meta)
        let files = FileManager.default
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        for (name, value) in meta.headers {
            req.setValue(value, forHTTPHeaderField: name)
        }

        cancelTask(forKey: meta.key)
        var dir = titleDir
        ensureDirectory(&dir, excludeFromBackup: true)
        try? files.removeItem(at: titleDir.appendingPathComponent("transfer-status.json"))

        var systemResume: Data?
        // Each background session owns its own temporary files. An explicit .part uses
        // HTTP Range below, since the system file in that case can contain only the suffix.
        if preferResumeData, sameFile, let previous, previous.wifiOnly == meta.wifiOnly,
           !files.fileExists(atPath: partFile.path),
           let data = try? Data(contentsOf: resumeFile), !data.isEmpty {
            systemResume = previous.url == meta.url && previous.headers == meta.headers
                ? data : Self.retargetResumeData(data, previous: previous, request: req)
        }
        try? files.removeItem(at: resumeFile)
        if !sameFile, let previous {
            try? files.removeItem(at: partialMediaURL(for: previous))
        }
        saveTransferMeta(meta)
        credentials.save(meta.headers, forKey: meta.key)

        let task: URLSessionDownloadTask
        if let systemResume {
            task = session.downloadTask(withResumeData: systemResume)
        } else {
            if preferResumeData, sameFile, let etag = meta.etag, !etag.isEmpty,
               let attrs = try? files.attributesOfItem(atPath: partFile.path),
               let existingBytes = (attrs[.size] as? NSNumber)?.int64Value,
               existingBytes > 0 {
                req.setValue("bytes=\(existingBytes)-", forHTTPHeaderField: "Range")
                req.setValue(etag, forHTTPHeaderField: "If-Range")
            } else {
                try? files.removeItem(at: partFile)
            }
            task = session.downloadTask(with: req)
        }
        task.taskDescription = meta.key
        lock.lock()
        transfers[meta.key] = meta
        activeTasks[meta.key] = task
        lastProgressAt.removeValue(forKey: meta.key)
        lock.unlock()
        task.resume()
    }

    private func cancelTask(forKey key: String) {
        lock.lock()
        let task = activeTasks.removeValue(forKey: key)
        transfers.removeValue(forKey: key)
        lastProgressAt.removeValue(forKey: key)
        lock.unlock()
        task?.cancel()
        removePersistedTransferMeta(forKey: key)
        credentials.remove(forKey: key)
    }

    private func cancelTasks(withPrefix prefix: String) {
        lock.lock()
        let keys = Set(activeTasks.keys.filter { $0.hasPrefix(prefix) })
            .union(transfers.keys.filter { $0.hasPrefix(prefix) })
        var tasks: [URLSessionDownloadTask] = []
        for k in keys {
            if let t = activeTasks.removeValue(forKey: k) { tasks.append(t) }
            transfers.removeValue(forKey: k)
            lastProgressAt.removeValue(forKey: k)
        }
        lock.unlock()
        for t in tasks { t.cancel() }
        for k in keys { removePersistedTransferMeta(forKey: k); credentials.remove(forKey: k) }
    }

    /// Called with the lock held. Background tasks can complete before getAllTasks reattaches them.
    private func isCurrentTask(_ task: URLSessionTask, forKey key: String) -> Bool {
        if let active = activeTasks[key] { return active === task }
        return useBackgroundSession && task.originalRequest?.url?.absoluteString == transfers[key]?.url
    }

    // MARK: URLSessionDownloadDelegate

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let key = downloadTask.taskDescription else { return }
        let now = Date().timeIntervalSince1970
        lock.lock()
        guard isCurrentTask(downloadTask, forKey: key), let meta = transfers[key] else {
            lock.unlock()
            return
        }
        let previous = lastProgressAt[key] ?? 0
        if now - previous < 0.15 && totalBytesWritten != totalBytesExpectedToWrite {
            lock.unlock()
            return
        }
        lastProgressAt[key] = now
        lock.unlock()

        let response = downloadTask.response as? HTTPURLResponse
        let offset = response?.statusCode == 206 && downloadTask.originalRequest?.value(forHTTPHeaderField: "Range") != nil
            ? Self.startByteFromContentRange(response?.value(forHTTPHeaderField: "Content-Range")) ?? 0 : 0
        let expected = meta.byteLength ?? Self.totalBytesFromContentRange(response?.value(forHTTPHeaderField: "Content-Range"))
            ?? (totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite + offset : nil)
        var event: [String: Any] = [
            "serverId": meta.serverId,
            "viewerId": meta.viewerId,
            "titleId": meta.titleId,
            "status": "downloading",
            "bytesWritten": totalBytesWritten + offset,
        ]
        if let expected, expected > 0 { event["byteLength"] = expected }
        emitEvent(event)
    }

    /// Foreground sessions ask before following a redirect: only within the download's own origin.
    /// (Background sessions follow redirects themselves; preflightRedirect and the origin check on
    /// completion cover those.)
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        redirects.urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request, completionHandler: completionHandler)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        guard let key = downloadTask.taskDescription else { return }
        lock.lock()
        guard isCurrentTask(downloadTask, forKey: key), let meta = transfers[key] else {
            lock.unlock()
            return
        }
        activeTasks.removeValue(forKey: key)
        lock.unlock()

        if let ended = downloadTask.currentRequest?.url, downloadOrigin(ended) != downloadOrigin(URL(string: meta.url)) {
            endTransfer(meta)
            failTransfer(meta, code: "forbidden", message: "The server sent the download to another address, which Vela doesn't follow.", bytesWritten: 0)
            return
        }

        let http = downloadTask.response as? HTTPURLResponse
        let status = http?.statusCode ?? 200
        if status != 200 && status != 206 {
            let (code, message) = Self.classifyHTTPError(status: status, response: http)
            failTransfer(meta, code: code, message: message, bytesWritten: 0)
            return
        }

        if let expected = meta.etag, let received = http?.value(forHTTPHeaderField: "ETag"), expected != received {
            failTransfer(meta, code: "corrupt", message: "The original file changed. Retry to get a fresh download.", bytesWritten: 0)
            return
        }

        guard let titleDir = safeChildDirectory([meta.serverId, meta.viewerId, meta.titleId]) else { return }
        var mutableTitleDir = titleDir
        ensureDirectory(&mutableTitleDir, excludeFromBackup: true)

        let partFile = partialMediaURL(for: meta)
        let hasPartial = FileManager.default.fileExists(atPath: partFile.path)
        let finalFile = titleDir.appendingPathComponent("media.\(meta.container)")

        if status == 206, !hasPartial {
            let range = http?.value(forHTTPHeaderField: "Content-Range")
            guard let offset = Self.startByteFromContentRange(range),
                  let total = Self.totalBytesFromContentRange(range), offset < total,
                  meta.byteLength.map({ $0 == total }) ?? true,
                  let etag = meta.etag, http?.value(forHTTPHeaderField: "ETag") == etag else {
                failTransfer(meta, code: "corrupt", message: "The server returned a different file range. Retry the download.", bytesWritten: 0)
                return
            }
        }

        do {
            if status == 206, hasPartial {
                let size = (try FileManager.default.attributesOfItem(atPath: partFile.path)[.size] as? NSNumber)?.int64Value
                guard let offset = Self.startByteFromContentRange(http?.value(forHTTPHeaderField: "Content-Range")),
                      size == offset, let etag = meta.etag, http?.value(forHTTPHeaderField: "ETag") == etag else {
                    try? FileManager.default.removeItem(at: partFile)
                    failTransfer(meta, code: "corrupt", message: "The server returned a different file range. Retry the download.", bytesWritten: 0)
                    return
                }
                try Self.appendFile(from: location, to: partFile)
            } else {
                try? FileManager.default.removeItem(at: partFile)
                try FileManager.default.moveItem(at: location, to: partFile)
            }
            excludeItemFromBackup(partFile)
        } catch {
            let code: String = Self.isNoSpaceError(error) ? "no_space" : "unknown"
            failTransfer(meta, code: code, message: "Could not save the downloaded file to disk", bytesWritten: 0)
            return
        }

        let actualSize = ((try? FileManager.default.attributesOfItem(atPath: partFile.path)[.size] as? NSNumber)?.int64Value) ?? 0
        let totalFromHeader = Self.totalBytesFromContentRange(http?.value(forHTTPHeaderField: "Content-Range"))
            ?? (status == 200 ? (http?.expectedContentLength ?? -1) : -1)
        let expectedSize: Int64? = meta.byteLength ?? (totalFromHeader > 0 ? totalFromHeader : nil)

        if actualSize <= 0 || (expectedSize != nil && actualSize != expectedSize!) {
            failTransfer(
                meta,
                code: "corrupt",
                message: "The downloaded file was incomplete (\(actualSize) of \(expectedSize ?? 0) bytes)",
                bytesWritten: actualSize
            )
            return
        }

        do {
            if FileManager.default.fileExists(atPath: finalFile.path) {
                _ = try FileManager.default.replaceItemAt(finalFile, withItemAt: partFile)
            } else {
                try FileManager.default.moveItem(at: partFile, to: finalFile)
            }
            excludeItemFromBackup(finalFile)
        } catch {
            let code: String = Self.isNoSpaceError(error) ? "no_space" : "unknown"
            failTransfer(meta, code: code, message: "Could not finalize the downloaded file", bytesWritten: actualSize)
            return
        }

        try? FileManager.default.removeItem(at: resumeDataURL(serverId: meta.serverId, viewerId: meta.viewerId, titleId: meta.titleId))
        let posterRelative = fetchPoster(for: meta, into: titleDir)
        let sidecarRelatives = fetchSidecars(for: meta, into: titleDir)

        endTransfer(meta)

        let mediaRelative = "\(meta.serverId)/\(meta.viewerId)/\(meta.titleId)/media.\(meta.container)"
        var event: [String: Any] = [
            "serverId": meta.serverId,
            "viewerId": meta.viewerId,
            "titleId": meta.titleId,
            "status": "completed",
            "bytesWritten": actualSize,
            "byteLength": actualSize,
            "mediaPath": mediaRelative,
            "completedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        if let etag = http?.value(forHTTPHeaderField: "ETag") ?? meta.etag {
            event["etag"] = etag
        }
        if let lastModified = http?.value(forHTTPHeaderField: "Last-Modified") {
            event["lastModified"] = lastModified
        }
        if let posterRelative {
            event["posterPath"] = posterRelative
        }
        if !sidecarRelatives.isEmpty {
            event["sidecarPaths"] = sidecarRelatives
        }
        emitEvent(event)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        guard let key = task.taskDescription else { return }
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
            return
        }
        lock.lock()
        guard isCurrentTask(task, forKey: key), let meta = transfers[key] else {
            lock.unlock()
            return
        }
        activeTasks.removeValue(forKey: key)
        if let resumeData = nsError.userInfo[NSURLSessionDownloadTaskResumeData] as? Data, !resumeData.isEmpty {
            let resumeFile = resumeDataURL(serverId: meta.serverId, viewerId: meta.viewerId, titleId: meta.titleId)
            var dir = resumeFile.deletingLastPathComponent()
            ensureDirectory(&dir, excludeFromBackup: true)
            try? resumeData.write(to: resumeFile, options: .atomic)
            excludeItemFromBackup(resumeFile)
        }
        lock.unlock()
        if Self.isNoSpaceError(error) {
            failTransfer(meta, code: "no_space", message: "Not enough free storage space to finish downloading",
                         bytesWritten: task.countOfBytesReceived)
        } else {
            // A lost network: core resumes it, with fresh credentials, once it is back online.
            interruptTransfer(meta, bytesWritten: task.countOfBytesReceived)
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        guard let id = session.configuration.identifier else { return }
        lock.lock()
        let handler = backgroundCompletionHandlers.removeValue(forKey: id)
        lock.unlock()
        if let handler {
            DispatchQueue.main.async { handler() }
        }
    }

    // MARK: Sidecars & Artwork

    private func fetchPoster(for meta: TransferMeta, into titleDir: URL) -> String? {
        guard let posterUrlText = meta.posterUrl, let url = URL(string: posterUrlText),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            return nil
        }
        guard let (data, response) = fetchAuxiliaryResource(url: url, headers: meta.headers),
              !data.isEmpty else {
            return nil
        }
        let mime = response?.mimeType?.lowercased() ?? ""
        let ext = mime.contains("svg") ? "svg" : mime.contains("png") ? "png" : mime.contains("webp") ? "webp" : "jpg"
        let target = titleDir.appendingPathComponent("poster.\(ext)")
        do {
            try data.write(to: target, options: .atomic)
            excludeItemFromBackup(target)
            return "\(meta.serverId)/\(meta.viewerId)/\(meta.titleId)/poster.\(ext)"
        } catch {
            return nil
        }
    }

    private func fetchSidecars(for meta: TransferMeta, into titleDir: URL) -> [String: String] {
        guard !meta.sidecars.isEmpty else { return [:] }
        var subsDir = titleDir.appendingPathComponent("subtitles", isDirectory: true)
        ensureDirectory(&subsDir, excludeFromBackup: true)
        var out: [String: String] = [:]
        for sidecar in meta.sidecars {
            guard let url = URL(string: sidecar.url),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  let (data, _) = fetchAuxiliaryResource(url: url, headers: meta.headers),
                  !data.isEmpty else {
                continue
            }
            let fileName = "\(sidecar.trackId).\(sidecar.format)"
            let target = subsDir.appendingPathComponent(fileName)
            if (try? data.write(to: target, options: .atomic)) != nil {
                excludeItemFromBackup(target)
                out[sidecar.trackId] = "\(meta.serverId)/\(meta.viewerId)/\(meta.titleId)/subtitles/\(fileName)"
            }
        }
        return out
    }

    private func fetchAuxiliaryResource(url: URL, headers: [String: String]) -> (Data, HTTPURLResponse?)? {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        for (name, value) in headers {
            req.setValue(value, forHTTPHeaderField: name)
        }
        let sem = DispatchSemaphore(value: 0)
        var resultData: Data?
        var resultHTTP: HTTPURLResponse?
        let task = auxiliarySession.dataTask(with: req) { data, response, error in
            if error == nil, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                resultData = data
                resultHTTP = http
            }
            sem.signal()
        }
        task.resume()
        _ = sem.wait(timeout: .now() + 22)
        guard let data = resultData else { return nil }
        return (data, resultHTTP)
    }

    // MARK: Helpers

    /// Forget a finished or failed transfer: its in-memory request, transfer.json and Keychain headers.
    private func endTransfer(_ meta: TransferMeta) {
        lock.lock()
        transfers.removeValue(forKey: meta.key)
        lastProgressAt.removeValue(forKey: meta.key)
        lock.unlock()
        removePersistedTransferMeta(forKey: meta.key)
        credentials.remove(forKey: meta.key)
    }

    /// Ask for the first byte without following redirects: a download that redirects to another
    /// origin is refused before the background session (which follows redirects itself) takes it.
    /// Network failures here are not refusals; the transfer itself reports them.
    private func preflightRedirect(url: URL, headers: [String: String]) -> String? {
        guard downloadOrigin(url) != nil else { return "Invalid download URL" }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        for (name, value) in headers { req.setValue(value, forHTTPHeaderField: name) }
        req.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        let sem = DispatchSemaphore(value: 0)
        var refused: String?
        let task = auxiliarySession.dataTask(with: req) { _, response, _ in
            if let http = response as? HTTPURLResponse, (300..<400).contains(http.statusCode),
               let location = http.value(forHTTPHeaderField: "Location"),
               downloadOrigin(URL(string: location, relativeTo: url)?.absoluteURL) != downloadOrigin(url) {
                refused = "The server sends this download to another address, which Vela doesn't follow."
            }
            sem.signal()
        }
        task.resume()
        if sem.wait(timeout: .now() + 16) == .timedOut { task.cancel() }
        return refused
    }

    private func failTransfer(_ meta: TransferMeta, code: String, message: String, bytesWritten: Int64) {
        // A refused transfer is over: nothing may keep its credentials.
        if code == "forbidden" { credentials.remove(forKey: meta.key) }
        emitEvent([
            "serverId": meta.serverId,
            "viewerId": meta.viewerId,
            "titleId": meta.titleId,
            "status": "failed",
            "bytesWritten": bytesWritten,
            "byteLength": meta.byteLength as Any,
            "error": message,
            "errorCode": code,
        ])
    }

    private func eventDirectory(_ record: [String: Any]) -> URL? {
        guard let server = record["serverId"] as? String, let viewer = record["viewerId"] as? String,
              let title = record["titleId"] as? String else { return nil }
        return safeChildDirectory([server, viewer, title])
    }

    private func emitEvent(_ payload: [String: Any]) {
        // Completion can arrive before JavaScript has attached a listener. Store the update next
        // to the file so an older index write from JavaScript cannot hide a verified download.
        if payload["status"] as? String != "downloading", let dir = eventDirectory(payload) {
            lock.lock()
            let snapshot = payload.filter { JSONSerialization.isValidJSONObject([$0.value]) }
            try? writeJSONAtomically(snapshot, to: dir.appendingPathComponent("transfer-status.json"))
            lock.unlock()
        }
        emit?(payload)
    }

    private func partialMediaURL(for meta: TransferMeta) -> URL {
        let dir = safeChildDirectory([meta.serverId, meta.viewerId, meta.titleId]) ?? rootDirectory
        return dir.appendingPathComponent("media.\(meta.container).part")
    }

    private func resumeDataURL(serverId: String, viewerId: String, titleId: String) -> URL {
        let dir = safeChildDirectory([serverId, viewerId, titleId]) ?? rootDirectory
        return dir.appendingPathComponent("resume.data")
    }

    private func transferMetaURL(forKey key: String) -> URL? {
        let parts = key.split(separator: "/").map(String.init)
        guard parts.count == 3, let dir = safeChildDirectory(parts) else { return nil }
        return dir.appendingPathComponent("transfer.json")
    }

    private func saveTransferMeta(_ meta: TransferMeta) {
        guard let url = transferMetaURL(forKey: meta.key),
              let data = try? JSONEncoder().encode(meta) else { return }
        var dir = url.deletingLastPathComponent()
        ensureDirectory(&dir, excludeFromBackup: true)
        try? data.write(to: url, options: .atomic)
        excludeItemFromBackup(url)
    }

    private func removePersistedTransferMeta(forKey key: String) {
        guard let url = transferMetaURL(forKey: key) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private func loadPersistedTransfers() {
        guard let enumerator = FileManager.default.enumerator(
            at: rootDirectory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        lock.lock()
        defer { lock.unlock() }
        for case let fileURL as URL in enumerator where fileURL.lastPathComponent == "transfer.json" {
            if let data = try? Data(contentsOf: fileURL),
               var meta = try? JSONDecoder().decode(TransferMeta.self, from: data) {
                meta.headers = credentials.load(forKey: meta.key)
                transfers[meta.key] = meta
                // Rewrite files from builds that stored headers, so none stay on disk.
                if let text = String(data: data, encoding: .utf8), text.contains("\"headers\"") { saveTransferMeta(meta) }
            }
        }
    }

    private func safeChildDirectory(_ components: [String]) -> URL? {
        guard !components.isEmpty, components.allSatisfy(Self.isSafeComponent) else { return nil }
        var url = rootDirectory
        for comp in components {
            url.appendPathComponent(comp, isDirectory: true)
        }
        let standardized = url.standardizedFileURL
        let rootPath = rootDirectory.standardizedFileURL.path
        let prefix = rootPath.hasSuffix("/") ? rootPath : rootPath + "/"
        guard standardized.path.hasPrefix(prefix) else { return nil }
        return standardized
    }

    private static func isSafeComponent(_ value: String) -> Bool {
        !value.isEmpty && value != "." && value != ".." && !value.contains("/") && !value.contains("\\") && !value.contains("\0")
    }

    private static func sanitizeExtension(_ value: String, fallback: String) -> String {
        let cleaned = value.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return cleaned.isEmpty ? fallback : String(cleaned.prefix(12))
    }

    private func ensureDirectory(_ url: inout URL, excludeFromBackup: Bool) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        if excludeFromBackup {
            excludeItemFromBackup(url)
        }
    }

    private func excludeItemFromBackup(_ url: URL) {
        var mutable = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? mutable.setResourceValues(values)
        #if os(iOS)
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                               ofItemAtPath: url.path)
        #endif
    }

    private func readJSON(at url: URL) -> Any? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private func writeJSONAtomically(_ object: Any, to url: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try data.write(to: url, options: .atomic)
        excludeItemFromBackup(url)
    }

    private static func appendFile(from source: URL, to destination: URL) throws {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let output = try FileHandle(forUpdating: destination)
        defer { try? output.close() }
        try output.seekToEnd()
        while true {
            let chunk = try input.read(upToCount: 256 * 1024) ?? Data()
            if chunk.isEmpty { break }
            try output.write(contentsOf: chunk)
        }
    }

    private static func startByteFromContentRange(_ header: String?) -> Int64? {
        guard let header, header.hasPrefix("bytes "), let dash = header.firstIndex(of: "-") else { return nil }
        return Int64(header[header.index(header.startIndex, offsetBy: 6)..<dash])
    }

    private static func totalBytesFromContentRange(_ header: String?) -> Int64? {
        guard let header, let slash = header.lastIndex(of: "/") else { return nil }
        let suffix = header[header.index(after: slash)...].trimmingCharacters(in: .whitespaces)
        return Int64(suffix)
    }

    private static func classifyHTTPError(status: Int, response: HTTPURLResponse?) -> (String, String) {
        if status == 401 || status == 403 {
            return ("forbidden", "Downloads are not allowed for this title or account")
        }
        if status == 429 {
            return ("rate_limited", "Download limit reached; please try again later")
        }
        return ("network", "Server answered with HTTP \(status)")
    }

    private static func isNoSpaceError(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == NSCocoaErrorDomain && ns.code == NSFileWriteOutOfSpaceError {
            return true
        }
        if ns.domain == NSPOSIXErrorDomain && ns.code == Int(ENOSPC) {
            return true
        }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? Error {
            return isNoSpaceError(underlying)
        }
        return false
    }
}
