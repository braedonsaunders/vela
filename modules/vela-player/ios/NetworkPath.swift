// Whether the device's network is metered, for the app's streaming quality cap: mobile data and a
// personal hotspot (an expensive path) or Low Data Mode (a constrained one). Apple TV and a Mac
// report unmetered unless the system says otherwise.
import Foundation
import Network

final class NetworkPath {
    static let shared = NetworkPath()
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "app.ether.vela.network")
    private let lock = NSLock()
    private var meteredValue = false
    private var started = false
    /// Hears every change (on the monitor's queue), once the app listens.
    var changed: ((Bool) -> Void)?

    var metered: Bool {
        start()
        lock.lock(); defer { lock.unlock() }
        return meteredValue
    }

    func start() {
        lock.lock()
        if started { lock.unlock(); return }
        started = true
        // The path as it stands now, before the monitor's first update arrives.
        meteredValue = Self.metered(monitor.currentPath)
        lock.unlock()
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let next = Self.metered(path)
            self.lock.lock()
            let moved = next != self.meteredValue
            self.meteredValue = next
            self.lock.unlock()
            if moved { self.changed?(next) }
        }
        monitor.start(queue: queue)
    }

    private static func metered(_ path: NWPath) -> Bool {
        path.status == .satisfied && (path.isExpensive || path.isConstrained)
    }
}
