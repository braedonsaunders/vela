// The Expo module: VelaPlayer.setMediaAccess and the VelaPlayerView view (packages/player-api).
import ExpoModulesCore
import Foundation
import UIKit

// Opt-in UI timing for device benchmarks. No display link exists in normal builds.
private final class UIFrameTiming: NSObject {
    static let shared = UIFrameTiming()
    private var link: CADisplayLink?
    private var previous: CFTimeInterval = 0
    private var intervals: [Double] = []
    private var missed = 0

    func sample(_ enabled: Bool) -> [String: Any] {
        if !enabled {
            link?.invalidate()
            link = nil
            previous = 0
        } else if link == nil {
            let next = CADisplayLink(target: self, selector: #selector(tick(_:)))
            next.add(to: .main, forMode: .common)
            link = next
        }
        let sorted = intervals.sorted()
        let result: [String: Any] = ["frames": sorted.count,
            "p95": sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.95))],
            "max": sorted.last ?? 0, "missed": missed]
        intervals.removeAll(keepingCapacity: true)
        missed = 0
        return result
    }

    @objc private func tick(_ sender: CADisplayLink) {
        if previous > 0, intervals.count < 12000 {
            let elapsed = sender.timestamp - previous
            intervals.append(elapsed * 1000)
            let expected = max(0.001, sender.targetTimestamp - sender.timestamp)
            missed += max(0, Int((elapsed / expected).rounded()) - 1)
        }
        previous = sender.timestamp
    }
}

public final class VelaPlayerModule: Module {
    /// The audio player, reporting to this module's JavaScript.
    @MainActor
    private func audio() -> AudioPlayback {
        let audio = AudioPlayback.shared
        audio.emit = { [weak self] body in self?.sendEvent("onAudio", body) }
        return audio
    }

    public func definition() -> ModuleDefinition {
        Name("VelaPlayer")

        AsyncFunction("sampleUIFrames") { (enabled: Bool) -> [String: Any] in
            let result = UIFrameTiming.shared.sample(enabled)
            if enabled, let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) { print("[vela-guide-ui] \(json)") }
            return result
        }.runOnQueue(.main)

        OnCreate {
            TVTextFields.install()
            // Segments a killed session left in tmp (AetherEngine holds a lock on every live one).
            let swept = PlaybackCacheBudget.removeStaleSessions()
            if swept > 0 { print("[vela-aether-cache] launch swept=\(swept)") }
        }

        // The app takes the remote's play/pause for itself (an alert toast's action) until released.
        // onAudio: the audio player's status and the system's media commands (AudioPlayback).
        Events("onClaimedPlayPause", "onAudio")
        AsyncFunction("claimPlayPause") { [weak self] (claimed: Bool) in
            MainActor.assumeIsolated {
                SystemMediaControls.shared.playPauseClaim = claimed ? { self?.sendEvent("onClaimedPlayPause", [:]) } : nil
            }
        }.runOnQueue(.main)

