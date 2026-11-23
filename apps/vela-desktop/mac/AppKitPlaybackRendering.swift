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
        let rect = engine.nativePlayerLayer?.videoRect ?? AVMakeRect(aspectRatio: display, insideRect: surface.bounds)
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
        captions.frame = CGRect(x: 40, y: surface.bounds.height * 0.05, width: max(0, surface.bounds.width - 80), height: surface.bounds.height * 0.25)
    }
    func freezePicture(frame: CGImage?, aspectFill: Bool) {}
    func clearFrozenPicture() {}
    func removeSurface() {
        subscriptions.removeAll()
        images.values.forEach { $0.removeFromSuperlayer() }; images.removeAll()
        surface?.removeFromSuperview(); surface = nil; engine = nil
    }
}
