// Header-bearing media stays in Vela's transport. Aether receives bytes, never credentials.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

struct ScopedMediaResponse {
    let data: Data
    let totalSize: Int64?
}

final class ScopedMediaRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let url: URL
    private let access: VelaMediaAuth
    private let offset: Int64
    private let count: Int
    private let lock = NSLock()
    private let finished = DispatchSemaphore(value: 0)
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var cancelled = false
    private var droppedHeaders = false
    private var body = Data()
    private var totalSize: Int64?
    private var failure: Error?

    init(url: URL, access: VelaMediaAuth, offset: Int64, count: Int) {
        self.url = url
        self.access = access
        self.offset = offset
        self.count = count
    }

    func run() throws -> ScopedMediaResponse {
        guard offset >= 0, count > 0, offset <= Int64.max - Int64(count) else { throw URLError(.badURL) }
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
        for (name, value) in access.headers(for: url) { request.setValue(value, forHTTPHeaderField: name) }
        request.setValue("bytes=\(offset)-\(offset + Int64(count) - 1)", forHTTPHeaderField: "Range")
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
        return ScopedMediaResponse(data: body, totalSize: totalSize)
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
        for name in access.fields.keys { next.setValue(nil, forHTTPHeaderField: name) }
        let scoped = access.headers(for: target)
        droppedHeaders = droppedHeaders || scoped.isEmpty
        if !droppedHeaders {
            for (name, value) in scoped { next.setValue(value, forHTTPHeaderField: name) }
        }
        next.setValue("bytes=\(offset)-\(offset + Int64(count) - 1)", forHTTPHeaderField: "Range")
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
        if http.statusCode == 416, let totalSize, offset >= totalSize {
            completionHandler(.allow)
            return
        }
        guard http.statusCode == 206 || (http.statusCode == 200 && offset == 0) else {
            reject(URLError(.badServerResponse), completionHandler)
            return
        }
        if http.statusCode == 206 {
            let start = range.dropFirst("bytes ".count).split(separator: "-").first.flatMap { Int64($0) }
            guard range.hasPrefix("bytes "), start == offset else {
                reject(URLError(.badServerResponse), completionHandler)
                return
            }
        } else if response.expectedContentLength >= 0 {
            totalSize = response.expectedContentLength
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
        if oversized { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        if failure == nil { failure = error }
        lock.unlock()
        finished.signal()
    }
}
