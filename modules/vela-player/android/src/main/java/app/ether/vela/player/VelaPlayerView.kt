// VelaPlayerView on Android and Android TV: libmpv drawing into a SurfaceView, driven by the
// contract's props: a plan through PlayerController, or a trailer preview through PreviewPlayback.
// Chrome is drawn by JavaScript above it.
package app.ether.vela.player

import android.content.Context
import android.graphics.Color
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

internal class VelaPlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext), PlayerHost {
  private val onSnapshot by EventDispatcher<Map<String, Any?>>()
  private val onError by EventDispatcher<Map<String, Any?>>()
  private val onObservation by EventDispatcher<Map<String, Any?>>()
  private val onCommand by EventDispatcher<Map<String, Any?>>()

  private val video = SurfaceView(context)
  private val report = PlayerReport(
    emitSnapshot = { onSnapshot(it) },
    emitObservation = { onObservation(it) },
    emitError = { onError(it) },
  )
  private val controller = PlayerController(context, this, report)
  private val preview = PreviewPlayback(context, this, report)

  // The SurfaceView fills the view by Android layout; React Native sizes this view.
  override val shouldUseAndroidLayout = true

  init {
    setBackgroundColor(Color.BLACK)
    video.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        controller.surfaceCreated(holder.surface)
        preview.surfaceCreated()
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        controller.surfaceChanged(width, height)
        preview.surfaceChanged(width, height)
      }

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        controller.surfaceDestroyed()
        preview.surfaceDestroyed()
      }
    })
    addView(video, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    live.add(this)
  }

  // Props (VelaPlayerModule)

  fun setAmbient(value: Boolean) {
    controller.ambient = value
  }

  fun setPlan(plan: Map<String, Any?>?) = controller.setPlan(plan)

  fun setPreview(value: Map<String, Any?>?) {
    if (value != null) {
      // A preview excludes a plan.
      controller.release()
    }
    preview.setPreview(value)
  }

  fun setActive(value: Boolean) = preview.setActive(value)

  fun setServerError(failure: Map<String, Any?>?) = controller.setServerError(failure)

  fun setCommand(command: Map<String, Any?>?) {
    if (!preview.isSet) {
      controller.setCommand(command)?.let { onCommand(it) }
      return
    }
    val id = command?.int("id") ?: return
    val failure = preview.command(command.text("type") ?: "")
    val result = mutableMapOf<String, Any?>("id" to id, "ok" to (failure == null))
    failure?.let { result["failure"] = mapOf("kind" to "action", "message" to it, "recoverable" to true) }
    onCommand(result)
  }

  fun enterBackground() = controller.enterBackground()

  fun release() {
    live.remove(this)
    preview.release()
    controller.release()
  }

  // A preview plays only while its view is on screen.

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    preview.setOnScreen(visibility == View.VISIBLE && isAttachedToWindow)
  }

  override fun onDetachedFromWindow() {
    preview.setOnScreen(false)
    super.onDetachedFromWindow()
  }

  // PlayerHost

  override val surface
    get() = video.holder.surface?.takeIf { it.isValid }

  override fun preferDisplay(facts: VideoFacts?) =
    DisplayMatching.prefer(facts, surface, appContext.currentActivity)

  override fun displaySwitching() = DisplayMatching.switching(appContext.currentActivity)

  override fun describeDisplay() = DisplayMatching.describe(appContext.currentActivity)

  override fun keepScreenOn(on: Boolean) {
    video.keepScreenOn = on
  }

  companion object {
    /** The views alive now, so the module can pause them when the app goes to the background. */
    val live = mutableSetOf<VelaPlayerView>()
  }
}
