// The Expo module: VelaPlayer.setMediaAccess and the VelaPlayerView view (packages/player-api).
import ExpoModulesCore
import Foundation

public final class VelaPlayerModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VelaPlayer")

        OnCreate {
            TVTextFields.install()
        }

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
            VelaMediaAccessStore.set(try VelaMediaAuth(access), generation: access["generation"] as? Int ?? 0)
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

            Prop("ambient") { (view: VelaPlayerView, ambient: Bool?) in
                view.setAmbient(ambient ?? false)
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
