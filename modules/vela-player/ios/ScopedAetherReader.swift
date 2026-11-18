import AetherEngine
import Foundation

/// Aether's demux thread reads bounded HTTP ranges through Vela's media-access policy.
final class ScopedAetherReader: IOReader, @unchecked Sendable {
    private let url: URL
    private let access: VelaMediaAuth
    private let lock = NSLock()
    private var operation: ScopedMediaRequest?
    private var closed = false
    private var position: Int64 = 0
    private var totalSize: Int64?
    private var cache = Data()
    private var cacheStart: Int64 = 0
    var discImageProbeEnabled: Bool { false }

    init(url: URL, access: VelaMediaAuth) {
        self.url = url
        self.access = access
    }

    private func fetch(at offset: Int64, count: Int) throws -> ScopedMediaResponse {
        let request = ScopedMediaRequest(url: url, access: access, offset: offset, count: count)
        lock.lock()
        guard !closed else { lock.unlock(); throw URLError(.cancelled) }
        operation = request
        lock.unlock()
        defer { lock.lock(); operation = nil; lock.unlock() }
        return try request.run()
    }

    func read(_ buffer: UnsafeMutablePointer<UInt8>?, size: Int32) -> Int32 {
        guard let buffer, size > 0 else { return 0 }
        if let totalSize, position >= totalSize { return 0 }
        do {
            if position < cacheStart || position >= cacheStart + Int64(cache.count) {
                let remaining = totalSize.map { max(0, $0 - position) } ?? 1_048_576
                let result = try fetch(at: position, count: Int(min(1_048_576, remaining)))
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
        if totalSize == nil, whence == 65536 || (whence & ~131072) == 2 {
            do { totalSize = try fetch(at: 0, count: 1).totalSize } catch { return -1 }
        }
        if whence == 65536 { return totalSize ?? -1 }
        let target: Int64
        switch whence & ~131072 {
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
        lock.lock(); let request = operation; lock.unlock()
        request?.cancel()
    }

    func close() {
        lock.lock(); closed = true; let request = operation; lock.unlock()
        request?.cancel()
    }

    func makeIndependentReader() -> IOReader? { ScopedAetherReader(url: url, access: access) }
}
