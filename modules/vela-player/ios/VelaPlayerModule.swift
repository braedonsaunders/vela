// The Expo module: VelaPlayer.setMediaAccess and the VelaPlayerView view (packages/player-api).
import ExpoModulesCore

public final class VelaPlayerModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VelaPlayer")

        // The trusted playback controller's media access; null clears it.
        Function("setMediaAccess") { (access: [String: Any]?) in
            guard let access else {
                VelaMediaAccessStore.set(nil)
                return
            }
            VelaMediaAccessStore.set(try VelaMediaAuth(access))
        }

        View(VelaPlayerView.self) {
            Events("onSnapshot", "onError", "onObservation", "onCommand", "onSessionCommand", "onSessionRefresh")

            Prop("ambient") { (view: VelaPlayerView, ambient: Bool?) in
                view.setAmbient(ambient ?? false)
            }
            Prop("plan") { (view: VelaPlayerView, plan: [String: Any]?) in
                view.setPlan(plan)
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
