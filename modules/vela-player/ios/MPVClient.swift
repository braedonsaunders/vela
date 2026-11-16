// One libmpv handle: options, commands, properties, and its events on a serial queue.
// Properties are observed (mpv_observe_property), never polled; each change reaches
// `onProperty` on the main thread.
import Foundation
import Libmpv
import QuartzCore

final class MPVClient {
    enum Event {
        case fileLoaded
        case endFile(reason: Int32, error: Int32)
        case seekDone
        case shutdown
    }

    var onProperty: ((String, Any?) -> Void)?
    var onEvent: ((Event) -> Void)?

    private var handle: OpaquePointer?
    private let events = DispatchQueue(label: "vela.mpv.events", qos: .userInitiated)

    /// Creates the handle, rendering into `layer` with gpu-next on Vulkan (MoltenVK) and
    /// VideoToolbox hardware decoding.
    init(layer: CAMetalLayer, options extra: [String: String]) throws {
        guard let created = mpv_create() else {
            throw MPVError("libmpv could not create a player")
        }
        handle = created
        var layerPointer = layer
        try check(mpv_set_option(created, "wid", MPV_FORMAT_INT64, &layerPointer), "wid")
        let base: [(String, String)] = [
            ("vo", "gpu-next"),
            ("gpu-api", "vulkan"),
            ("gpu-context", "moltenvk"),
            ("hwdec", "videotoolbox"),
            ("hwdec-codecs", "all"),
            ("video-rotate", "no"),
            ("keep-open", "yes"),
            ("idle", "yes"),
            ("cache", "yes"),
            ("demuxer-max-bytes", "192MiB"),
            ("demuxer-max-back-bytes", "48MiB"),
            ("demuxer-readahead-secs", "20"),
            ("audio-channels", "auto-safe"),
            ("sub-auto", "no"),
            ("input-default-bindings", "no"),
            ("input-vo-keyboard", "no"),
            ("terminal", "no"),
            ("msg-level", "all=warn"),
        ]
        for (name, value) in base {
            try check(mpv_set_option_string(created, name, value), name)
        }
        for (name, value) in extra {
            try check(mpv_set_option_string(created, name, value), name)
        }
        try check(mpv_initialize(created), "initialize")
        // mpv's own warnings and errors reach the app's console (devicectl ... launch --console).
        mpv_request_log_messages(created, "warn")
        let context = Unmanaged.passUnretained(self).toOpaque()
        mpv_set_wakeup_callback(created, { context in
            guard let context else {
                return
            }
            Unmanaged<MPVClient>.fromOpaque(context).takeUnretainedValue().drainEvents()
        }, context)
    }

    /// Ends playback and frees the handle; no callbacks follow.
    func destroy() {
        events.sync {
            guard let handle else {
                return
            }
            mpv_set_wakeup_callback(handle, nil, nil)
            self.handle = nil
            mpv_terminate_destroy(handle)
        }
        onProperty = nil
        onEvent = nil
    }

    deinit {
        if let handle {
            mpv_set_wakeup_callback(handle, nil, nil)
            mpv_terminate_destroy(handle)
        }
    }

    // MARK: Commands and properties

    func command(_ arguments: [String]) {
        guard let handle else {
            return
        }
        var pointers = arguments.map { UnsafePointer<CChar>(strdup($0)) } + [nil]
        defer {
            for pointer in pointers where pointer != nil {
                free(UnsafeMutablePointer(mutating: pointer))
            }
        }
        _ = pointers.withUnsafeMutableBufferPointer { buffer in
            mpv_command(handle, buffer.baseAddress)
        }
    }

    func set(_ name: String, _ value: String) {
        guard let handle else {
            return
        }
        mpv_set_property_string(handle, name, value)
    }

    func set(_ name: String, flag: Bool) {
        guard let handle else {
            return
        }
        var value: Int32 = flag ? 1 : 0
        mpv_set_property(handle, name, MPV_FORMAT_FLAG, &value)
    }

    func set(_ name: String, double: Double) {
        guard let handle else {
            return
        }
        var value = double
        mpv_set_property(handle, name, MPV_FORMAT_DOUBLE, &value)
    }

    /// A property's current value, read once (diagnostics; playback state is observed instead).
    func value(_ name: String) -> Any? {
        guard let handle else {
            return nil
        }
        var node = mpv_node()
        guard mpv_get_property(handle, name, MPV_FORMAT_NODE, &node) >= 0 else {
            return nil
        }
        defer { mpv_free_node_contents(&node) }
        return MPVNode.node(node)
    }

