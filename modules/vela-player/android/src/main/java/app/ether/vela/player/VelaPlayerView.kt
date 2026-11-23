// VelaPlayerView on Android and Android TV: Media3 drawing into a SurfaceView or preview TextureView, driven by the
// contract's props: a plan through PlayerController, or a trailer preview through PreviewPlayback.
// Chrome is drawn by JavaScript above it.
package app.ether.vela.player

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
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
  private val onPictureInPicture by EventDispatcher<Map<String, Any?>>()

  /** The picture: the video letterboxed with its subtitle layers. It leaves the view for the activity's window
   * while picture-in-picture shows it alone. */
  private val content = object : FrameLayout(context) {
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
      super.onLayout(changed, left, top, right, bottom)
      placeVideo(right - left, bottom - top)
    }
  }
  private val video = SurfaceView(context)
  private val subtitleLayer = androidx.media3.ui.SubtitleView(context)
  private val assLayer = AssOverlay(context)
  private val previewVideo = TextureView(context)
  private val previewPaint = Paint()
  private var previewAlpha = -1
  private var videoSurface: Surface? = null
  private var previewMode = false
  private var videoRatio = 0f
  private var videoWidth = 0
  private var videoHeight = 0
  /** Picture-in-picture: whether this view's video plays (null: it has none to show), and the window's stage. */
  private var pipPlaying: Boolean? = null
  private var pipShape = 0 to 0
  private var pipStage: FrameLayout? = null
  private var pendingAmbient = false
  private var pendingTile: Int? = null
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
    content.addView(assLayer, videoLayout())
    assLayer.source = { bitmap, force -> controller.renderAss(bitmap, force) }
    report.subtitleLook = SubtitleLook.from { lookStore.getString(it, null) }
    subtitleLook(report.subtitleLook, persist = false)
    addView(content, videoLayout())
    live.add(this)
  }

  private fun videoLayout() = LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

  private fun updatePreviewVisibility() {
    val alpha = if (previewHasPts && previewHasFrame) 255 else 0
    if (previewAlpha == alpha) return
    previewAlpha = alpha
    previewPaint.alpha = alpha
    previewVideo.setLayerPaint(previewPaint)
  }

  private fun usePreview(enabled: Boolean) {
    if (previewMode == enabled) return
    if (enabled) assLayer.stop() else if (isAttachedToWindow) assLayer.start()
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

  fun setTile(value: Int?) {
    pendingTile = value
  }

  /** What the system's media session shows for this player (full watch only). */
  fun setMetadata(value: Map<String, Any?>?) = controller.setMetadata(value)

  fun setPlan(plan: Map<String, Any?>?) {
    pendingPlan = plan

  }

  fun setPreview(value: Map<String, Any?>?) {
    pendingPreview = value
    previewDirty = true
  }

  fun applyProps() {
    controller.ambient = pendingAmbient
    controller.tile = pendingTile
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
    // The activity pauses as it enters picture-in-picture: the window goes on playing.
    if (!PictureInPicture.showing(this, appContext.currentActivity)) controller.enterBackground()
  }

  fun enterForeground() = preview.setOnScreen(windowVisibility == View.VISIBLE && isAttachedToWindow)

  fun release() {
    live.remove(this)
    leavePictureInPicture()
    PictureInPicture.release(this, appContext.currentActivity)
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
    if (!previewMode) assLayer.start()
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
    videoWidth = width
    videoHeight = height
    val ratio = width.toFloat() / height
    if (videoRatio != ratio) { videoRatio = ratio; content.requestLayout(); requestLayout() }
  }

  /** Letterboxes the video, and the subtitle layers over it, in the picture's `width`×`height`. */
  private fun placeVideo(width: Int, height: Int) {
    if (!previewMode && videoRatio > 0 && width > 0 && height > 0) {
      val videoWidth = minOf(width, (height * videoRatio).toInt())
      val videoHeight = minOf(height, (width / videoRatio).toInt())
      val x = (width - videoWidth) / 2
      val y = (height - videoHeight) / 2
      video.layout(x, y, x + videoWidth, y + videoHeight)
      subtitleLayer.measure(MeasureSpec.makeMeasureSpec(videoWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(videoHeight, MeasureSpec.EXACTLY))
      subtitleLayer.layout(x, y, x + videoWidth, y + videoHeight)
      assLayer.measure(MeasureSpec.makeMeasureSpec(videoWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(videoHeight, MeasureSpec.EXACTLY))
      assLayer.layout(x, y, x + videoWidth, y + videoHeight)
    } else {
      subtitleLayer.layout(0, 0, width, height)
      assLayer.layout(0, 0, width, height)
    }
  }

  // Picture-in-picture (PictureInPicture)

  override val pictureInPictureSupported: Boolean
    get() = !previewMode && PictureInPicture.supported(appContext.currentActivity)

  override fun pictureInPicture(playing: Boolean?) {
    val activity = appContext.currentActivity
    if (playing == null) {
      if (pipPlaying != null) { pipPlaying = null; PictureInPicture.release(this, activity) }
      return
    }
    if (pipPlaying == null) PictureInPicture.claim(this, activity)
    val shape = videoWidth to videoHeight
    if (pipPlaying == playing && pipShape == shape) return
    pipPlaying = playing
    pipShape = shape
    PictureInPicture.update(this, activity, playing, videoWidth, videoHeight, videoRect())
  }

  override fun enterPictureInPicture(): String? =
    PictureInPicture.enter(this, appContext.currentActivity, videoWidth, videoHeight, videoRect())

  /** The window's play/pause action. */
  fun pictureInPictureControl(control: String) = controller.pictureInPictureControl(control)

  /** The activity entered or left picture-in-picture; `closed` when the viewer dismissed the window. */
  fun pictureInPictureChanged(active: Boolean, closed: Boolean) {
    if (active) showAlone() else leavePictureInPicture()
    // A dismissed window stops the watch as leaving the app does.
    if (closed) controller.enterBackground()
    onPictureInPicture(mapOf("active" to active, "closed" to closed))
  }

  /** The video's rectangle in the window, where the picture-in-picture window grows from. */
  private fun videoRect(): Rect? = Rect().takeIf { video.isAttachedToWindow && video.getGlobalVisibleRect(it) }

  /** The picture moves above the app (the player's chrome and everything else) for the window. */
  private fun showAlone() {
    if (pipStage != null || previewMode) return
    val decor = appContext.currentActivity?.window?.decorView as? ViewGroup ?: return
    val stage = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
    removeView(content)
    stage.addView(content, videoLayout())
    decor.addView(stage, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    pipStage = stage
    assLayer.start()
  }

  private fun leavePictureInPicture() {
    val stage = pipStage ?: return
    pipStage = null
    stage.removeView(content)
    (stage.parent as? ViewGroup)?.removeView(stage)
    addView(content, videoLayout())
    if (isAttachedToWindow) assLayer.start()
    requestLayout()
  }

  override fun subtitles(cues: androidx.media3.common.text.CueGroup) {
    subtitleLayer.setCues(cues.cues)
  }

  override fun preferDisplay(facts: VideoFacts?) =
    DisplayMatching.prefer(facts, surface, appContext.currentActivity)

  override fun describeDisplay() = DisplayMatching.describe(appContext.currentActivity)

  override fun displayOutput(frameRate: Double?) = DisplayMatching.output(appContext.currentActivity, frameRate)

  private val lookStore get() = context.getSharedPreferences("vela.player", Context.MODE_PRIVATE)

  override fun subtitleLook(look: SubtitleLook, persist: Boolean) {
    val text = if (look.color == "yellow") Color.rgb(255, 214, 10) else Color.WHITE
    val box = if (look.background == "box") Color.argb(184, 0, 0, 0) else Color.TRANSPARENT
    val edge = if (look.background == "shadow") androidx.media3.ui.CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW else androidx.media3.ui.CaptionStyleCompat.EDGE_TYPE_NONE
    subtitleLayer.setStyle(androidx.media3.ui.CaptionStyleCompat(text, box, Color.TRANSPARENT, edge, Color.BLACK, null))
    // The viewer's size wins over a track's own font sizes; its colours, italics and placement stay.
    subtitleLayer.setApplyEmbeddedFontSizes(false)
    subtitleLayer.setFractionalTextSize(look.textFraction)
    subtitleLayer.setBottomPaddingFraction(look.bottomFraction)
    if (persist) lookStore.edit().apply { look.stored.forEach { (key, value) -> putString(key, value) } }.apply()
  }

  override fun keepScreenOn(on: Boolean) {
    video.keepScreenOn = on
  }

  companion object {
    /** The views alive now, so the module can pause them when the app goes to the background. */
    val live = mutableSetOf<VelaPlayerView>()
  }
}
