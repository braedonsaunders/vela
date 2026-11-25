package app.ether.vela.player

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VelaVisualizerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VelaVisualizer")
    Events("onAvailabilityChange")
    OnStartObserving {
      AudioPlayback.onVisualizerAvailability = { sendEvent("onAvailabilityChange", emptyMap<String, Any?>()) }
    }
    OnStopObserving { AudioPlayback.onVisualizerAvailability = null }
    OnDestroy { AudioPlayback.onVisualizerAvailability = null }
    Function("canVisualize") {
      AudioPlayback.visualizerPcm && appContext.reactContext?.let { VisualizerNative.supported(it) } == true
    }
    Function("canOpenVisualizer") { VisualizerNative.canOpen }
    View(VelaVisualizerView::class) {
      Events("onUnavailable")
      Prop("sceneId") { view: VelaVisualizerView, sceneId: String? -> view.sceneId = sceneId.orEmpty() }
      Prop("active") { view: VelaVisualizerView, active: Boolean? -> view.active = active == true }
      Prop("still") { view: VelaVisualizerView, still: Boolean? -> view.still = still == true }
      Prop("mode") { view: VelaVisualizerView, mode: String? -> view.fullscreen = mode == "fullscreen" }
      Prop("artworkTint") { view: VelaVisualizerView, color: String? -> view.artworkTint = color.orEmpty() }
      Prop("accent") { view: VelaVisualizerView, color: String? -> view.accent = color.orEmpty() }
      OnViewDidUpdateProps { view: VelaVisualizerView -> view.refresh() }
    }
  }
}
