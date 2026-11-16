// The player's surface: the native engine's AVSampleBufferDisplayLayer, AVPlayer's layer for
// the server's HLS, and the subtitle overlay above them. It also asks the display to follow
// the content (Settings › Video and Audio › Match Content: dynamic range and frame rate).
import AVFoundation
import AVKit
import UIKit

final class VelaSurface: UIView {
    let videoLayer = AVSampleBufferDisplayLayer()
    let playerLayer = AVPlayerLayer()
    var subtitleStyle = VelaSubtitleStyle() {
        didSet { shownCue = "" }
    }

    private let caption = UILabel()
    private let captionBox = UIView()
    private var bitmapViews: [UIImageView] = []
    private var shownCue = ""

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isUserInteractionEnabled = false
        videoLayer.videoGravity = .resizeAspect
        playerLayer.videoGravity = .resizeAspect
        layer.addSublayer(videoLayer)
        layer.addSublayer(playerLayer)
        captionBox.layer.cornerRadius = 8
        captionBox.isHidden = true
        addSubview(captionBox)
        caption.numberOfLines = 0
        caption.textAlignment = .center
        caption.isHidden = true
        addSubview(caption)
    }

    required init?(coder: NSCoder) {
        fatalError("VelaSurface is made in code")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if let window {
            VelaDisplay.manager = window.avDisplayManager
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        videoLayer.frame = bounds
        playerLayer.frame = bounds
        CATransaction.commit()
        shownCue = ""
    }

    /// Clears the picture and the overlay between sources.
    func reset() {
        videoLayer.sampleBufferRenderer.flush(removingDisplayedImage: true) {}
        playerLayer.player = nil
        show(nil)
    }

    /// Prefers the display mode for `format` (nil: the display's own mode again).
    func preferDisplay(format: CMFormatDescription?, frameRate: Double) {
        guard let manager = window?.avDisplayManager ?? VelaDisplay.manager else {
            return
        }
        VelaDisplay.manager = manager
        guard manager.isDisplayCriteriaMatchingEnabled else {
            return
        }
        guard let format else {
            manager.preferredDisplayCriteria = nil
            return
        }
        let rate = Float(frameRate > 0 ? frameRate : 24)
        manager.preferredDisplayCriteria = AVDisplayCriteria(refreshRate: rate, formatDescription: format)
    }

    // MARK: Subtitles

    func show(_ cue: VelaCue?) {
        let key = Self.key(cue)
        guard key != shownCue else {
            return
        }
        shownCue = key
        caption.isHidden = true
        captionBox.isHidden = true
        bitmapViews.forEach { $0.removeFromSuperview() }
        bitmapViews = []
        switch cue?.content {
        case .text(let text)?:
            showText(text)
        case .bitmaps(let bitmaps, let canvas)?:
            showBitmaps(bitmaps, canvas: canvas)
        case nil:
            break
        }
    }

    private static func key(_ cue: VelaCue?) -> String {
        switch cue?.content {
        case .text(let text)?: return "text:\(text)"
        case .bitmaps(let bitmaps, _)?: return "bitmaps:\(cue?.start ?? 0):\(bitmaps.count)"
        case nil: return ""
        }
    }

    private func showText(_ text: String) {
        let shadow = NSShadow()
        shadow.shadowColor = UIColor.black
        shadow.shadowBlurRadius = subtitleStyle.background == "shadow" ? 6 : 0
        shadow.shadowOffset = .zero
        let colour = subtitleStyle.color == "yellow" ? UIColor.systemYellow : UIColor.white
        caption.attributedText = NSAttributedString(string: text, attributes: [
            .font: UIFont.systemFont(ofSize: bounds.height * subtitleStyle.scale, weight: .semibold),
            .foregroundColor: colour,
            .shadow: shadow,
        ])
        let fit = caption.sizeThatFits(CGSize(width: bounds.width * 0.8, height: .greatestFiniteMagnitude))
        let bottom = bounds.height * (subtitleStyle.raised ? 0.82 : 0.92)
        let left = (bounds.width - fit.width) / 2
        caption.frame = CGRect(x: left, y: bottom - fit.height, width: fit.width, height: fit.height)
        caption.isHidden = false
        if subtitleStyle.background == "box" {
            captionBox.backgroundColor = UIColor.black.withAlphaComponent(0.7)
            captionBox.frame = caption.frame.insetBy(dx: -16, dy: -8)
            captionBox.isHidden = false
        }
    }

    /// Bitmaps placed on their canvas, scaled to fit the view as the picture is.
    private func showBitmaps(_ bitmaps: [VelaBitmap], canvas: CGSize) {
        let size = canvas.width > 0 && canvas.height > 0 ? canvas : CGSize(width: 1920, height: 1080)
        let scale = min(bounds.width / size.width, bounds.height / size.height)
        let left = (bounds.width - size.width * scale) / 2
        let top = (bounds.height - size.height * scale) / 2
        for bitmap in bitmaps {
            let view = UIImageView(image: UIImage(cgImage: bitmap.image))
            view.frame = CGRect(
                x: left + bitmap.frame.minX * scale,
                y: top + bitmap.frame.minY * scale,
                width: bitmap.frame.width * scale,
                height: bitmap.frame.height * scale
            )
            addSubview(view)
            bitmapViews.append(view)
        }
    }
}

/// The window's display manager, kept for the demux thread's mode-switch wait.
enum VelaDisplay {
    static weak var manager: AVDisplayManager?

    /// Whether the display is switching modes (it blanks meanwhile). Call off the main thread.
    static func switching() -> Bool {
        DispatchQueue.main.sync {
            manager?.isDisplayModeSwitchInProgress ?? false
        }
    }
}
