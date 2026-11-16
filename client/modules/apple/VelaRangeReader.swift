// The original file over HTTP byte ranges, read as one forward stream: one open-ended
// `Range: bytes=N-` request feeds a window of received chunks; a read outside the window
// (an index at the end of the file, a seek) restarts the stream there. The demuxer reads
// synchronously on its own thread; the network delivers on URLSession's queue.
import Foundation

final class VelaRangeReader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    enum Failure: Error { case status(Int), redirected, cancelled, network(String), stalled }

    private let url: URL
    private let headers: [String: String]
    private let lock = NSCondition()
    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var taskStart: Int64 = 0
    /// Received bytes: contiguous chunks from `windowStart`.
    private var chunks: [Data] = []
    private var windowStart: Int64 = 0
    private var windowEnd: Int64 = 0
    private var position: Int64 = 0
    private var total: Int64
    private var finished = false
    private var failure: Failure?
    private var closed = false
    private var suspended = false
    private var attempts = 0
    private var generation = 0
    // Measurements for the player's readout.
    private(set) var transferredBytes: Int64 = 0
    private var rateBytes: Int64 = 0
    private var rateStart = Date()
    private(set) var throughputBps: Double?

    /// Bytes kept behind the read position (small backward seeks, demuxer rereads).
    private let keepBehind: Int64 = 2 << 20
    /// Read-ahead bounds: suspend the stream past `aheadHigh`, resume under `aheadLow`.
    private let aheadHigh: Int64 = 96 << 20, aheadLow: Int64 = 48 << 20
    /// A read this far past the window waits for the stream rather than restarting it.
    private let waitGap: Int64 = 3 << 20

    init(url: URL, headers: [String: String], byteLength: Int64?) {
        self.url = url
        self.headers = headers
        total = byteLength ?? -1
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 20
        configuration.httpMaximumConnectionsPerHost = 2
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInitiated
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }

    var byteLength: Int64? { lock.lock(); defer { lock.unlock() }; return total >= 0 ? total : nil }
    /// The received byte range ahead of the read position.
    var bufferedAhead: Int64 { lock.lock(); defer { lock.unlock() }; return max(0, windowEnd - position) }

    func close() {
        lock.lock()
        closed = true
        task?.cancel(); task = nil
        chunks.removeAll()
        lock.broadcast()
        lock.unlock()
        session.invalidateAndCancel()
    }

    // MARK: Demuxer side (blocking)

    func read(into buffer: UnsafeMutablePointer<UInt8>, size: Int) -> Int {
        lock.lock(); defer { lock.unlock() }
        let deadline = Date().addingTimeInterval(30)
        while true {
            if closed { return -1 }
            if total >= 0 && position >= total { return 0 }
            if position >= windowStart && position < windowEnd {
                let copied = copyOut(buffer, size)
                position += Int64(copied)
                trim()
                if suspended && windowEnd - position < aheadLow { suspended = false; task?.resume() }
                return copied
            }
            if let failure, taskMatches(position) {
                if attempts < 3 { attempts += 1; restart(at: position) } else { _ = failure; return -1 }
            } else if finished && position >= windowEnd && taskMatches(position) {
                return 0
            } else if !(task != nil && position >= windowEnd && position - windowEnd <= waitGap && position >= windowStart) {
                restart(at: position)
            }
            if suspended { suspended = false; task?.resume() }
            if !lock.wait(until: deadline) { return -1 }
        }
    }

    func seek(offset: Int64, whence: Int32) -> Int64 {
        lock.lock(); defer { lock.unlock() }
        if whence == 0x10000 {
            if total < 0 && task == nil && !closed { restart(at: position) }
            let deadline = Date().addingTimeInterval(20)
            while total < 0 && failure == nil && !closed && task != nil { if !lock.wait(until: deadline) { break } }
            return total
        }
        let base: Int64
        switch whence {
        case 0: base = 0
        case 1: base = position
        case 2: guard total >= 0 else { return -1 }; base = total
        default: return -1
        }
        let next = base + offset
        guard next >= 0 else { return -1 }
        position = next
        return next
    }

    // MARK: Window

    private func taskMatches(_ at: Int64) -> Bool { at >= windowStart && at <= windowEnd }

    private func copyOut(_ buffer: UnsafeMutablePointer<UInt8>, _ size: Int) -> Int {
        var offset = windowStart
        var written = 0
        for chunk in chunks {
            let end = offset + Int64(chunk.count)
            if position + Int64(written) < end && written < size {
                let from = Int(position + Int64(written) - offset)
                let count = min(size - written, chunk.count - from)
                chunk.withUnsafeBytes { raw in
                    (buffer + written).update(from: raw.baseAddress!.assumingMemoryBound(to: UInt8.self) + from, count: count)
                }
                written += count
            }
            offset = end
            if written >= size { break }
        }
        return written
    }

    private func trim() {
        while let first = chunks.first, windowStart + Int64(first.count) < position - keepBehind {
            windowStart += Int64(first.count)
            chunks.removeFirst()
        }
    }

    private func restart(at offset: Int64) {
        task?.cancel()
        generation += 1
        chunks.removeAll()
        windowStart = offset; windowEnd = offset
        finished = false; failure = nil; suspended = false
        var request = URLRequest(url: url)
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let next = session.dataTask(with: request)
        next.taskDescription = String(generation)
        taskStart = offset
        task = next
        next.resume()
    }

    // MARK: URLSession side

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Credentials never follow a redirect (client/player/media-auth.ts refuses them too).
        lock.lock()
        if task.taskDescription == String(generation) { failure = .redirected }
        lock.broadcast(); lock.unlock()
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard dataTask.taskDescription == String(generation) else { completionHandler(.cancel); return }
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        if status == 206 {
            if let range = http?.value(forHTTPHeaderField: "Content-Range"), let slash = range.lastIndex(of: "/"), let size = Int64(range[range.index(after: slash)...]) { total = size }
        } else if status == 200 && taskStart == 0 {
            if response.expectedContentLength > 0 { total = response.expectedContentLength }
        } else {
            failure = .status(status)
            lock.broadcast()
            completionHandler(.cancel)
            return
        }
        attempts = 0
        lock.broadcast()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); defer { lock.unlock() }
        guard dataTask.taskDescription == String(generation) else { return }
        chunks.append(data)
        windowEnd += Int64(data.count)
        transferredBytes += Int64(data.count)
        rateBytes += Int64(data.count)
        let elapsed = Date().timeIntervalSince(rateStart)
        if elapsed >= 1 {
            throughputBps = Double(rateBytes) * 8 / elapsed
            rateBytes = 0; rateStart = Date()
        }
        if windowEnd - position > aheadHigh && !suspended { suspended = true; dataTask.suspend() }
        lock.broadcast()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock(); defer { lock.unlock() }
        guard task.taskDescription == String(generation) else { return }
        self.task = nil
        if let error {
            if (error as NSError).code != NSURLErrorCancelled || failure == nil { failure = failure ?? .network(error.localizedDescription) }
        } else {
            finished = true
            if total < 0 { total = windowEnd }
        }
        lock.broadcast()
    }
}
