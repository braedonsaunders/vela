// VelaPlayerView on Android and Android TV: libmpv drawing into a TextureView, driven by the
// contract's props: a plan through PlayerController, or a trailer preview through PreviewPlayback.
// Chrome is drawn by JavaScript above it.
package app.ether.vela.player

import android.content.Context
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
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
  private val onSessionCommand by EventDispatcher<Map<String, Any?>>()
  private val onSessionRefresh by EventDispatcher<Map<String, Any?>>()

  private val video = TextureView(context)
  private var videoSurface: Surface? = null
  private val report = PlayerReport(
    emitSnapshot = { onSnapshot(it) },
    emitObservation = { onObservation(it) },
    emitError = { onError(it) },
    emitSessionCommand = { onSessionCommand(it) },
    emitSessionRefresh = { onSessionRefresh(it) },
  )
  private val controller = PlayerController(context, this, report)
  private val preview = PreviewPlayback(context, this, report) { visible ->
    video.alpha = if (visible) 1f else 0f
  }

  // The TextureView fills the view by Android layout; React Native sizes this view.
  override val shouldUseAndroidLayout = true

  init {
    setBackgroundColor(Color.TRANSPARENT)
    video.isOpaque = false
    video.alpha = 0f
    video.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
        videoSurface = Surface(texture)
        controller.surfaceCreated(videoSurface!!)
        preview.surfaceCreated()
        controller.surfaceChanged(width, height)
        preview.surfaceChanged(width, height)
      }

      override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
        controller.surfaceChanged(width, height)
        preview.surfaceChanged(width, height)
      }

      override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
        controller.surfaceDestroyed()
        preview.surfaceDestroyed()
        videoSurface?.release()
        videoSurface = null
        return true
      }

      override fun onSurfaceTextureUpdated(texture: SurfaceTexture) = Unit
    }
    addView(video, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    live.add(this)
  }

  // Props (VelaPlayerModule)

  fun setAmbient(value: Boolean) {
    controller.ambient = value
  }

  fun setPlan(plan: Map<String, Any?>?) {
    if (plan != null && !preview.isSet) {
      setBackgroundColor(Color.BLACK)
      video.alpha = 1f
    }
    controller.setPlan(plan)
  }

  fun setPreview(value: Map<String, Any?>?) {
    if (value != null) {
      // A preview excludes a plan.
      controller.release()
      setBackgroundColor(Color.TRANSPARENT)
    }
    if (value != null || preview.isSet) {
      preview.setPreview(value)
    }
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
    get() = videoSurface?.takeIf { it.isValid }

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
