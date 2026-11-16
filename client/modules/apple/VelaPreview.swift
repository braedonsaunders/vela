// vela-preview on tvOS: a card's muted, looping trailer from a broker grant
// (client/player/preview.ts), played by AVPlayer. Messages: ready, playing, paused, refused.
import AVFoundation
import UIKit

final class VelaPreviewView: ExactNativeInstance {
    private let surface = VelaPreviewSurface()
    private let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?
    private var playing: NSKeyValueObservation?
    private var url = ""

    init(_ props: [String: String], _ events: ExactNativeEvents) {
        super.init(events: events)
        player.isMuted = true
        surface.playerLayer.player = player
        surface.alpha = 0
        playing = player.observe(\.timeControlStatus) { [weak self] player, _ in
            guard player.timeControlStatus == .playing else {
                return
            }
            DispatchQueue.main.async {
                self?.surface.alpha = 1
                self?.events.message("playing")
            }
        }
        try? setProps(props)
    }

    override var view: ExactNativeView {
        surface
    }

    override func setProps(_ props: [String: String]) throws {
        let expiresAt = Double(props["expiresAt"] ?? "") ?? 0
        let unexpired = expiresAt > Date().timeIntervalSince1970 * 1000
        let wanted = props["active"] == "true" && props["still"] != "true" && unexpired
        guard wanted, let text = props["url"], !text.isEmpty else {
            stopPreview()
            return
        }
        guard text != url else {
            return
        }
        url = text
        guard let resolved = resolve(text) else {
            events.message("refused")
            return
        }
        let authorization = try? VelaMediaAuth(json: props["mediaAuth"] ?? "")
        let headers = authorization?.headers(for: resolved) ?? [:]
        let options = headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers]
        let item = AVPlayerItem(asset: AVURLAsset(url: resolved, options: options))
        looper = AVPlayerLooper(player: player, templateItem: item)
        player.play()
        events.message("ready")
    }

    private func resolve(_ text: String) -> URL? {
        if let url = URL(string: text), url.scheme != nil {
            return url
        }
        return URL(string: text, relativeTo: URL(string: VelaServer.origin))?.absoluteURL
    }

    private func stopPreview() {
        guard !url.isEmpty else {
            return
        }
        url = ""
        looper = nil
        player.pause()
        player.removeAllItems()
        surface.alpha = 0
        events.message("paused")
    }

    override func destroy() {
        playing = nil
        looper = nil
        player.pause()
        player.removeAllItems()
    }
}

final class VelaPreviewSurface: UIView {
    let playerLayer = AVPlayerLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        playerLayer.videoGravity = .resizeAspectFill
        layer.addSublayer(playerLayer)
    }

    required init?(coder: NSCoder) {
        fatalError("VelaPreviewSurface is made in code")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }
}
