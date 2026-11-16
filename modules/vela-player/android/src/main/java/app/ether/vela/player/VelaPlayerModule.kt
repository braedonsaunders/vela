// The Expo module: VelaPlayer.setMediaAccess, VelaPlayer.capabilities and the VelaPlayerView view
// (packages/player-api).
package app.ether.vela.player

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VelaPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VelaPlayer")

    // The trusted playback controller's media access; null clears it.
    Function("setMediaAccess") { access: Map<String, Any?>? ->
      MediaAccessStore.current = access?.let(MediaAccess::from)
    }

    // What this device plays, for the client's negotiation request (probed once per process).
    Function("capabilities") {
      PlayerCapabilities.probed
    }

    // The viewer left the app: playing views pause, previews stop with their windows.
    OnActivityEntersBackground {
      VelaPlayerView.live.forEach { it.enterBackground() }
    }

    View(VelaPlayerView::class) {
      Events("onSnapshot", "onError", "onObservation", "onCommand", "onSessionCommand", "onSessionRefresh")

      Prop("ambient") { view: VelaPlayerView, ambient: Boolean? ->
        view.setAmbient(ambient ?: false)
      }
      Prop("plan") { view: VelaPlayerView, plan: Map<String, Any?>? ->
        view.setPlan(plan)
      }
      Prop("preview") { view: VelaPlayerView, preview: Map<String, Any?>? ->
        view.setPreview(preview)
      }
      Prop("active") { view: VelaPlayerView, active: Boolean? ->
        view.setActive(active ?: true)
      }
      Prop("command") { view: VelaPlayerView, command: Map<String, Any?>? ->
        view.setCommand(command)
      }
      Prop("serverError") { view: VelaPlayerView, failure: Map<String, Any?>? ->
        view.setServerError(failure)
      }

      OnViewDestroys { view: VelaPlayerView ->
        view.release()
      }
    }
  }
}
