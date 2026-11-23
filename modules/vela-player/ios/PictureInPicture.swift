// Picture in picture for a full-screen watch, on whichever layer the engine draws into: the native
// route's AVPlayerLayer (`nativePlayerLayer`) or the software route's sample-buffer layer
// (`softwarePiPSource`, which builds its own controller). iOS, iPadOS and the Mac host; tvOS does not
// present sample-buffer content and has no reachable PiP affordance behind Vela's chrome, so it offers none.
import AVFoundation
import AVKit
import AetherEngine
import Combine
import Foundation

@MainActor
final class PictureInPicture: NSObject {
    /// The window opened or closed, or whether one can open changed.
    var onChange: (() -> Void)?
    /// iOS: going home while playing opens the window on its own.
    private let automatic: Bool
    private weak var engine: AetherEngine?
    private var controller: AVPictureInPictureController?
    /// What the controller was made around, so a route change rebuilds it and a clock tick does not.
    private weak var madeFor: AnyObject?
    private var possible: NSKeyValueObservation?
    private var subscriptions = Set<AnyCancellable>()
    private(set) var active = false

    static var supported: Bool {
        // Not offered on the Mac desktop host yet: macOS never reports PiP stopping when Vela
        // closes it, and a closed window has not been confirmed gone. iOS and iPadOS offer it.
        #if os(tvOS) || os(macOS)
        return false
        #else
        return AVPictureInPictureController.isPictureInPictureSupported()
        #endif
    }

    init(automatic: Bool) {
        self.automatic = automatic
    }

    /// A window can be opened for the playing title.
    var available: Bool { controller != nil }

    func attach(_ engine: AetherEngine) {
        guard Self.supported else { return }
        detach()
        self.engine = engine
        // @Published delivers before the property is assigned: read the engine on the next turn.
        let rebuild: (Any) -> Void = { [weak self] _ in DispatchQueue.main.async { self?.rebuild() } }
        engine.$softwarePiPSource.sink(receiveValue: rebuild).store(in: &subscriptions)
        engine.$videoRoute.sink(receiveValue: rebuild).store(in: &subscriptions)
    }

    /// The engine's layer may have changed (a load finished, the route moved): a controller for the current one.
    func rebuild() {
        guard let engine else { return }
        let target: AnyObject? = engine.softwarePiPSource ?? engine.nativePlayerLayer
        guard target !== madeFor || (target != nil && controller == nil) else { return }
        madeFor = target
        possible = nil
        let made: AVPictureInPictureController?
        if let source = engine.softwarePiPSource {
            made = source.makePictureInPictureController()
        } else if let layer = engine.nativePlayerLayer {
            made = AVPictureInPictureController(playerLayer: layer)
        } else {
            made = nil
        }
        controller = made
        if let made {
            made.delegate = self
            #if os(iOS)
            made.canStartPictureInPictureAutomaticallyFromInline = automatic
            #endif
            possible = made.observe(\.isPictureInPicturePossible, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.onChange?() }
            }
        }
        print("[vela-pip] controller=\(made != nil) route=\(engine.videoRoute.rawValue) software=\(engine.softwarePiPSource != nil)")
        onChange?()
    }

    /// Opens the window, or closes the one open. A refusal's reason, or nil.
    func toggle() -> String? {
        guard let controller else { return "Picture in picture is not available for this title" }
        if controller.isPictureInPictureActive {
            controller.stopPictureInPicture()
            #if os(macOS)
            // macOS (seen with the Electron host behind another app) takes the window down but sends no
            // did-stop and still reports it active: let go of that controller so the state resets and
            // the next press opens a window again.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self, weak controller] in
                guard let self, let controller, controller === self.controller, controller.isPictureInPictureActive else { return }
                print("[vela-pip] stop request ignored; releasing the controller")
                self.release()
                self.rebuild()
            }
            #endif
            return nil
        }
        guard controller.isPictureInPicturePossible else { return "Picture in picture is not possible right now" }
        controller.startPictureInPicture()
        return nil
    }

    func detach() {
        release()
        subscriptions.removeAll()
        engine = nil
    }

    /// Closes any window and lets go of the controller; `rebuild()` makes a new one.
    private func release() {
        controller?.stopPictureInPicture()
        controller?.delegate = nil
        controller = nil
        madeFor = nil
        possible = nil
        setActive(false)
    }

    private func setActive(_ value: Bool) {
        guard value != active else { return }
        active = value
        // Keeps the pipeline alive in the background and, on the software route, draws subtitles into the window.
        engine?.pictureInPictureActive = value
        print("[vela-pip] active=\(value)")
        onChange?()
    }
}

extension PictureInPicture: AVPictureInPictureControllerDelegate {
    nonisolated func pictureInPictureControllerWillStartPictureInPicture(_ controller: AVPictureInPictureController) {
        DispatchQueue.main.async { self.setActive(true) }
    }

    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        DispatchQueue.main.async { self.setActive(false) }
    }

    nonisolated func pictureInPictureController(_ controller: AVPictureInPictureController,
                                                failedToStartPictureInPictureWithError error: Error) {
        print("[vela-pip] failed to start: \(error.localizedDescription)")
        DispatchQueue.main.async { self.setActive(false) }
    }

    /// The window's return button: the player is still on screen behind it.
    nonisolated func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(true)
    }
}
