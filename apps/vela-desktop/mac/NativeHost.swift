import AppKit
import AVFoundation
import IOKit.pwr_mgt

@MainActor
final class MacPlaybackHost: PlaybackHost {
    let view = VideoContainer(frame: .zero)
    var attached: Bool { view.window != nil }
    private(set) var rendering: AppKitPlaybackRendering?
    private var assertion: IOPMAssertionID = 0
    init(webView: NSView) throws {
        // BrowserWindow.getNativeWindowHandle is the NSWindow contentView, not
        // the Chromium child. Install beneath its existing web-content children.
        let parent = webView
        guard parent.window != nil else { throw PlaybackError("Missing Electron window") }
        view.wantsLayer = true
        view.layer?.wantsExtendedDynamicRangeContent = true
        parent.addSubview(view, positioned: .below, relativeTo: parent.subviews.first)
    }
    func makeRendering(retainPausedPicture: Bool) -> PlaybackRendering {
        let value = AppKitPlaybackRendering(host: view)
        rendering = value
        return value
    }
    func setBackground(clear: Bool) { view.layer?.backgroundColor = clear ? NSColor.clear.cgColor : NSColor.black.cgColor }
    func keepAwake(_ on: Bool) {
        if on && assertion == 0 { IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn), "Vela playback" as CFString, &assertion) }
        if !on && assertion != 0 { IOPMAssertionRelease(assertion); assertion = 0 }
    }
    func activateAudio() {}
    func claim(_ owner: SystemMediaOwner) {}
    func release(_ owner: SystemMediaOwner) { keepAwake(false) }
    func updateNowPlaying(_ state: NowPlayingState, owner: SystemMediaOwner) {}
}

@MainActor
final class NativeSession {
    let host: MacPlaybackHost
    let session: PlaybackSession
    private var fallbackEmitted = false
    var restartForAccess = false
    var hasAccess = false
    var events: [[String: Any]] = []
    init(webView: NSView) throws {
        host = try MacPlaybackHost(webView: webView)
        session = PlaybackSession(host: host)
        session.onSnapshot = { [weak self] in self?.emit("snapshot", $0) }
        session.onObservation = { [weak self] in self?.emit("observation", $0) }
        session.onCommand = { [weak self] in self?.emit("command", $0) }
        session.onError = { [weak self] value in
            guard let self else { return }
            self.emit("error", value)
            if value["recoverable"] as? Bool == false, !self.fallbackEmitted {
                self.fallbackEmitted = true
                self.emit("fallback", ["reason": "native-playback-failed"])
            }
        }
        session.onSessionCommand = { [weak self] in self?.emit("session-command", $0) }
        session.onSessionRefresh = { [weak self] in self?.emit("session-refresh", $0) }
        session.onMediaAuthorization = { _ in }
    }
    func emit(_ event: String, _ value: [String: Any]) { events.append(["event": event, "value": value]) }
    func destroy() { session.stop(); host.keepAwake(false); host.view.removeFromSuperview(); events.removeAll() }
}

