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
        Events("onClaimedPlayPause")
        AsyncFunction("claimPlayPause") { [weak self] (claimed: Bool) in
            MainActor.assumeIsolated {
                SystemMediaControls.shared.playPauseClaim = claimed ? { self?.sendEvent("onClaimedPlayPause", [:]) } : nil
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
