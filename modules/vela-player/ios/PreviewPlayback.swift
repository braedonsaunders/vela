// A short muted trailer preview from a preview grant (packages/player-api PreviewSource): no audio
// session, no display matching, no observations or session commands, a small cache. It plays while
// it is wanted (active, on screen, unexpired) and releases mpv at once when any of those ends. It fills
// its box, cropped, as the web preview does (object-fit: cover).
import Foundation
import Libmpv
import QuartzCore

@MainActor
final class PreviewPlayback {
    struct Source: Equatable {
        let url: String
        let expiresAt: Date
        let loop: Bool
        let startSeconds: Double

        init?(_ map: [String: Any]?) {
            guard let map, let url = map["url"] as? String, !url.isEmpty,
                  let expiry = map["expiresAt"] as? String, let expiresAt = PreviewPlayback.date(expiry) else {
                return nil
            }
            self.url = url
            self.expiresAt = expiresAt
            loop = map["loop"] as? Bool ?? false
            let offset = map["startSeconds"] as? Double ?? 0
            startSeconds = offset.isFinite ? max(0, offset) : 0
        }
    }

    /// The preview's state for its snapshots: loading, playing, ended or failed.
    var onState: ((String) -> Void)?
    var onFailure: ((String) -> Void)?

    private let layer: CAMetalLayer
    private var mpv: PlaybackClient?
    private var playing: Source?
    private var expiry: Timer?
    private var paused = false
    private var frameWatch: Timer?
    private var lastFrame = Date.distantPast
    private var offsetApplied = false
    private var startPosition = 0.0

    init(layer: CAMetalLayer) {
        self.layer = layer
    }

    /// Plays `source` when it is wanted, else releases the decoder.
    func update(_ source: Source?, wanted: Bool) {
        guard let source, wanted, source.expiresAt > Date() else {
            stop()
            return
        }
        guard source != playing else {
            return
        }
        stop()
        start(source)
    }

    func setPaused(_ value: Bool) {
        paused = value
        mpv?.set("pause", flag: value)
    }

    func stop() {
        layer.isHidden = true
        frameWatch?.invalidate()
        frameWatch = nil
        expiry?.invalidate()
        expiry = nil
        playing = nil
        guard let client = mpv else {
            return
        }
        mpv = nil
        client.destroy()
    }

    private func start(_ source: Source) {
        guard let url = resolve(source.url) else {
            onFailure?("The preview's address is not usable")
            onState?("failed")
            return
        }
        let client: PlaybackClient
        do {
            client = try PlaybackClient(layer: layer, options: [
                "mute": "yes",
                "keep-open": "no",
                "audio": "no",
                "sid": "no",
                "pause": paused ? "yes" : "no",
                "loop-file": source.loop ? "inf" : "no",
                // Aspect fill (CSS object-fit: cover): a preview fills its box edge to edge, cropped.
                "panscan": "1.0",
                "demuxer-max-bytes": "16MiB",
                "demuxer-max-back-bytes": "4MiB",
                "demuxer-readahead-secs": "5",
            ])
        } catch {
            onFailure?("\(error)")
            onState?("failed")
            return
        }
        mpv = client
        playing = source
        lastFrame = .distantPast
        startPosition = source.startSeconds
        offsetApplied = source.startSeconds == 0
        client.observe("duration", format: MPV_FORMAT_DOUBLE)
        client.observe("paused-for-cache", format: MPV_FORMAT_FLAG)
        frameWatch = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            if Date().timeIntervalSince(self.lastFrame) > 1.5 { self.onState?("loading") }
        }
        client.observe("pause", format: MPV_FORMAT_FLAG)
        client.observe("video-pts", format: MPV_FORMAT_DOUBLE)
        client.onProperty = { [weak self] name, value in
            guard let self else { return }
            if name == "duration", let duration = value as? Double, duration > 0, !self.offsetApplied {
                self.offsetApplied = true
                self.startPosition = min(source.startSeconds, duration / 4)
                self.mpv?.command(["seek", String(self.startPosition), "absolute+exact"])
            }
            if name == "paused-for-cache", let waiting = value as? Bool, waiting { self.onState?("loading") }
            if name == "video-pts", let pts = value as? Double, self.offsetApplied,
               pts >= self.startPosition {
                self.lastFrame = Date()
                self.layer.isHidden = self.mpv?.usesAether != false
                self.onState?("playing")
            }
        }
        client.onEvent = { [weak self] event in
            self?.event(event)
        }
        onState?("loading")
        // A grant past its expiry is not played on: the host asks for a new one.
        let remaining = source.expiresAt.timeIntervalSinceNow
        expiry = Timer.scheduledTimer(withTimeInterval: remaining, repeats: false) { [weak self] _ in
            self?.stop()
            self?.onState?("ended")
        }
        Task { @MainActor [weak self] in
            let media = await MediaRedirects.resolve(url)
            guard let self, self.mpv === client else {
                return
            }
            client.setStringList("http-header-fields", media.headers.map { "\($0.key): \($0.value)" })
            client.set("stream-lavf-o", media.refusesRedirects ? "max_redirects=0" : "")
            client.command(["loadfile", media.url.absoluteString, "replace"])
        }
    }

    private func event(_ event: PlaybackClient.Event) {
        switch event {
        case .seekDone:
            break
        case .endFile(let reason, _):
            // MPV_END_FILE_REASON_ERROR (4); EOF (0) when it does not loop.
            if reason == 4 {
                stop()
                onFailure?("The preview could not be played")
                onState?("failed")
            } else if reason == 0 {
                onState?("ended")
            }
        case .refused:
            onFailure?("The preview's grant was refused")
            onState?("failed")
            stop()
        default:
            break
        }
    }

    private func resolve(_ text: String) -> URL? {
        if let url = URL(string: text), url.scheme != nil {
            return url
        }
        guard let origin = VelaMediaAccessStore.origin else {
            return nil
        }
        return URL(string: text, relativeTo: URL(string: origin))?.absoluteURL
    }

    nonisolated private static func date(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}
