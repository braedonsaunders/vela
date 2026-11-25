import Foundation
import QuartzCore

final class VisualizerAvailability: NSObject {
    static let changed = Notification.Name("VelaVisualizerAvailability")
    private let lock = NSLock()
    private var prepared: Set<ObjectIdentifier> = []
    private var fullscreenRequest: Double?
    private var supported = true, withinBudget = true

    init(inactiveNotifications: [Notification.Name]) {
        super.init()
        for name in inactiveNotifications {
            NotificationCenter.default.addObserver(self, selector: #selector(cancelFullscreen(_:)), name: name, object: nil)
        }
    }

    @objc private func cancelFullscreen(_ notification: Notification) {
        lock.lock()
        fullscreenRequest = nil
        lock.unlock()
    }

    var trackSupported: Bool {
        lock.lock()
        defer { lock.unlock() }
        return supported && withinBudget
    }

    var canOpen: Bool {
        lock.lock()
        defer { lock.unlock() }
        return supported && withinBudget && !prepared.isEmpty
    }

    func beginFullscreen() {
        lock.lock()
        fullscreenRequest = CACurrentMediaTime()
        lock.unlock()
    }

    func takeFullscreenStart() -> Double? {
        lock.lock()
        defer { fullscreenRequest = nil; lock.unlock() }
        return fullscreenRequest
    }

    func prepared(_ session: AnyObject, _ value: Bool) {
        lock.lock()
        let before = prepared.isEmpty
        if value { prepared.insert(ObjectIdentifier(session)) } else { prepared.remove(ObjectIdentifier(session)) }
        let changed = before != prepared.isEmpty
        lock.unlock()
        if changed { NotificationCenter.default.post(name: Self.changed, object: nil) }
    }

    func disableForBudget() {
        lock.lock()
        withinBudget = false
        lock.unlock()
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    func update(_ value: Bool) {
        lock.lock()
        let changed = value != supported
        supported = value
        lock.unlock()
        if changed { NotificationCenter.default.post(name: Self.changed, object: nil) }
    }
}
