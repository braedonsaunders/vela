// VelaPlayerView on Android and Android TV: Media3 drawing into a SurfaceView or preview TextureView, driven by the
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
import android.widget.FrameLayout
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

  private val content = FrameLayout(context)
  private val video = SurfaceView(context)
  private val subtitleLayer = androidx.media3.ui.SubtitleView(context)
  private val previewVideo = TextureView(context)
  private val previewPaint = Paint()
  private var videoSurface: Surface? = null
  private var previewMode = false
  private var videoRatio = 0f
  private var pendingAmbient = false
  private var pendingCommand: Map<String, Any?>? = null
  private var pendingPreview: Map<String, Any?>? = null
  private var previewDirty = false
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
    content.addView(video, videoLayout())
    content.addView(subtitleLayer, videoLayout())
    addView(content, videoLayout())
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
      content.removeView(video)
      previewMode = true
      setBackgroundColor(Color.TRANSPARENT)
      content.addView(previewVideo, 0, videoLayout())
    } else {
      preview.release()
      content.removeView(previewVideo)
      previewMode = false
      setBackgroundColor(Color.BLACK)
      content.addView(video, 0, videoLayout())
    }
  }

  // Props (VelaPlayerModule)

  fun setAmbient(value: Boolean) {
    pendingAmbient = value
  }

  fun setPlan(plan: Map<String, Any?>?) {
    pendingPlan = plan

  }

  fun setPreview(value: Map<String, Any?>?) {
    pendingPreview = value
    previewDirty = true
  }

  fun applyProps() {
    controller.ambient = pendingAmbient
    if (previewDirty) {
      previewDirty = false
      if (pendingPreview != null) {
        usePreview(true)
        preview.setPreview(pendingPreview)
      } else if (previewMode) usePreview(false)
    }
    if (!previewMode) controller.setPlan(pendingPlan)
    pendingCommand?.let { performCommand(it) }
    pendingCommand = null
  }

  fun setActive(value: Boolean) = preview.setActive(value)

  fun setServerError(failure: Map<String, Any?>?) = controller.setServerError(failure)

  fun setCommand(command: Map<String, Any?>?) { pendingCommand = command }

  private fun performCommand(command: Map<String, Any?>?) {
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

  fun enterBackground() {
    preview.setOnScreen(false)
    controller.enterBackground()
  }

  fun enterForeground() = preview.setOnScreen(windowVisibility == View.VISIBLE && isAttachedToWindow)

  fun release() {
    live.remove(this)
    preview.release()
    controller.release()
    content.removeView(if (previewMode) previewVideo else video)
  }

  // A preview plays only while its view is on screen.

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    preview.setOnScreen(visibility == View.VISIBLE && isAttachedToWindow)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    applyProps()
    preview.setOnScreen(windowVisibility == View.VISIBLE)
  }

  override fun onDetachedFromWindow() {
    preview.setOnScreen(false)
    preview.release()
    controller.releaseForPreview()
    previewDirty = pendingPreview != null
    super.onDetachedFromWindow()
  }

  // PlayerHost

  override val surface
    get() = if (previewMode) {
      videoSurface?.takeIf { it.isValid }
    } else {
      video.holder.surface?.takeIf { it.isValid }
    }

  override fun videoSize(width: Int, height: Int) {
    val ratio = width.toFloat() / height
    if (videoRatio != ratio) { videoRatio = ratio; requestLayout() }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    if (!previewMode && videoRatio > 0 && width > 0 && height > 0) {
      val videoWidth = minOf(width, (height * videoRatio).toInt())
      val videoHeight = minOf(height, (width / videoRatio).toInt())
      val x = (width - videoWidth) / 2
      val y = (height - videoHeight) / 2
      video.layout(x, y, x + videoWidth, y + videoHeight)
    }
    subtitleLayer.layout(0, 0, width, height)
  }

  override fun subtitles(cues: androidx.media3.common.text.CueGroup) {
    subtitleLayer.setCues(cues.cues)
  }

  override fun preferDisplay(facts: VideoFacts?) =
    DisplayMatching.prefer(facts, surface, appContext.currentActivity)

  override fun describeDisplay() = DisplayMatching.describe(appContext.currentActivity)

  override fun keepScreenOn(on: Boolean) {
    video.keepScreenOn = on
  }

  companion object {
    /** The views alive now, so the module can pause them when the app goes to the background. */
    val live = mutableSetOf<VelaPlayerView>()
  }
}
