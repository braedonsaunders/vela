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
      PlayerCapabilities.capabilities(appContext.reactContext)
    }

    Function("decoderCapabilities") {
      PlayerCapabilities.decoderDetails()
    }

    // Internal diagnostics for device profiling; no player/chrome API or media data changes.
    Function("setCPUProfiling") { enabled: Boolean ->
      val profiler = Class.forName("com.facebook.hermes.instrumentation.HermesSamplingProfiler")
      if (enabled) {
        profiler.getMethod("enable").invoke(null)
        null
      } else {
        val context = appContext.reactContext ?: throw IllegalStateException("Player context unavailable")
        val file = java.io.File(context.externalCacheDir ?: context.cacheDir, "vela-cpu-profile.json")
        profiler.getMethod("dumpSampledTraceToFile", String::class.java).invoke(null, file.path)
        profiler.getMethod("disable").invoke(null)
        file.path
      }
    }

    // The viewer left the app: playing views pause, previews stop with their windows.
    OnActivityEntersBackground {
      VelaPlayerView.live.forEach { it.enterBackground() }
    }

    OnActivityEntersForeground {
      VelaPlayerView.live.forEach { it.enterForeground() }
    }

    // Home while a full-screen video plays: Android before 12 has no auto-enter, so the player opens the window.
    OnUserLeavesActivity {
      PictureInPicture.userLeaving(appContext.currentActivity)
    }

    // Whether the activity shows the player in picture-in-picture now: the app is paused yet still on screen,
    // so its watch session goes on (read as the app leaves the foreground).
    Function("pictureInPicture") {
      PictureInPicture.active(appContext.currentActivity)
    }

    View(VelaPlayerView::class) {
      Events("onSnapshot", "onError", "onObservation", "onCommand", "onSessionCommand", "onSessionRefresh", "onPictureInPicture")

      Prop("ambient") { view: VelaPlayerView, ambient: Boolean? ->
        view.setAmbient(ambient ?: false)
      }
      Prop("tile") { view: VelaPlayerView, tile: Int? ->
        view.setTile(tile)
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

      OnViewDidUpdateProps { view: VelaPlayerView -> view.applyProps() }

      OnViewDestroys { view: VelaPlayerView ->
        view.release()
      }
    }
  }
}
