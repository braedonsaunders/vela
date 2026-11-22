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
    private let retainPausedPicture: Bool
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
    func drawCaptions(engine: AetherEngine) {
        guard let surface else { return }
        let time = engine.clock.sourceTime
        let cues = engine.subtitleCues.filter { $0.startTime <= time && time < $0.endTime }
        let imageIDs = Set(cues.compactMap { cue -> Int? in
            if case .image = cue.body { return cue.id }; return nil
        })
        for id in Array(bitmapCaptions.keys) where !imageIDs.contains(id) {
            bitmapCaptions.removeValue(forKey: id)?.removeFromSuperview()
        }
        let coded = CGSize(width: Int(engine.sourceVideoWidth), height: Int(engine.sourceVideoHeight))
        let display = engine.softwareDisplaySize ?? coded
        let rect = engine.nativePlayerLayer?.videoRect ?? AVMakeRect(aspectRatio: display, insideRect: surface.bounds)
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
        let text = cues.compactMap { cue -> String? in
            switch cue.body {
            case .text(let text): return text
            case .richText(let runs): return runs.map(\.text).joined()
            case .image: return nil
            }
        }.joined(separator: "\n")
        captions.text = text
        captions.frame = CGRect(x: 40, y: surface.bounds.height * 0.7, width: max(0, surface.bounds.width - 80), height: surface.bounds.height * 0.25)
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
        surface?.removeFromSuperview()
        surface = nil
    }
}
