// A short muted trailer preview from a preview grant (packages/player-api PreviewSource): no audio
// session, no display matching, no observations or session commands, a small cache. It plays while
// it is wanted (active, on screen, unexpired) and releases player at once when any of those ends. It fills
// its box, cropped, as the web preview does (object-fit: cover).
import Foundation

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

    private weak var host: PlaybackHost?
    private var player: PlaybackClient?
    private var playing: Source?
    private var expiry: Timer?
    private var paused = false
    private var frameWatch: Timer?
    private var lastFrame = Date.distantPast
    private var offsetApplied = false
    private var startPosition = 0.0

    init(host: PlaybackHost) {
        self.host = host
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

    func layout() { player?.layout() }

    func setPaused(_ value: Bool) {
        paused = value
        player?.set("pause", flag: value)
    }

    func stop() {
        frameWatch?.invalidate()
        frameWatch = nil
        expiry?.invalidate()
        expiry = nil
        playing = nil
        guard let client = player else {
            return
        }
        player = nil
        client.destroy()
    }

    private func start(_ source: Source) {
        guard let url = resolve(source.url) else {
            onFailure?("The preview's address is not usable")
            onState?("failed")
            return
        }
        guard let host else { return }
        let client = PlaybackClient(rendering: host.makeRendering(retainPausedPicture: false), preview: true, paused: paused, muted: true,
                                    loops: source.loop, aspectFill: true)
        player = client
        playing = source
        lastFrame = .distantPast
        startPosition = source.startSeconds
        offsetApplied = source.startSeconds == 0
        frameWatch = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            if Date().timeIntervalSince(self.lastFrame) > 1.5 { self.onState?("loading") }
        }
        client.onProperty = { [weak self] name, value in
            guard let self else { return }
            if name == "duration", let duration = value as? Double, duration > 0, !self.offsetApplied {
                self.offsetApplied = true
                self.startPosition = min(source.startSeconds, duration / 4)
                self.player?.command(["seek", String(self.startPosition), "absolute+exact"])
            }
            if name == "paused-for-cache", let waiting = value as? Bool, waiting { self.onState?("loading") }
            if name == "video-pts", let pts = value as? Double, self.offsetApplied,
               pts >= self.startPosition {
                self.lastFrame = Date()
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
            guard let self, self.player === client else {
                return
            }
            client.setStringList("http-header-fields", media.headers.map { "\($0.key): \($0.value)" })
            client.command(["loadfile", media.url.absoluteString, "replace"])
        }
    }

    private func event(_ event: PlaybackClient.Event) {
        switch event {
        case .seekDone:
            break
        case .endFile(let reason, _):
            // Failure (4); EOF (0) when it does not loop.
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
