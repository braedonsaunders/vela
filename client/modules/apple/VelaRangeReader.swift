// An original file over HTTP byte ranges, read as one forward stream. One open-ended
// `Range: bytes=N-` request feeds a window of received chunks. A read outside the window
// (an index at the end of the file, a seek) restarts the stream there. The demuxer reads
// synchronously on its own thread; URLSession delivers on its delegate queue.
import Foundation

final class VelaRangeReader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    enum Failure: Error {
        case status(Int)
        case redirected
        case network(String)
    }

    private let url: URL
    private let headers: [String: String]
    private let lock = NSCondition()
    private var session: URLSession!
    private var task: URLSessionDataTask?
    private var taskStart: Int64 = 0
    /// Each restart is a new generation; late callbacks of an older task are ignored.
    private var generation = 0

    /// Received bytes: contiguous chunks from `windowStart` to `windowEnd`.
    private var chunks: [Data] = []
    private var windowStart: Int64 = 0
    private var windowEnd: Int64 = 0
    private var position: Int64 = 0
    private var total: Int64
    private var finished = false
    private var failure: Failure?
    private var closed = false
    private var suspended = false
    private var retries = 0

    // Measurements for the player's readout.
    private(set) var transferredBytes: Int64 = 0
    private(set) var throughputBps: Double?
    private var rateBytes: Int64 = 0
    private var rateStart = Date()

    /// Bytes kept behind the read position (small backward seeks, demuxer rereads).
    private let keepBehind: Int64 = 2 << 20
    /// Read-ahead: the stream is suspended past `aheadHigh` and resumed under `aheadLow`.
    private let aheadHigh: Int64 = 96 << 20
    private let aheadLow: Int64 = 48 << 20
    /// A read this far past the window waits for the stream rather than restarting it.
    private let waitGap: Int64 = 3 << 20
    private let readTimeout: TimeInterval = 30
    private let maximumRetries = 3

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

    func close() {
        lock.lock()
        closed = true
        task?.cancel()
        task = nil
        chunks.removeAll()
        lock.broadcast()
        lock.unlock()
        session.invalidateAndCancel()
    }

    // MARK: The demuxer's side (blocking)

    /// Up to `size` bytes at the position: the count, 0 at the end, -1 on failure.
    func read(into buffer: UnsafeMutablePointer<UInt8>, size: Int) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let deadline = Date().addingTimeInterval(readTimeout)
        while true {
            if closed {
                return -1
            }
            if total >= 0 && position >= total {
                return 0
            }
            if position >= windowStart && position < windowEnd {
                return copyAvailable(into: buffer, size: size)
            }
            let streamCovers = position >= windowStart && position <= windowEnd
            if failure != nil && streamCovers {
                guard retries < maximumRetries else {
                    return -1
                }
                retries += 1
                restart(at: position)
            } else if finished && streamCovers {
                return 0
            } else if !waitsForStream() {
                restart(at: position)
            }
            if suspended {
                suspended = false
                task?.resume()
            }
            if !lock.wait(until: deadline) {
                return -1
            }
        }
    }

    /// Moves the position: whence 0 (set), 1 (current), 2 (end); 0x10000 asks for the size.
    func seek(offset: Int64, whence: Int32) -> Int64 {
        lock.lock()
        defer { lock.unlock() }
        if whence == 0x10000 {
            return knownSize()
        }
        let base: Int64
        switch whence {
        case 0:
            base = 0
        case 1:
            base = position
        case 2:
            guard total >= 0 else {
                return -1
            }
            base = total
        default:
            return -1
        }
        let next = base + offset
        guard next >= 0 else {
            return -1
        }
        position = next
        return next
    }

    // MARK: The window (under `lock`)

    /// The file's size, asking the server for it when nothing has been requested yet.
    private func knownSize() -> Int64 {
        if total < 0 && task == nil && !closed {
            restart(at: position)
        }
        let deadline = Date().addingTimeInterval(20)
        while total < 0 && failure == nil && !closed && task != nil {
            if !lock.wait(until: deadline) {
                break
            }
        }
        return total
    }

    /// Whether the running stream will reach the position soon.
    private func waitsForStream() -> Bool {
        task != nil && position >= windowStart && position >= windowEnd && position - windowEnd <= waitGap
    }

    private func copyAvailable(into buffer: UnsafeMutablePointer<UInt8>, size: Int) -> Int {
        var chunkStart = windowStart
        var written = 0
        for chunk in chunks {
            let chunkEnd = chunkStart + Int64(chunk.count)
            let at = position + Int64(written)
            if at < chunkEnd && written < size {
                let from = Int(at - chunkStart)
                let count = min(size - written, chunk.count - from)
                chunk.withUnsafeBytes { raw in
                    let source = raw.baseAddress!.assumingMemoryBound(to: UInt8.self) + from
                    (buffer + written).update(from: source, count: count)
                }
                written += count
            }
            chunkStart = chunkEnd
            if written >= size {
                break
            }
        }
        position += Int64(written)
        dropConsumed()
        if suspended && windowEnd - position < aheadLow {
            suspended = false
            task?.resume()
        }
        return written
    }

    private func dropConsumed() {
        while let first = chunks.first, windowStart + Int64(first.count) < position - keepBehind {
            windowStart += Int64(first.count)
            chunks.removeFirst()
        }
    }

    private func restart(at offset: Int64) {
        task?.cancel()
        generation += 1
        chunks.removeAll()
        windowStart = offset
        windowEnd = offset
        finished = false
        failure = nil
        suspended = false
        var request = URLRequest(url: url)
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        request.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let next = session.dataTask(with: request)
        next.taskDescription = String(generation)
        taskStart = offset
        task = next
        next.resume()
    }

    private func isCurrent(_ task: URLSessionTask) -> Bool {
        task.taskDescription == String(generation)
    }

    // MARK: URLSession's side

    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // Credentials never follow a redirect (client/player/media-auth.ts refuses them too).
        lock.lock()
        if isCurrent(task) {
            failure = .redirected
        }
        lock.broadcast()
        lock.unlock()
        completionHandler(nil)
    }

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        lock.lock()
        defer { lock.unlock() }
        guard isCurrent(dataTask) else {
            completionHandler(.cancel)
            return
        }
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        if status == 206, let range = http?.value(forHTTPHeaderField: "Content-Range") {
            if let slash = range.lastIndex(of: "/"), let size = Int64(range[range.index(after: slash)...]) {
                total = size
            }
        } else if status == 200 && taskStart == 0 {
            if response.expectedContentLength > 0 {
                total = response.expectedContentLength
            }
        } else {
            failure = .status(status)
            lock.broadcast()
            completionHandler(.cancel)
            return
        }
        retries = 0
        lock.broadcast()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        defer { lock.unlock() }
        guard isCurrent(dataTask) else {
            return
        }
        chunks.append(data)
        windowEnd += Int64(data.count)
        transferredBytes += Int64(data.count)
        measure(data.count)
        if windowEnd - position > aheadHigh && !suspended {
            suspended = true
            dataTask.suspend()
        }
        lock.broadcast()
    }

    private func measure(_ bytes: Int) {
        rateBytes += Int64(bytes)
        let elapsed = Date().timeIntervalSince(rateStart)
        if elapsed >= 1 {
            throughputBps = Double(rateBytes) * 8 / elapsed
            rateBytes = 0
            rateStart = Date()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        defer { lock.unlock() }
        guard isCurrent(task) else {
            return
        }
        self.task = nil
        if let error {
            failure = failure ?? .network(error.localizedDescription)
        } else {
            finished = true
            if total < 0 {
                total = windowEnd
            }
        }
        lock.broadcast()
    }
}
