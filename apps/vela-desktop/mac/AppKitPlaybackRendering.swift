import AppKit
import AVFoundation
import AetherEngine
import Combine

// Flipped coordinates match Electron's DIP rectangles and the Apple caption layout.
final class VideoContainer: NSView {
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

@MainActor
final class AppKitPlaybackRendering: PlaybackRendering {
    private weak var host: NSView?
    private var surface: AetherPlayerView?
    private weak var engine: AetherEngine?
    private let captions = NSTextField(wrappingLabelWithString: "")
    private var subscriptions = Set<AnyCancellable>()
    private var images: [Int: CALayer] = [:]
    /// ASS/SSA as authored through libass (built in by mac/build.mjs), as on tvOS and iOS.
    private lazy var styled = ASSSubtitles()
    private let styledCaption = CALayer()
    private var styledTrack: Int?
    private var captionInsets = CaptionInsets()
    func setCaptionInsets(_ insets: CaptionInsets) { captionInsets = insets }
    init(host: NSView) { self.host = host }
    func bind(engine: AetherEngine) throws {
        guard let host else { throw PlaybackError("Missing video surface") }
        self.engine = engine
        let view = AetherPlayerView(frame: host.bounds)
        view.autoresizingMask = [.width, .height]
        view.wantsLayer = true
        view.layer?.wantsExtendedDynamicRangeContent = true
        host.addSubview(view)
        surface = view
        engine.bind(view: view)
        captions.textColor = .white
        captions.font = .boldSystemFont(ofSize: 30)
        captions.alignment = .center
        captions.isSelectable = false
        captions.wantsLayer = true
        captions.layer?.zPosition = 2
        captions.layer?.shadowColor = NSColor.black.cgColor
        captions.layer?.shadowOpacity = 1
        captions.layer?.shadowRadius = 3
        view.addSubview(captions)
        engine.$videoFormat.sink { [weak self, weak engine] format in
            if let engine { self?.configureDynamicRange(engine: engine, format: format) }
        }.store(in: &subscriptions)
    }
    private func configureDynamicRange(engine: AetherEngine, format: VideoFormat? = nil) {
        let hdr = (format ?? engine.videoFormat) != .sdr
        // Container flags do not propagate to the receiving video layer.
        // Reapply after attachment and reset both properties when a pooled layer plays SDR.
        for layer in [surface?.layer, engine.nativePlayerLayer].compactMap({ $0 }) {
            if layer.wantsExtendedDynamicRangeContent != hdr { layer.wantsExtendedDynamicRangeContent = hdr }
            if #available(macOS 26.0, *) {
                let range: CALayer.DynamicRange = hdr ? .high : .standard
                if layer.preferredDynamicRange != range { layer.preferredDynamicRange = range }
            }
        }
    }
    var diagnostics: [String: Any] {
        let preferred: String
        if #available(macOS 26.0, *), let layer = engine?.nativePlayerLayer {
            preferred = layer.preferredDynamicRange.rawValue
        } else { preferred = "unavailable" }
        return ["preferredDynamicRange": preferred,
"surfaceEDR": surface?.layer?.wantsExtendedDynamicRangeContent ?? false,
         "playerLayerEDR": engine?.nativePlayerLayer?.wantsExtendedDynamicRangeContent ?? false,
         "route": engine.map { String(describing: $0.videoRoute) } ?? "none",
         "videoFormat": engine.map { String(describing: $0.videoFormat) } ?? "none",
         "firstFrameReady": engine?.hasFirstFrameReadyForDisplay ?? false,
         "rate": engine?.currentAVPlayer?.rate ?? 0]
    }
    func layout() {
        if let host { surface?.frame = host.bounds }
        if let engine { configureDynamicRange(engine: engine) }
    }
    func configureLoad(options: inout LoadOptions, preview: Bool) {
        let fullscreen = host?.window?.styleMask.contains(.fullScreen) == true
        options.matchContentEnabled = fullscreen && !preview
        if !fullscreen || preview { options.displayCriteriaOwner = .host }
    }
    func drawCaptions(engine: AetherEngine, offset: Double) {
        configureDynamicRange(engine: engine)
        guard let surface else { return }
        let time = engine.clock.sourceTime - offset
        let cues = engine.subtitleCues.filter { $0.startTime <= time && time < $0.endTime }
        let ids = Set(cues.map(\.id))
        for id in Array(images.keys) where !ids.contains(id) { images.removeValue(forKey: id)?.removeFromSuperlayer() }
        let coded = CGSize(width: Int(engine.sourceVideoWidth), height: Int(engine.sourceVideoHeight))
        let display = engine.softwareDisplaySize ?? coded
        let picture = engine.nativePlayerLayer?.videoRect ?? AVMakeRect(aspectRatio: display, insideRect: surface.bounds)
        let rect = captionInsets.fit(picture, in: surface.bounds, flipped: surface.isFlipped)
        // Layers are placed directly: implicit animations would trail karaoke and moving signs.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        let empty = rect.isNull || rect.isEmpty
        captions.isHidden = empty
        for layer in images.values { layer.isHidden = empty }
        if empty {
            styledCaption.isHidden = true
            return
        }
        if drawStyled(engine: engine, cues: cues, time: time, rect: rect, coded: coded, surface: surface) {
            captions.stringValue = ""
            return
        }
        styledCaption.isHidden = true
        for cue in cues {
            guard case .image(let image) = cue.body else { continue }
            let layer = images[cue.id] ?? CALayer()
            if images[cue.id] == nil { layer.zPosition = 1; surface.layer?.addSublayer(layer); images[cue.id] = layer }
            layer.contents = image.cgImage
            let canvas = image.canvasSize == .zero ? coded : image.canvasSize
            guard canvas.width > 0, coded.width > 0, coded.height > 0 else { continue }
            let height = rect.height * canvas.height * coded.width / canvas.width / coded.height
            layer.frame = CGRect(x: rect.minX + image.position.minX * rect.width,
                                 y: rect.midY + height / 2 - image.position.maxY * height,
                                 width: image.position.width * rect.width, height: image.position.height * height)
        }
        captions.stringValue = cues.compactMap { cue -> String? in
            switch cue.body {
            case .text(let text): return text
            case .richText(let runs): return runs.map(\.text).joined()
            case .image: return nil
            }
        }.joined(separator: "\n")
        let width = rect.width * 0.9
        let margin = rect.height * 0.06
        let height = min(rect.height - margin, captions.cell?.cellSize(forBounds: CGRect(x: 0, y: 0, width: width, height: rect.height)).height ?? 0)
        captions.frame = CGRect(x: rect.midX - width / 2,
                                y: surface.isFlipped ? rect.maxY - margin - height : rect.minY + margin,
                                width: width, height: height)
    }
    /// Draws the active ASS/SSA track through libass; false when it is not one or libass is not built in.
    private func drawStyled(engine: AetherEngine, cues: [SubtitleCue], time: Double, rect: CGRect, coded: CGSize,
                            surface: NSView) -> Bool {
        guard ASSSubtitles.isAvailable, let index = engine.activeSubtitleTrackIndex,
              let track = engine.subtitleTracks.first(where: { $0.id == index }),
              ["ass", "ssa"].contains(track.codec),
              let header = track.isExternal ? engine.sidecarASSHeader : track.assHeader,
              let styled, rect.width > 0, let layer = surface.layer else { return false }
        if styledTrack != track.id {
            styledTrack = track.id
            print("[vela-captions] libass track=\(track.id) codec=\(track.codec) header=\(header.count) fonts=\(engine.fontAttachments.count)")
        }
        if styledCaption.superlayer !== layer {
            styledCaption.zPosition = 2
            layer.addSublayer(styledCaption)
        }
        // Rendered at the picture's pixel size, at most 1920 wide: libass's cost grows with the area.
        let scale = min(surface.window?.backingScaleFactor ?? 2, 1920 / rect.width)
        let pixels = CGSize(width: rect.width * scale, height: rect.height * scale)
        guard let (image, box) = styled.render(key: "\(track.id)|\(track.isExternal)", header: header, fonts: engine.fontAttachments,
                                                cues: cues, time: time, pixels: pixels, storage: coded) else {
            styledCaption.isHidden = true
            return true
        }
        styledCaption.contents = image
        // libass places from the picture's top; the surface's layer may count from its bottom.
        let top = surface.isFlipped ? rect.minY + box.minY / scale : rect.maxY - box.maxY / scale
        styledCaption.frame = CGRect(x: rect.minX + box.minX / scale, y: top, width: box.width / scale, height: box.height / scale)
        styledCaption.isHidden = false
        return true
    }
    func freezePicture(frame: CGImage?, aspectFill: Bool) {}
    func clearFrozenPicture() {}
    func removeSurface() {
        subscriptions.removeAll()
        images.values.forEach { $0.removeFromSuperlayer() }; images.removeAll()
        styledCaption.removeFromSuperlayer(); styledTrack = nil
        surface?.removeFromSuperview(); surface = nil; engine = nil
    }
}
