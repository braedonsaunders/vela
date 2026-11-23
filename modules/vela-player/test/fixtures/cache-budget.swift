// Compiled with ../../ios/PlaybackCacheBudget.swift by cache-budget.test.ts.
import Darwin
import Foundation

func check(_ condition: Bool, _ message: String) {
    if !condition { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1) }
}
@main
enum CacheBudgetProbe {
    static func main() {
        let mb = 1_000_000, gb = 1_000_000_000

        // Plenty of room: 40% of free space, at most 2 GB, 1 GB kept free.
        var plan = PlaybackCacheBudget.plan(freeBytes: Int64(20 * gb))
        check(plan == PlaybackCacheBudget(byteBudget: 2 * gb, hardLimit: 2 * gb, freeReserve: gb), "20 GB free: \(plan)")
        plan = PlaybackCacheBudget.plan(freeBytes: Int64(4 * gb))
        check(plan.hardLimit == 1_600 * mb && plan.freeReserve == gb, "4 GB free: \(plan)")
        // Never more than what is free after the reserve.
        plan = PlaybackCacheBudget.plan(freeBytes: Int64(3 * gb))
        check(plan.hardLimit + plan.freeReserve <= 3 * gb, "3 GB free overcommits: \(plan)")
        // Nearly full: a small reserve and the working floor, so playback still runs.
        plan = PlaybackCacheBudget.plan(freeBytes: Int64(800 * mb))
        check(plan.freeReserve == 200 * mb && plan.hardLimit == 320 * mb, "800 MB free: \(plan)")
        plan = PlaybackCacheBudget.plan(freeBytes: 0)
        check(plan.freeReserve == 0 && plan.hardLimit == 320 * mb, "0 free: \(plan)")
        // After the volume still ran out, each retry halves the share and the floor.
        let full = PlaybackCacheBudget.plan(freeBytes: Int64(4 * gb))
        let half = PlaybackCacheBudget.plan(freeBytes: Int64(4 * gb), shrink: 0.5)
        let quarter = PlaybackCacheBudget.plan(freeBytes: Int64(1 * gb), shrink: 0.25)
        check(half.hardLimit == full.hardLimit / 2, "shrink 0.5: \(half)")
        check(quarter.hardLimit == 100 * mb && quarter.freeReserve == 250 * mb, "shrink 0.25 near full: \(quarter)")
        check(PlaybackCacheBudget.plan(freeBytes: -5).hardLimit == 320 * mb, "negative free")

        // The sweep removes orphaned sessions and keeps one whose lock is held.
        let base = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("aether-segments")
        let live = base.appendingPathComponent("live"), dead = base.appendingPathComponent("dead"), bare = base.appendingPathComponent("bare")
        for dir in [live, dead, bare] { try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        for dir in [live, dead] { FileManager.default.createFile(atPath: dir.appendingPathComponent("session.lock").path, contents: nil) }
        try! Data(count: 1000).write(to: dead.appendingPathComponent("seg-1.m4s"))
        try! Data(count: 500).write(to: bare.appendingPathComponent("seg-2.m4s"))
        let held = open(live.appendingPathComponent("session.lock").path, O_RDWR)
        check(flock(held, LOCK_EX | LOCK_NB) == 0, "test could not hold the live lock")
        check(PlaybackCacheBudget.isLive(live) && !PlaybackCacheBudget.isLive(dead) && !PlaybackCacheBudget.isLive(bare), "liveness")
        let freed = PlaybackCacheBudget.removeStaleSessions(in: base)
        check(freed == 1500, "freed \(freed)")
        check(FileManager.default.fileExists(atPath: live.path), "removed a live session")
        check(!FileManager.default.fileExists(atPath: dead.path) && !FileManager.default.fileExists(atPath: bare.path), "kept a stale session")
        print("ok")
    }
}