        // Music, audiobooks and podcasts: one AVPlayer for the app (modules/vela-player/src/audio.ts).
        AsyncFunction("audioLoad") { [weak self] (request: [String: Any]) in
            MainActor.assumeIsolated {
                let audio = self?.audio() ?? AudioPlayback.shared
                let id = (request["id"] as? NSNumber)?.intValue ?? 0
                let access = (request["access"] as? [String: Any]).flatMap { try? VelaMediaAuth($0) }
                guard let text = request["url"] as? String, let url = URL(string: text), url.scheme == "http" || url.scheme == "https" else {
                    audio.emit?(["id": id, "type": "status", "state": "failed", "position": 0, "duration": 0, "error": "This item has no playable audio"])
                    return
                }
                audio.load(id: id, url: url, access: access, start: (request["start"] as? NSNumber)?.doubleValue ?? 0,
                           rate: (request["rate"] as? NSNumber)?.doubleValue ?? 1)
            }
        }.runOnQueue(.main)
        AsyncFunction("audioPreload") { [weak self] (request: [String: Any]?) in
            MainActor.assumeIsolated {
                let audio = self?.audio() ?? AudioPlayback.shared
                let url = (request?["url"] as? String).flatMap(URL.init(string:)).flatMap { $0.scheme == "http" || $0.scheme == "https" ? $0 : nil }
                // AutoMix: `crossfade = { seconds, at }` (docs/sound.md); without it the join is gapless.
                let fade = (request?["crossfade"] as? [String: Any]).flatMap { fade -> (seconds: Double, at: Double)? in
                    guard let seconds = (fade["seconds"] as? NSNumber)?.doubleValue, let at = (fade["at"] as? NSNumber)?.doubleValue,
                          seconds.isFinite, at.isFinite else { return nil }
                    return (seconds, at)
                }
                audio.preload(id: (request?["id"] as? NSNumber)?.intValue, url: url,
                              access: (request?["access"] as? [String: Any]).flatMap { try? VelaMediaAuth($0) },
                              start: (request?["start"] as? NSNumber)?.doubleValue ?? 0,
                              gain: (request?["gain"] as? NSNumber)?.doubleValue ?? 1, crossfade: fade)
            }
        }.runOnQueue(.main)
        // Levelling and the EQ: the playing item's gain (linear) and the EQ for every item (null: none).
        AsyncFunction("audioSound") { [weak self] (sound: [String: Any]) in
            MainActor.assumeIsolated {
                let audio = self?.audio() ?? AudioPlayback.shared
                let eq = (sound["eq"] as? [String: Any]).map { eq in
                    SoundEQ(preGainDb: (eq["preGainDb"] as? NSNumber)?.doubleValue ?? 0,
                            filters: (eq["filters"] as? [[String: Any]] ?? []).compactMap { filter -> SoundFilter? in
                                let kinds: [String: SoundFilter.Kind] = ["lowshelf": .lowshelf, "peaking": .peaking, "highshelf": .highshelf]
                                guard let kind = (filter["type"] as? String).flatMap({ kinds[$0] }),
                                      let frequency = (filter["frequency"] as? NSNumber)?.doubleValue else { return nil }
                                return SoundFilter(kind: kind, frequency: frequency, q: (filter["q"] as? NSNumber)?.doubleValue ?? 2.0.squareRoot(),
                                                   gainDb: (filter["gainDb"] as? NSNumber)?.doubleValue ?? 0)
                            })
                }
                audio.setSound(gain: (sound["gain"] as? NSNumber)?.doubleValue ?? 1, eq: eq)
            }
        }.runOnQueue(.main)
        // Debug builds: capture every tap's processed output to `path` (.f32 + .json) and silence the
        // output for the rest of the process; null writes the capture. Release builds ignore it.
        AsyncFunction("audioCapture") { [weak self] (path: String?) in
            MainActor.assumeIsolated { (self?.audio() ?? AudioPlayback.shared).capture(path: path) }
        }.runOnQueue(.main)
        AsyncFunction("audioPlay") { [weak self] in
            MainActor.assumeIsolated { (self?.audio() ?? AudioPlayback.shared).play() }
        }.runOnQueue(.main)
        AsyncFunction("audioPause") { [weak self] in
            MainActor.assumeIsolated { (self?.audio() ?? AudioPlayback.shared).pause() }
        }.runOnQueue(.main)
        AsyncFunction("audioSeek") { [weak self] (seconds: Double) in
            MainActor.assumeIsolated { (self?.audio() ?? AudioPlayback.shared).seek(seconds) }
        }.runOnQueue(.main)
        AsyncFunction("audioSetRate") { [weak self] (rate: Double) in
            MainActor.assumeIsolated { (self?.audio() ?? AudioPlayback.shared).setRate(rate) }
        }.runOnQueue(.main)
        AsyncFunction("audioUnload") { [weak self] in
            MainActor.assumeIsolated { (self?.audio() ?? AudioPlayback.shared).unload() }
        }.runOnQueue(.main)
        AsyncFunction("audioNowPlaying") { [weak self] (info: [String: Any]?) in
            MainActor.assumeIsolated {
                let audio = self?.audio() ?? AudioPlayback.shared
                guard let info else {
                    audio.setNowPlaying(nil)
                    return
                }
                let artwork = (info["artwork"] as? String).flatMap { $0.isEmpty ? nil : URL(string: $0) }
                audio.setNowPlaying(.init(title: info["title"] as? String ?? "", artist: info["artist"] as? String ?? "",
                                          album: info["album"] as? String ?? "", artwork: artwork, spoken: info["spoken"] as? Bool ?? false))
            }
        }.runOnQueue(.main)

        // What this device plays (VideoToolbox's hardware decoders, AetherEngine's audio and subtitles).
        Function("capabilities") { () -> [String: Any] in
            PlayerCapabilities.probe()
        }

        // The trusted playback controller's media access; null clears it.
        Function("setMediaAccess") { (access: [String: Any]?) in
            guard let access else {
                VelaMediaAccessStore.set(nil)
                return
            }
            VelaMediaAccessStore.set(try VelaMediaAuth(access), generation: (access["generation"] as? NSNumber)?.intValue ?? 0)
        }

        Function("attachPlaybackURL") { (plan: String, source: String, authorized: String, generation: Int) -> Bool in
            guard let source = URL(string: source), let authorized = URL(string: authorized) else { return false }
            return VelaMediaAccessStore.attach(plan: plan, source: source, authorized: authorized, generation: generation)
        }
        Function("detachPlaybackURL") { (plan: String, generation: Int) in
            VelaMediaAccessStore.detach(plan: plan, generation: generation)
        }

        View(VelaPlayerView.self) {
            Events("onMediaAuthorization", "onSnapshot", "onError", "onObservation", "onCommand", "onSessionCommand", "onSessionRefresh")

            OnViewDidUpdateProps { (view: VelaPlayerView) in view.commitProps() }

            Prop("ambient") { (view: VelaPlayerView, ambient: Bool?) in
                view.setAmbient(ambient ?? false)
            }
            Prop("tile") { (view: VelaPlayerView, tile: Int?) in
                view.setTile(tile)
            }
            Prop("metadata") { (view: VelaPlayerView, metadata: [String: Any]?) in
                view.setMetadata(metadata)
            }
            Prop("preview") { (view: VelaPlayerView, preview: [String: Any]?) in
                view.setPreview(preview)
            }
            Prop("active") { (view: VelaPlayerView, active: Bool?) in
                view.setActive(active)
            }
            Prop("plan") { (view: VelaPlayerView, plan: [String: Any]?) in
                view.setPlan(plan)
            }
            Prop("mediaAuthorization") { (view: VelaPlayerView, result: [String: Any]?) in
                view.setMediaAuthorization(result)
            }
            Prop("command") { (view: VelaPlayerView, command: [String: Any]?) in
                view.setCommand(command)
            }
            Prop("serverError") { (view: VelaPlayerView, failure: [String: Any]?) in
                view.setServerError(failure)
            }
        }
    }
}
