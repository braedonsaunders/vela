// Header-bearing media stays in Vela's transport. Aether receives bytes, never credentials.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

struct ScopedMediaResponse {
    let data: Data
    let totalSize: Int64?
    let subtitleComplete: Bool
}

func originalResponseTruncated(expectedLength: Int?, receivedLength: Int) -> Bool {
    guard let expectedLength else { return false }
    return receivedLength < expectedLength
}

/// Media bytes received through the scoped transport, as they arrive (the snapshot's loadProgress).
final class ReceivedBytes: @unchecked Sendable {
    private let lock = NSLock()
    private var count: Int64 = 0
    private var lost = false
    func add(_ bytes: Int) { lock.lock(); count += Int64(bytes); lock.unlock() }
    func markOriginalLost() { lock.lock(); lost = true; lock.unlock() }
    var total: Int64 { lock.lock(); defer { lock.unlock() }; return count }
    var originalLost: Bool { lock.lock(); defer { lock.unlock() }; return lost }
}

final class ScopedMediaRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private let access: VelaMediaAuth?
    private let offset: Int64?
    private let count: Int
    private let received: ReceivedBytes?
    private let lock = NSLock()
    private let finished = DispatchSemaphore(value: 0)
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var cancelled = false
    private var droppedHeaders = false
    private var body = Data()
    private var totalSize: Int64?
    private var subtitleComplete = false
    private var expectedLength: Int?
    private var failure: Error?

    init(url: URL, access: VelaMediaAuth?, offset: Int64?, count: Int, received: ReceivedBytes? = nil) {
        self.url = url
        self.access = access
        self.offset = offset
        self.count = count
        self.received = received
    }

    func run() throws -> ScopedMediaResponse {
        guard (offset ?? 0) >= 0, count > 0, (offset ?? 0) <= Int64.max - Int64(count) else { throw URLError(.badURL) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 20
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        for (name, value) in access?.headers(for: url) ?? [:] { request.setValue(value, forHTTPHeaderField: name) }
        if let offset { request.setValue("bytes=\(offset)-\(offset + Int64(count) - 1)", forHTTPHeaderField: "Range") }
        let task = session.dataTask(with: request)
        lock.lock()
        self.session = session
        self.task = task
        let stopped = cancelled
        lock.unlock()
        if stopped { session.invalidateAndCancel(); throw URLError(.cancelled) }
        task.resume()
        if finished.wait(timeout: .now() + 21) == .timedOut {
            cancel()
            throw URLError(.timedOut)
        }
        session.finishTasksAndInvalidate()
        lock.lock()
        defer { lock.unlock() }
        if let failure { throw failure }
        if cancelled { throw URLError(.cancelled) }
        if originalResponseTruncated(expectedLength: expectedLength, receivedLength: body.count) {
            received?.markOriginalLost()
            throw NSError(domain: "VelaOriginalLost", code: 1)
        }
        return ScopedMediaResponse(data: body, totalSize: totalSize, subtitleComplete: subtitleComplete)
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let session = session
        lock.unlock()
        session?.invalidateAndCancel()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        guard let target = request.url, target.user == nil, target.password == nil,
              ["http", "https"].contains(target.scheme?.lowercased() ?? "") else {
            completionHandler(nil)
            return
        }
        var next = request
        // URLSession copies custom headers on redirect. Strip ALL grant fields, not a list
        // of token spellings, and never restore them after the chain has left its scope.
        for name in (access?.fields ?? [:]).keys { next.setValue(nil, forHTTPHeaderField: name) }
        let scoped = access?.headers(for: target) ?? [:]
        droppedHeaders = droppedHeaders || scoped.isEmpty
        if !droppedHeaders {
            for (name, value) in scoped { next.setValue(value, forHTTPHeaderField: name) }
        }
        if let offset { next.setValue("bytes=\(offset)-\(offset + Int64(count) - 1)", forHTTPHeaderField: "Range") }
        completionHandler(next)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            reject(URLError(.badServerResponse), completionHandler)
            return
        }
        let range = http.value(forHTTPHeaderField: "Content-Range") ?? ""
        if let tail = range.split(separator: "/").last { totalSize = Int64(tail) }
        if http.statusCode == 409 && http.value(forHTTPHeaderField: "X-Ether-Playback-Error") == "original_lost" {
            received?.markOriginalLost()
            reject(NSError(domain: "VelaOriginalLost", code: 1), completionHandler)
            return
        }
        if http.statusCode == 416, let totalSize, let offset, offset >= totalSize {
            completionHandler(.allow)
            return
        }
        guard (http.statusCode == 206 && offset != nil) || (http.statusCode == 200 && (offset ?? 0) == 0) else {
            reject(NSError(domain: "VelaMediaHTTP", code: http.statusCode), completionHandler)
            return
        }
        subtitleComplete = http.statusCode == 200 && http.value(forHTTPHeaderField: "X-Ether-Subtitle-Complete") == "1"
        if http.statusCode == 206 {
            let start = range.dropFirst("bytes ".count).split(separator: "-").first.flatMap { Int64($0) }
            guard range.hasPrefix("bytes "), start == offset else {
                reject(URLError(.badServerResponse), completionHandler)
                return
            }
            if response.expectedContentLength >= 0 { expectedLength = Int(response.expectedContentLength) }
        } else if response.expectedContentLength >= 0 {
            totalSize = response.expectedContentLength
            expectedLength = Int(response.expectedContentLength)
        }
        guard response.expectedContentLength <= Int64(count) else {
            reject(URLError(.dataLengthExceedsMaximum), completionHandler)
            return
        }
        completionHandler(.allow)
    }

    private func reject(_ error: Error, _ completion: (URLSession.ResponseDisposition) -> Void) {
        lock.lock(); failure = error; lock.unlock()
        completion(.cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let oversized = body.count + data.count > count
        if oversized { failure = URLError(.dataLengthExceedsMaximum) }
        else { body.append(data) }
        lock.unlock()
        if oversized { dataTask.cancel() } else { received?.add(data.count) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        if failure == nil, originalResponseTruncated(expectedLength: expectedLength, receivedLength: body.count) {
            received?.markOriginalLost()
            failure = NSError(domain: "VelaOriginalLost", code: 1)
        } else if failure == nil { failure = error }
        lock.unlock()
        finished.signal()
    }
}

/// Aether's demux thread reads bounded HTTP ranges through Vela's media-access policy.
final class ScopedMediaByteReader: @unchecked Sendable {
    private let url: URL
    private let access: VelaMediaAuth
    private let received: ReceivedBytes?
    private let lock = NSLock()
    private var operation: ScopedMediaRequest?
    private var closed = false
    private var interrupted = false
    private var hasRead = false
    private var cancellationEpoch: UInt64 = 0
    private var position: Int64 = 0
    private var totalSize: Int64?
    private var cache = Data()
    private var cacheStart: Int64 = 0
    var discImageProbeEnabled: Bool { false }

    init(url: URL, access: VelaMediaAuth, received: ReceivedBytes? = nil) {
        self.url = url
        self.access = access
        self.received = received
    }

    private func fetch(at offset: Int64, count: Int, epoch: UInt64) throws -> ScopedMediaResponse {
        let began = Date()
        let delays: [Double] = [1, 2, 4, 8, 15, 15, 15]
        var attempt = 0
        while true {
            do { return try fetchOnce(at: offset, count: count, epoch: epoch) }
            catch {
                let failure = error as NSError
                let transient = failure.domain == "VelaMediaHTTP"
                    ? ([408, 429].contains(failure.code) || (500...599).contains(failure.code))
                    : failure.domain == NSURLErrorDomain && [-1001, -1004, -1005, -1009].contains(failure.code)
                guard transient, attempt < delays.count else { throw error }
                let wait = delays[attempt]
                attempt += 1
                guard Date().timeIntervalSince(began) + wait <= 60 else { throw error }
                let until = Date().addingTimeInterval(wait)
                repeat {
                    lock.lock()
                    let stopped = closed || interrupted || epoch != cancellationEpoch
                    lock.unlock()
                    if stopped { throw URLError(.cancelled) }
                    Thread.sleep(forTimeInterval: min(0.05, max(0, until.timeIntervalSinceNow)))
                } while until.timeIntervalSinceNow > 0
            }
        }
    }

    private func fetchOnce(at offset: Int64, count: Int, epoch: UInt64) throws -> ScopedMediaResponse {
        let request = ScopedMediaRequest(url: url, access: access, offset: offset, count: count, received: received)
        lock.lock()
        guard !closed && !interrupted && epoch == cancellationEpoch else { lock.unlock(); throw URLError(.cancelled) }
        operation = request
        lock.unlock()
        defer { lock.lock(); operation = nil; lock.unlock() }
        return try request.run()
    }

    func read(_ buffer: UnsafeMutablePointer<UInt8>?, size: Int32) -> Int32 {
        guard let buffer, size > 0 else { return 0 }
        lock.lock()
        let stopped = closed || interrupted
        let epoch = cancellationEpoch
        if !stopped { hasRead = true }
        lock.unlock()
        guard !stopped else { return -1 }
        if let totalSize, position >= totalSize { return 0 }
        do {
            if position < cacheStart || position >= cacheStart + Int64(cache.count) {
                let remaining = totalSize.map { max(0, $0 - position) } ?? 1_048_576
                let result = try fetch(at: position, count: Int(min(1_048_576, remaining)), epoch: epoch)
                cache = result.data
                cacheStart = position
                totalSize = result.totalSize ?? totalSize
            }
            let offset = Int(position - cacheStart)
            let count = min(Int(size), cache.count - offset)
            guard count > 0 else { return 0 }
            cache.withUnsafeBytes { bytes in buffer.update(from: bytes.baseAddress!.assumingMemoryBound(to: UInt8.self).advanced(by: offset), count: count) }
            position += Int64(count)
            return Int32(count)
        } catch { return -1 }
    }

    func seek(offset: Int64, whence: Int32) -> Int64 {
        let mode = whence & ~131072
        lock.lock()
        // Aether retains custom readers across audio-track rebuilds. A positional
        // seek starts the next read epoch; cancellation alone never closes the grant.
        if !closed, mode == 0, offset >= 0 { interrupted = false }
        let stopped = closed || interrupted
        let epoch = cancellationEpoch
        if !stopped { hasRead = true }
        lock.unlock()
        guard !stopped else { return -1 }
        if totalSize == nil, mode == 65536 || mode == 2 {
            do { totalSize = try fetch(at: 0, count: 1, epoch: epoch).totalSize } catch { return -1 }
        }
        if mode == 65536 { return totalSize ?? -1 }
        let target: Int64
        switch mode {
        case 0: target = offset
        case 1:
            let sum = position.addingReportingOverflow(offset)
            guard !sum.overflow else { return -1 }
            target = sum.partialValue
        case 2:
            guard let totalSize else { return -1 }
            let sum = totalSize.addingReportingOverflow(offset)
            guard !sum.overflow else { return -1 }
            target = sum.partialValue
        default: return -1
        }
        guard target >= 0 else { return -1 }
        position = target
        return target
    }

    func cancel() {
        lock.lock()
        cancellationEpoch &+= 1
        // A cancellation racing the initial read must prevent it from starting.
        // Once used, only the in-flight operation is interrupted: Aether may
        // reuse this reader immediately, even before a positional seek.
        if !hasRead { interrupted = true }
        let request = operation
        lock.unlock()
        request?.cancel()
    }

    func close() {
        lock.lock(); closed = true; let request = operation; lock.unlock()
        request?.cancel()
    }

    func makeSiblingReader() -> ScopedMediaByteReader { ScopedMediaByteReader(url: url, access: access, received: received) }
}