// C ABI keeps Node/Electron ABI details out of Swift. Calls are on Electron's main thread.
@_cdecl("vela_create")
public func velaCreate(_ pointer: UnsafeMutableRawPointer) -> UnsafeMutableRawPointer? {
    MainActor.assumeIsolated {
        do {
            let view = Unmanaged<NSView>.fromOpaque(pointer).takeUnretainedValue()
            return Unmanaged.passRetained(try NativeSession(webView: view)).toOpaque()
        } catch { return nil }
    }
}
@_cdecl("vela_call")
public func velaCall(_ pointer: UnsafeMutableRawPointer, _ operation: UnsafePointer<CChar>, _ json: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    MainActor.assumeIsolated {
        let native = Unmanaged<NativeSession>.fromOpaque(pointer).takeUnretainedValue()
        let value = (try? JSONSerialization.jsonObject(with: Data(String(cString: json).utf8))) as? [String: Any] ?? [:]
        var result: Any = [:]
        switch String(cString: operation) {
        case "update":
            if let media = value["nativeMedia"] as? [String: Any],
               let object = value["plan"] as? [String: Any], let plan = VelaPlan.decode(object),
               let planID = media["planId"] as? String, planID == plan.mediaIdentity,
               let sourceText = media["source"] as? String,
               let source = URL(string: sourceText, relativeTo: VelaMediaAccessStore.origin.flatMap(URL.init(string:)))?.absoluteURL,
               let pathURL = plan.selectedPath?.url,
               let expected = URL(string: pathURL, relativeTo: VelaMediaAccessStore.origin.flatMap(URL.init(string:)))?.absoluteURL,
               source == expected,
               let authorizedText = media["authorized"] as? String, let authorized = URL(string: authorizedText),
               let generation = media["generation"] as? Int {
                _ = VelaMediaAccessStore.attach(plan: planID, source: source, authorized: authorized, generation: generation)
            }
            native.session.setMediaAuthorization(value["mediaAuthorization"] as? [String: Any])
            native.session.setAmbient(value["ambient"] as? Bool ?? false)
            native.session.setMetadata(value["metadata"] as? [String: Any])
            native.session.setActive(value["active"] as? Bool)
            if value.keys.contains("plan") { native.session.setPlan(value["plan"] as? [String: Any]) }
            native.session.setCommand(value["command"] as? [String: Any])
            native.session.setServerError(value["serverError"] as? [String: Any])
            native.session.commitProps()
            if native.restartForAccess && native.hasAccess {
                native.restartForAccess = false
                native.session.restartAfterMediaAccessChange()
            }
        case "access":
            native.session.stop()
            native.restartForAccess = true
            let access = try? VelaMediaAuth(value)
            native.hasAccess = access != nil
            VelaMediaAccessStore.set(access, generation: (value["generation"] as? NSNumber)?.intValue ?? 0)
        case "caption-insets":
            native.session.setCaptionInsets(value)
        case "bounds":
            let x = value["x"] as? Double ?? 0, y = value["y"] as? Double ?? 0
            let w = max(0, value["width"] as? Double ?? 0), h = max(0, value["height"] as? Double ?? 0)
            if let parent = native.host.view.superview {
                native.host.view.frame = NSRect(x: x, y: parent.isFlipped ? y : parent.bounds.height - y - h, width: w, height: h)
            }
            native.host.view.isHidden = w == 0 || h == 0
            native.session.layout()
        case "poll": result = native.events; native.events.removeAll()
        case "diagnostics":
            var fields: [String: Any] = native.host.rendering?.diagnostics ?? [:]
            fields.merge(["edrPotential": native.host.view.window?.screen?.maximumPotentialExtendedDynamicRangeColorComponentValue ?? 1, "edrCurrent": native.host.view.window?.screen?.maximumExtendedDynamicRangeColorComponentValue ?? 1]) { _, new in new }
            result = fields
        default: break
        }
        guard let data = try? JSONSerialization.data(withJSONObject: result), let text = String(data: data, encoding: .utf8) else { return nil }
        return strdup(text)
    }
}
@_cdecl("vela_destroy")
public func velaDestroy(_ pointer: UnsafeMutableRawPointer) {
    MainActor.assumeIsolated {
        let native = Unmanaged<NativeSession>.fromOpaque(pointer).takeRetainedValue()
        native.destroy()
        VelaMediaAccessStore.set(nil)
    }
}

@_cdecl("vela_capabilities")
public func velaCapabilities() -> UnsafeMutablePointer<CChar>? {
    MainActor.assumeIsolated {
        guard let data = try? JSONSerialization.data(withJSONObject: PlayerCapabilities.probe()), let text = String(data: data, encoding: .utf8) else { return nil }
        return strdup(text)
    }
}