    /// A string-list property (`http-header-fields`), set as a node so values may hold commas.
    func setStringList(_ name: String, _ values: [String]) {
        guard let handle else {
            return
        }
        let strings = values.map { strdup($0) }
        defer { strings.forEach { free($0) } }
        var items = strings.map { pointer -> mpv_node in
            var node = mpv_node()
            node.format = MPV_FORMAT_STRING
            node.u.string = pointer
            return node
        }
        items.withUnsafeMutableBufferPointer { buffer in
            var list = mpv_node_list(num: Int32(buffer.count), values: buffer.baseAddress, keys: nil)
            withUnsafeMutablePointer(to: &list) { listPointer in
                var node = mpv_node()
                node.format = MPV_FORMAT_NODE_ARRAY
                node.u.list = listPointer
                mpv_set_property(handle, name, MPV_FORMAT_NODE, &node)
            }
        }
    }

    func observe(_ name: String, format: mpv_format) {
        guard let handle else {
            return
        }
        mpv_observe_property(handle, 0, name, format)
    }

    // MARK: Events

    private func drainEvents() {
        events.async { [weak self] in
            self?.readEvents()
        }
    }

    private func readEvents() {
        while let handle, let event = mpv_wait_event(handle, 0)?.pointee, event.event_id != MPV_EVENT_NONE {
            switch event.event_id {
            case MPV_EVENT_PROPERTY_CHANGE:
                if let property = event.data?.assumingMemoryBound(to: mpv_event_property.self).pointee {
                    deliver(property)
                }
            case MPV_EVENT_FILE_LOADED:
                post(.fileLoaded)
            case MPV_EVENT_END_FILE:
                if let end = event.data?.assumingMemoryBound(to: mpv_event_end_file.self).pointee {
                    post(.endFile(reason: Int32(end.reason.rawValue), error: end.error))
                }
            case MPV_EVENT_PLAYBACK_RESTART:
                post(.seekDone)
            case MPV_EVENT_LOG_MESSAGE:
                if let message = event.data?.assumingMemoryBound(to: mpv_event_log_message.self).pointee {
                    let prefix = message.prefix.map { String(cString: $0) } ?? ""
                    let text = message.text.map { String(cString: $0) } ?? ""
                    print("[mpv] \(prefix): \(text)", terminator: "")
                }
            case MPV_EVENT_SHUTDOWN:
                post(.shutdown)
                return
            default:
                break
            }
        }
    }

    private func deliver(_ property: mpv_event_property) {
        let name = String(cString: property.name)
        let value = MPVNode.value(format: property.format, data: property.data)
        DispatchQueue.main.async { [weak self] in
            self?.onProperty?(name, value)
        }
    }

    private func post(_ event: Event) {
        DispatchQueue.main.async { [weak self] in
            self?.onEvent?(event)
        }
    }

    private func check(_ status: Int32, _ what: String) throws {
        if status < 0 {
            throw MPVError("mpv \(what): \(String(cString: mpv_error_string(status)))")
        }
    }
}

struct MPVError: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}

/// Values of observed properties, as Swift values (nodes become arrays and dictionaries).
enum MPVNode {
    static func value(format: mpv_format, data: UnsafeMutableRawPointer?) -> Any? {
        guard let data else {
            return nil
        }
        switch format {
        case MPV_FORMAT_FLAG:
            return data.assumingMemoryBound(to: Int32.self).pointee != 0
        case MPV_FORMAT_INT64:
            return data.assumingMemoryBound(to: Int64.self).pointee
        case MPV_FORMAT_DOUBLE:
            return data.assumingMemoryBound(to: Double.self).pointee
        case MPV_FORMAT_STRING:
            guard let text = data.assumingMemoryBound(to: UnsafePointer<CChar>?.self).pointee else {
                return nil
            }
            return String(cString: text)
        case MPV_FORMAT_NODE:
            return node(data.assumingMemoryBound(to: mpv_node.self).pointee)
        default:
            return nil
        }
    }

    static func node(_ node: mpv_node) -> Any? {
        switch node.format {
        case MPV_FORMAT_STRING:
            return node.u.string.map { String(cString: $0) }
        case MPV_FORMAT_FLAG:
            return node.u.flag != 0
        case MPV_FORMAT_INT64:
            return node.u.int64
        case MPV_FORMAT_DOUBLE:
            return node.u.double_
        case MPV_FORMAT_NODE_ARRAY:
            guard let list = node.u.list?.pointee else {
                return []
            }
            return (0..<Int(list.num)).map { index in self.node(list.values[index]) as Any }
        case MPV_FORMAT_NODE_MAP:
            guard let list = node.u.list?.pointee else {
                return [String: Any]()
            }
            var map: [String: Any] = [:]
            for index in 0..<Int(list.num) {
                if let key = list.keys?[index] {
                    map[String(cString: key)] = self.node(list.values[index])
                }
            }
            return map
        default:
            return nil
        }
    }
}
