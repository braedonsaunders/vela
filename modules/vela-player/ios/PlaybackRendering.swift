// Platform views own composition; session, transport and engine policy stay shared.
import Foundation
import AVFoundation
import AetherEngine

struct CaptionInsets: Equatable {
    let left: CGFloat, right: CGFloat, top: CGFloat, bottom: CGFloat

    init(_ fields: [String: Any]? = nil) {
        func points(_ name: String) -> CGFloat {
            let value = (fields?[name] as? NSNumber)?.doubleValue ?? 0
            return value.isFinite ? max(0, CGFloat(value)) : 0
        }
        left = points("left"); right = points("right")
        top = points("top"); bottom = points("bottom")
    }

    func fit(_ picture: CGRect, in bounds: CGRect, flipped: Bool = true) -> CGRect {
        let safe = CGRect(x: bounds.minX + left, y: bounds.minY + (flipped ? top : bottom),
                          width: max(0, bounds.width - left - right),
                          height: max(0, bounds.height - top - bottom))
        return picture.intersection(safe)
    }
}

@MainActor
protocol PlaybackRendering: AnyObject {
    func bind(engine: AetherEngine) throws
    func layout()
    func configureLoad(options: inout LoadOptions, preview: Bool)
    /// `offset` is the viewer's subtitle delay: positive shows cues later.
    func setWindowedSubtitleCues(_ cues: [SubtitleCue]?)
    func drawCaptions(engine: AetherEngine, offset: Double)
    func freezePicture(frame: CGImage?, aspectFill: Bool)
    /// The picture fills the view (cropping) instead of fitting it: captions keep to the part that shows.
    func setAspectFill(_ fill: Bool)
    func setCaptionInsets(_ insets: CaptionInsets)
    func clearFrozenPicture()
    func removeSurface()
    /// The display's content-matching state, where the platform switches display modes (tvOS).
    func displayMatch() -> DisplayMatch?
}

extension PlaybackRendering {
    func setWindowedSubtitleCues(_ cues: [SubtitleCue]?) {}
    func displayMatch() -> DisplayMatch? { nil }
    func setAspectFill(_ fill: Bool) {}
    func setCaptionInsets(_ insets: CaptionInsets) {}
}
