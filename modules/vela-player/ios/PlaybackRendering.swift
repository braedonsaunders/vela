// Platform views own composition; session, transport and engine policy stay shared.
import Foundation
import AVFoundation
import AetherEngine

@MainActor
protocol PlaybackRendering: AnyObject {
    func bind(engine: AetherEngine) throws
    func layout()
    func configureLoad(options: inout LoadOptions, preview: Bool)
    func drawCaptions(engine: AetherEngine)
    func freezePicture(frame: CGImage?, aspectFill: Bool)
    func clearFrozenPicture()
    func removeSurface()
    /// The display's content-matching state, where the platform switches display modes (tvOS).
    func displayMatch() -> DisplayMatch?
}

extension PlaybackRendering {
    func displayMatch() -> DisplayMatch? { nil }
}
