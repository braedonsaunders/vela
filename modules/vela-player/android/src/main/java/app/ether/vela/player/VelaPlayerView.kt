// VelaPlayerView on Android and Android TV: libmpv drawing into a SurfaceView or preview TextureView, driven by the
// contract's props: a plan through PlayerController, or a trailer preview through PreviewPlayback.
// Chrome is drawn by JavaScript above it.
package app.ether.vela.player

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
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

  private val video = SurfaceView(context)
  private val previewVideo = TextureView(context)
  private val previewPaint = Paint()
  private var videoSurface: Surface? = null
  private var previewMode = false
  private var pendingPlan: Map<String, Any?>? = null
  private var previewHasPts = false
  private var previewHasFrame = false
  private val report = PlayerReport(
    emitSnapshot = { onSnapshot(it) },
    emitObservation = { onObservation(it) },
    emitError = { onError(it) },
    emitSessionCommand = { onSessionCommand(it) },
    emitSessionRefresh = { onSessionRefresh(it) },
  )
  private val controller = PlayerController(context, this, report)
  private val preview = PreviewPlayback(context, this, report) { visible ->
    previewHasPts = visible
    if (!visible) {
      previewHasFrame = false
    }
    updatePreviewVisibility()
  }

  override val shouldUseAndroidLayout = true

  init {
    setBackgroundColor(Color.BLACK)
    video.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        controller.surfaceCreated(holder.surface)
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        controller.surfaceChanged(width, height)
      }

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        controller.surfaceDestroyed()
      }
    })
    previewVideo.isOpaque = false
    updatePreviewVisibility()
    previewVideo.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
        videoSurface = Surface(texture)
        preview.surfaceCreated()
        preview.surfaceChanged(width, height)
      }

      override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
        preview.surfaceChanged(width, height)
      }

      override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
        preview.surfaceDestroyed()
        previewHasFrame = false
        updatePreviewVisibility()
        videoSurface?.release()
        videoSurface = null
        return true
      }

      override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {
        if (previewHasPts) {
          previewHasFrame = true
          updatePreviewVisibility()
        }
      }
    }
    addView(video, videoLayout())
    live.add(this)
  }

  private fun videoLayout() = LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

  private fun updatePreviewVisibility() {
    previewPaint.alpha = if (previewHasPts && previewHasFrame) 255 else 0
    previewVideo.setLayerPaint(previewPaint)
  }

  private fun usePreview(enabled: Boolean) {
    if (previewMode == enabled) return
    if (enabled) {
      controller.releaseForPreview()
      removeView(video)
      previewMode = true
      setBackgroundColor(Color.TRANSPARENT)
      addView(previewVideo, videoLayout())
    } else {
      preview.release()
      removeView(previewVideo)
      previewMode = false
      setBackgroundColor(Color.BLACK)
      addView(video, videoLayout())
    }
  }

  // Props (VelaPlayerModule)

  fun setAmbient(value: Boolean) {
    controller.ambient = value
  }

  fun setPlan(plan: Map<String, Any?>?) {
    pendingPlan = plan
    if (!previewMode) {
      controller.setPlan(plan)
    }
  }

  fun setPreview(value: Map<String, Any?>?) {
    if (value != null) {
      usePreview(true)
      preview.setPreview(value)
    } else if (previewMode) {
      usePreview(false)
      controller.setPlan(pendingPlan)
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
    removeView(if (previewMode) previewVideo else video)
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
    get() = if (previewMode) {
      videoSurface?.takeIf { it.isValid }
    } else {
      video.holder.surface?.takeIf { it.isValid }
    }

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
