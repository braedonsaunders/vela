// Expo is a thin host for the shared Apple playback session.
import ExpoModulesCore
import UIKit

final class VelaPlayerView: ExpoView {
    let onMediaAuthorization = EventDispatcher()
    let onSnapshot = EventDispatcher()
    let onError = EventDispatcher()
    let onObservation = EventDispatcher()
    let onCommand = EventDispatcher()
    let onSessionCommand = EventDispatcher()
    let onSessionRefresh = EventDispatcher()
    private lazy var session: PlaybackSession = {
        let value = PlaybackSession(host: UIKitPlaybackHost(view: self))
        value.onMediaAuthorization = { [weak self] in self?.onMediaAuthorization($0) }
        value.onSnapshot = { [weak self] in self?.onSnapshot($0) }
        value.onError = { [weak self] in self?.onError($0) }
        value.onObservation = { [weak self] in self?.onObservation($0) }
        value.onCommand = { [weak self] in self?.onCommand($0) }
        value.onSessionCommand = { [weak self] in self?.onSessionCommand($0) }
        value.onSessionRefresh = { [weak self] in self?.onSessionRefresh($0) }
        return value
    }()
    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .clear
        clipsToBounds = true
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        #if os(iOS)
        // iOS takes the view out of its window when the app leaves the foreground. That is not the viewer
        // leaving the page: a watch plays on behind the home screen (UIBackgroundModes audio) or in its
        // picture-in-picture window. Back in the foreground, a view still without a window has left.
        if window == nil, UIApplication.shared.applicationState != .active {
            returnObserver = returnObserver ?? NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.endReturnObservation()
                    if self.window == nil { self.session.hostAttachmentChanged() }
                }
            }
            return
        }
        endReturnObservation()
        #endif
        session.hostAttachmentChanged()
    }
    #if os(iOS)
    deinit {
        if let returnObserver { NotificationCenter.default.removeObserver(returnObserver) }
    }
    private var returnObserver: NSObjectProtocol?
    private func endReturnObservation() {
        if let returnObserver { NotificationCenter.default.removeObserver(returnObserver) }
        returnObserver = nil
    }
    #endif
    override func layoutSubviews() { super.layoutSubviews(); session.layout() }
    func commitProps() { session.commitProps() }
    func setAmbient(_ value: Bool) { session.setAmbient(value) }
    func setTile(_ value: Int?) { session.setTile(value) }
    func setMetadata(_ map: [String: Any]?) { session.setMetadata(map) }
    func setPreview(_ map: [String: Any]?) { session.setPreview(map) }
    func setActive(_ value: Bool?) { session.setActive(value) }
    func setPlan(_ object: [String: Any]?) { session.setPlan(object) }
    func setMediaAuthorization(_ result: [String: Any]?) { session.setMediaAuthorization(result) }
    func setServerError(_ failure: [String: Any]?) { session.setServerError(failure) }
    func setCommand(_ command: [String: Any]?) { session.setCommand(command) }
}

@MainActor
private final class UIKitPlaybackHost: PlaybackHost {
    private weak var view: UIView?
    init(view: UIView) { self.view = view }
    var attached: Bool { view?.window != nil }
    func makeRendering(retainPausedPicture: Bool) -> PlaybackRendering {
        UIKitPlaybackRendering(host: view!, retainPausedPicture: retainPausedPicture)
    }
    func setBackground(clear: Bool) { view?.backgroundColor = clear ? .clear : .black }
    /// Views playing at once (multiview tiles) hold the screen awake together: the last to stop lets it sleep.
    private static var awake = 0
    private var holdsAwake = false
    func keepAwake(_ on: Bool) {
        guard on != holdsAwake else { return }
        holdsAwake = on
        Self.awake += on ? 1 : -1
        UIApplication.shared.isIdleTimerDisabled = Self.awake > 0
    }
    func activateAudio() { PlaybackAudioSession.activate() }
    func claim(_ owner: SystemMediaOwner) { SystemMediaControls.shared.claim(owner) }
    func release(_ owner: SystemMediaOwner) { SystemMediaControls.shared.release(owner) }
    func updateNowPlaying(_ state: NowPlayingState, owner: SystemMediaOwner) { SystemMediaControls.shared.update(state, from: owner) }
}
