// Platform views own composition; session, transport and engine policy stay shared.
import Foundation
import AVFoundation
import AetherEngine

@MainActor
protocol PlaybackRendering: AnyObject {
    func bind(engine: AetherEngine) throws
    func layout()
    func configureLoad(options: inout LoadOptions, preview: Bool)
    /// `offset` is the viewer's subtitle delay: positive shows cues later.
    func drawCaptions(engine: AetherEngine, offset: Double)
    func freezePicture(frame: CGImage?, aspectFill: Bool)
    /// The picture fills the view (cropping) instead of fitting it: captions keep to the part that shows.
    func setAspectFill(_ fill: Bool)
    func clearFrozenPicture()
    func removeSurface()
    /// The display's content-matching state, where the platform switches display modes (tvOS).
    func displayMatch() -> DisplayMatch?
}

extension PlaybackRendering {
    func displayMatch() -> DisplayMatch? { nil }
    func setAspectFill(_ fill: Bool) {}
}
