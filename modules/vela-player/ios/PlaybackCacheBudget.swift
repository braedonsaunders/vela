// How much of the device AetherEngine's on-disk segment cache may use. Left to the engine's automatic
// sizing, a 4K remux on an Apple TV with little free space wrote until the volume was full
// (storageExhausted, ENOSPC) and left gigabytes behind when the app was killed, so that nothing, not even
// an app update, could be installed (Basement Apple TV, 2026-11-22: 2.7 GB of orphaned segments, 0 bytes free). Every full-screen load now gets a hard total and a free-space reserve
// from the space actually free, and the engine evicts history behind the playhead to stay inside them.
import Darwin
import Foundation

struct PlaybackCacheBudget: Equatable {
    /// `LoadOptions.sessionCacheByteBudget`: retention the engine aims for.
    let byteBudget: Int
    /// `LoadOptions.sessionCacheHardLimitBytes`: resident plus in-flight bytes never exceed it.
    let hardLimit: Int
    /// `LoadOptions.sessionCacheFreeReserveBytes`: free space left on the volume before every write.
    let freeReserve: Int

    static let megabyte = 1_000_000
    static let gigabyte = 1_000_000_000
    /// The most the cache ever takes.
    static let ceiling = 2 * gigabyte
    /// AVPlayer needs a few segments ahead; a 4K remux segment is about 50 MB.
    static let workingFloor = 320 * megabyte
    static let reserve = 1 * gigabyte
    static let smallestReserve = 200 * megabyte

    /// The budget for `free` bytes available to the app (including purgeable space), scaled down by
    /// `shrink` (1, 0.5, 0.25…) after the volume still ran out. With room to spare: 40% of free space,
    /// at most 2 GB, keeping 1 GB free. On a nearly full device the reserve shrinks to a quarter of
    /// free space so playback can still run in a small working window.
    static func plan(freeBytes: Int64, shrink: Double = 1) -> PlaybackCacheBudget {
        let free = Int(clamping: max(0, freeBytes))
        let scale = max(0.05, min(1, shrink))
        let reserve = min(free >= 3 * Self.reserve ? Self.reserve : max(smallestReserve, free / 4), free / 2)
        let usable = max(0, free - reserve)
        let target = min(ceiling, Int(Double(free) * 0.4 * scale))
        // Under the working floor the engine still gets the floor: refusing every write fails playback
        // outright, while the engine's own reserve check keeps the last of the volume free.
        let minimum = max(64 * megabyte, Int(Double(workingFloor) * scale))
        let hardLimit = max(minimum, min(target, usable))
        return PlaybackCacheBudget(byteBudget: hardLimit, hardLimit: hardLimit, freeReserve: reserve)
    }

    /// Bytes free for the app on the temporary directory's volume, purgeable space included.
    static func freeBytes(at directory: URL = URL(fileURLWithPath: NSTemporaryDirectory())) -> Int64? {
        #if os(iOS) || os(tvOS)
        if let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
           let important = values.volumeAvailableCapacityForImportantUsage {
            return important
        }
        #endif
        let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityKey])
        return values?.volumeAvailableCapacity.map(Int64.init)
    }

    /// The engine's segment cache directory under tmp.
    static var cacheDirectory: URL {
        URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("aether-segments", isDirectory: true)
    }

    /// Removes the session directories nobody owns: what a killed or crashed app left behind. AetherEngine
    /// holds an flock on `<session>/session.lock` for a live session's lifetime (and the kernel drops it
    /// when the process dies), so a directory whose lock can be taken is stale, whichever engine made it.
    @discardableResult
    static func removeStaleSessions(in directory: URL = cacheDirectory) -> Int64 {
        let manager = FileManager.default
        guard let names = try? manager.contentsOfDirectory(atPath: directory.path) else { return 0 }
        var removed: Int64 = 0
        for name in names {
            let url = directory.appendingPathComponent(name)
            guard !isLive(url) else { continue }
            removed += size(of: url)
            try? manager.removeItem(at: url)
        }
        return removed
    }

    /// Whether a session holds the directory's lock marker. A directory without one is not live.
    static func isLive(_ session: URL) -> Bool {
        let marker = session.appendingPathComponent("session.lock").path
        guard FileManager.default.fileExists(atPath: marker) else { return false }
        let fd = open(marker, O_RDWR | O_CLOEXEC)
        guard fd >= 0 else { return true }
        defer { close(fd) }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { return true }
        flock(fd, LOCK_UN)
        return false
    }

    private static func size(of url: URL) -> Int64 {
        guard let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var total: Int64 = 0
        for case let file as URL in walker {
            total += Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
        return total
    }
}
