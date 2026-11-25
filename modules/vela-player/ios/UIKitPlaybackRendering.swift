import UIKit
import AVKit
import AetherEngine

extension PlaybackClient {
    convenience init(host: UIView, preview: Bool = false, paused: Bool = false, muted: Bool = false,
                     loops: Bool = false, aspectFill: Bool = false, isLive: Bool = false,
                     remoteHLS: Bool = false, retainPausedPicture: Bool = false) {
        self.init(rendering: UIKitPlaybackRendering(host: host, retainPausedPicture: retainPausedPicture),
                  preview: preview, paused: paused, muted: muted, loops: loops, aspectFill: aspectFill,
                  isLive: isLive, remoteHLS: remoteHLS, retainPausedPicture: retainPausedPicture)
    }
}

@MainActor
final class UIKitPlaybackRendering: PlaybackRendering {
    private weak var host: UIView?
    private var surface: AetherPlayerView?
    private var frozenPicture: UIView?
    private let captions = UILabel()
    private var bitmapCaptions: [Int: UIImageView] = [:]
    /// ASS/SSA as authored, where the libass frameworks are built in.
    private lazy var styled = ASSSubtitles()
    private let styledCaption = UIImageView()
    private var textKey = ""
    private var styledTrack: Int?
    private let retainPausedPicture: Bool
    private var aspectFill = false
    private var displayCriteriaObservation: NSKeyValueObservation?
    private var displayObservers: [NSObjectProtocol] = []
    init(host: UIView, retainPausedPicture: Bool) {
        self.host = host
        self.retainPausedPicture = retainPausedPicture
    }
    func bind(engine: AetherEngine) throws {
        guard let host else { throw PlaybackError("Missing native video host") }
        let view = AetherPlayerView(frame: host.bounds)
        view.isUserInteractionEnabled = false
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(view)
        surface = view
        engine.bind(view: view)
        captions.textColor = .white
        captions.font = .boldSystemFont(ofSize: 30)
        captions.textAlignment = .center
        captions.numberOfLines = 0
        captions.layer.shadowColor = UIColor.black.cgColor
        captions.layer.shadowOpacity = 1
        captions.layer.shadowRadius = 3
        // Aether attaches its video CALayer after load, above existing
        // subviews. Captions must remain above it even inside the picture.
        captions.layer.zPosition = 2
        view.addSubview(captions)
    }
    func layout() {
        guard let host else { return }
        frozenPicture?.frame = host.bounds
        surface?.frame = host.bounds
        surface?.setNeedsLayout()
    }
    func configureLoad(options opts: inout LoadOptions, preview: Bool) {
        guard let host else { return }
        #if os(tvOS)
        let manager = host.window?.avDisplayManager
        displayCriteriaObservation = manager?.observe(\.preferredDisplayCriteria, options: [.new]) { manager, _ in
            print("[vela-display] criteriaChanged preview=\(preview) present=\(manager.preferredDisplayCriteria != nil)")
        }
        displayObservers.forEach(NotificationCenter.default.removeObserver)
        displayObservers = [NSNotification.Name.AVDisplayManagerModeSwitchStart, NSNotification.Name.AVDisplayManagerModeSwitchEnd].map { name in
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                print("[vela-display] event=\(name.rawValue) preview=\(preview)")
            }
        }
        print("[vela-display] load preview=\(preview) match=\(opts.matchContentEnabled) owner=\(preview ? "host" : "engine") matching=\(manager?.isDisplayCriteriaMatchingEnabled ?? false) criteria=\(manager?.preferredDisplayCriteria != nil) switching=\(manager?.isDisplayModeSwitchInProgress ?? false)")
        #endif
    }
    func displayMatch() -> DisplayMatch? {
        #if os(tvOS)
        guard let manager = host?.window?.avDisplayManager else { return nil }
        return DisplayMatch(enabled: manager.isDisplayCriteriaMatchingEnabled, requested: manager.preferredDisplayCriteria != nil,
                            switching: manager.isDisplayModeSwitchInProgress)
        #else
        return nil
        #endif
    }
    func drawCaptions(engine: AetherEngine, offset: Double) {
        guard let surface else { return }
        let time = engine.clock.sourceTime - offset
        let cues = engine.subtitleCues.filter { $0.startTime <= time && time < $0.endTime }
        let imageIDs = Set(cues.compactMap { cue -> Int? in
            if case .image = cue.body { return cue.id }; return nil
        })
        for id in Array(bitmapCaptions.keys) where !imageIDs.contains(id) {
            bitmapCaptions.removeValue(forKey: id)?.removeFromSuperview()
        }
        let coded = CGSize(width: Int(engine.sourceVideoWidth), height: Int(engine.sourceVideoHeight))
        let display = engine.softwareDisplaySize ?? coded
        let rect = Self.captionRect(picture: engine.nativePlayerLayer?.videoRect, display: display, bounds: surface.bounds, fill: aspectFill)
        if drawStyled(engine: engine, cues: cues, time: time, rect: rect, coded: coded, surface: surface) {
            captions.attributedText = nil
            textKey = ""
            return
        }
        styledCaption.isHidden = true
        for cue in cues {
            guard case .image(let image) = cue.body else { continue }
            let view = bitmapCaptions[cue.id] ?? UIImageView()
            if bitmapCaptions[cue.id] == nil {
                view.layer.zPosition = 1
                surface.addSubview(view)
                bitmapCaptions[cue.id] = view
            }
            view.image = UIImage(cgImage: image.cgImage)
            let canvas = image.canvasSize == .zero ? coded : image.canvasSize
            guard canvas.width > 0, coded.width > 0, coded.height > 0 else { continue }
            let canvasHeight = canvas.height * coded.width / canvas.width
            let canvasRect = CGRect(x: rect.minX, y: rect.midY - rect.height * canvasHeight / coded.height / 2,
                                    width: rect.width, height: rect.height * canvasHeight / coded.height)
            view.frame = CGRect(x: canvasRect.minX + image.position.minX * canvasRect.width,
                                y: canvasRect.minY + image.position.minY * canvasRect.height,
                                width: image.position.width * canvasRect.width, height: image.position.height * canvasRect.height)
        }
        drawText(cues.filter { if case .image = $0.body { return false }; return true }, rect: rect, surface: surface)
    }

    /// Text cues in the viewer's appearance, sized and placed against the picture, keeping the runs'
    /// bold, italic, underline, strike-through and colour, and an ASS `\an` top or middle placement.
    private func drawText(_ cues: [SubtitleCue], rect: CGRect, surface: UIView) {
        let look = SubtitleAppearance.current
        // Drawn on every clock tick: only a change of cues, look or picture rebuilds the text.
        let key = "\(cues.map(\.id))|\(look)|\(rect)"
        guard key != textKey else { return }
        textKey = key
        let height = max(18, rect.height * look.heightFraction)
        let ink: UIColor = look.color == "yellow" ? UIColor(red: 1, green: 0.92, blue: 0.23, alpha: 1) : .white
        let base = UIFont.systemFont(ofSize: height, weight: .semibold)
        let shadow = NSShadow()
        shadow.shadowColor = UIColor.black.withAlphaComponent(0.9)
        shadow.shadowBlurRadius = height * 0.12
        shadow.shadowOffset = CGSize(width: 0, height: height * 0.04)
        let text = NSMutableAttributedString()
        for cue in cues {
            if text.length > 0 { text.append(NSAttributedString(string: "\n")) }
            let runs: [SubtitleTextRun]
            switch cue.body {
            case .text(let plain): runs = [SubtitleTextRun(text: plain, color: nil)]
            case .richText(let styled): runs = styled
            case .image: runs = []
            }
            for run in runs {
                var traits: UIFontDescriptor.SymbolicTraits = []
                if run.isBold { traits.insert(.traitBold) }
                if run.isItalic { traits.insert(.traitItalic) }
                let font = base.fontDescriptor.withSymbolicTraits(traits).map { UIFont(descriptor: $0, size: height) } ?? base
                var attributes: [NSAttributedString.Key: Any] = [
                    .font: font,
                    .foregroundColor: run.color.map { UIColor(red: CGFloat($0.r) / 255, green: CGFloat($0.g) / 255, blue: CGFloat($0.b) / 255, alpha: 1) } ?? ink,
                ]
                if look.background == "shadow" {
                    attributes[.shadow] = shadow
                    attributes[.strokeColor] = UIColor.black
                    attributes[.strokeWidth] = -2.5
                }
                if run.isUnderlined { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
                if run.isStruckThrough { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
                text.append(NSAttributedString(string: run.text, attributes: attributes))
            }
        }
        captions.attributedText = text
        captions.isHidden = text.length == 0
        guard text.length > 0 else { return }
        captions.backgroundColor = look.background == "box" ? UIColor.black.withAlphaComponent(0.65) : .clear
        captions.layer.cornerRadius = look.background == "box" ? height * 0.2 : 0
        captions.clipsToBounds = look.background == "box"
        let inset = look.background == "box" ? height * 0.35 : 0
        let width = rect.width * 0.9
        let fitted = captions.sizeThatFits(CGSize(width: width - inset * 2, height: .greatestFiniteMagnitude))
        let box = CGSize(width: min(width, fitted.width + inset * 2), height: fitted.height + inset)
        let margin = rect.height * (look.position == "raised" ? 0.16 : 0.06)
        let placement = cues.lazy.compactMap(\.placement).first
        var y = rect.maxY - margin - box.height
        if let alignment = placement?.alignment {
            if alignment >= 7 { y = rect.minY + rect.height * 0.06 } else if alignment >= 4 { y = rect.midY - box.height / 2 }
        }
        var x = rect.midX - box.width / 2
        if let point = placement?.position, (0...1).contains(point.x), (0...1).contains(point.y) {
            x = min(max(rect.minX, rect.minX + point.x * rect.width - box.width / 2), rect.maxX - box.width)
            y = min(max(rect.minY, rect.minY + point.y * rect.height - box.height), rect.maxY - box.height)
        }
        captions.frame = CGRect(x: x, y: y, width: box.width, height: box.height)
    }

    /// Draws the active ASS/SSA track through libass; false when it is not one or libass is not built in.
    private func drawStyled(engine: AetherEngine, cues: [SubtitleCue], time: Double, rect: CGRect, coded: CGSize,
                            surface: UIView) -> Bool {
        guard ASSSubtitles.isAvailable, let index = engine.activeSubtitleTrackIndex,
              let track = engine.subtitleTracks.first(where: { $0.id == index }),
              ["ass", "ssa"].contains(track.codec),
              let header = track.isExternal ? engine.sidecarASSHeader : track.assHeader,
              let styled, rect.width > 0 else { return false }
        if styledTrack != track.id {
            styledTrack = track.id
            print("[vela-captions] libass track=\(track.id) codec=\(track.codec) header=\(header.count) fonts=\(engine.fontAttachments.count)")
        }
        if styledCaption.superview !== surface {
            styledCaption.layer.zPosition = 2
            surface.addSubview(styledCaption)
        }
        // Rendered at the picture's pixel size, at most 1920 wide: libass's cost grows with the area.
        let scale = min(surface.window?.screen.scale ?? 1, 1920 / rect.width)
        let pixels = CGSize(width: rect.width * scale, height: rect.height * scale)
        guard let (image, box) = styled.render(key: "\(track.id)|\(track.isExternal)", header: header, fonts: engine.fontAttachments,
                                                cues: cues, time: time, pixels: pixels, storage: coded) else {
            styledCaption.isHidden = true
            return true
        }
        styledCaption.image = UIImage(cgImage: image)
        styledCaption.frame = CGRect(x: rect.minX + box.minX / scale, y: rect.minY + box.minY / scale,
                                     width: box.width / scale, height: box.height / scale)
        styledCaption.isHidden = false
        return true
    }
    func setAspectFill(_ fill: Bool) {
        aspectFill = fill
        frozenPicture?.contentMode = fill ? .scaleAspectFill : .scaleAspectFit
        textKey = ""
    }

    /// Where captions are laid out: the picture as shown, kept to the view. A filled picture runs past
    /// the view's edges, so captions keep to the part that shows rather than falling off screen.
    nonisolated static func captionRect(picture: CGRect?, display: CGSize, bounds: CGRect, fill: Bool) -> CGRect {
        let fitted = AVMakeRect(aspectRatio: display, insideRect: bounds)
        var shown = picture ?? fitted
        if picture == nil, fill, fitted.width > 0, fitted.height > 0 {
            let scale = max(bounds.width / fitted.width, bounds.height / fitted.height)
            shown = CGRect(x: bounds.midX - fitted.width * scale / 2, y: bounds.midY - fitted.height * scale / 2,
                           width: fitted.width * scale, height: fitted.height * scale)
        }
        let visible = shown.intersection(bounds)
        return visible.isNull || visible.isEmpty ? fitted : visible
    }

    func freezePicture(frame: CGImage?, aspectFill: Bool) {
        guard frozenPicture == nil, let host else { return }
        if let frame {
                let still = UIImageView(image: UIImage(cgImage: frame))
                still.contentMode = aspectFill ? .scaleAspectFill : .scaleAspectFit
                still.backgroundColor = .black
                still.clipsToBounds = true
                frozenPicture = still
        }
        let decoded = frozenPicture != nil
        if frozenPicture == nil { frozenPicture = surface?.snapshotView(afterScreenUpdates: false) }
        guard let still = frozenPicture else { return }
        print("[vela-preview] retained decoded=\(decoded)")
        still.frame = host.bounds
        still.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(still)
    }

    func clearFrozenPicture() {
        frozenPicture?.removeFromSuperview()
        frozenPicture = nil
    }
    func removeSurface() {
        displayCriteriaObservation = nil
        displayObservers.forEach(NotificationCenter.default.removeObserver)
        displayObservers.removeAll()
        bitmapCaptions.values.forEach { $0.removeFromSuperview() }
        bitmapCaptions.removeAll()
        styledCaption.removeFromSuperview()
        surface?.removeFromSuperview()
        surface = nil
    }
}
