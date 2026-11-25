package app.ether.vela.player

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import android.graphics.SurfaceTexture
import android.os.SystemClock
import android.view.Choreographer
import android.view.TextureView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.findViewTreeLifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt
import kotlin.math.sqrt

internal class VelaVisualizerView(context: Context, appContext: AppContext) : ExpoView(context, appContext),
    TextureView.SurfaceTextureListener {
  override val shouldUseAndroidLayout = true
  private val onUnavailable by EventDispatcher<Map<String, Any?>>()
  var sceneId = ""
  var artworkTint = ""
  var accent = ""
  var active = false
  var still = false
  var fullscreen = false
  private val texture = TextureView(context)
  private val lowRam = (context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).isLowRamDevice
  private val tv = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
  private var pixels = 1.0
  private var floorMisses = 0
  private var windowFrames = 0
  private var windowStart = 0L
  private var opened = 0L
  private var openingScene = ""
  private var measuredScene = ""
  private var renderer: VisualizerRenderer? = null
  private var lifecycle: Lifecycle? = null
  private var onscreen = false
  private var observing = false
  private var submitted = false
  private var scheduled = false
  private var dirty = true
  private var failed = false
  private var started = false
  private val displayTick = Choreographer.FrameCallback { scheduled = false; drawFrame() }
  private val stateChanged: () -> Unit = { schedule() }
  private val lifecycleChanged = LifecycleEventObserver { _, _ -> schedule() }

  init {
    texture.surfaceTextureListener = this
    texture.isFocusable = false
    addView(texture, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    lifecycle = findViewTreeLifecycleOwner()?.lifecycle
    lifecycle?.addObserver(lifecycleChanged)
    AudioPlayback.visualizerListeners.add(stateChanged)
    schedule()
  }

  override fun onDetachedFromWindow() {
    AudioPlayback.visualizerListeners.remove(stateChanged)
    lifecycle?.removeObserver(lifecycleChanged)
    lifecycle = null
    park()
    super.onDetachedFromWindow()
  }

  override fun onVisibilityAggregated(isVisible: Boolean) {
    super.onVisibilityAggregated(isVisible)
    onscreen = isVisible
    schedule()
  }

  fun refresh() {
    if (active && sceneId.isNotEmpty() && openingScene != sceneId) {
      openingScene = sceneId
      opened = SystemClock.uptimeMillis()
    } else if (!active) {
      openingScene = ""
      opened = 0
    }
    dirty = true
    schedule()
  }

  private fun visible() = isAttachedToWindow && onscreen && active && sceneId.isNotEmpty() &&
    lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) != false && texture.isAvailable &&
    width > 1 && height > 1 && !failed

  private fun observe(wanted: Boolean) {
    if (observing == wanted) return
    observing = wanted
    resetTiming()
    AudioPlayback.observeVisualizer(wanted)
  }

  private fun park() {
    if (scheduled) Choreographer.getInstance().removeFrameCallback(displayTick)
    scheduled = false
    observe(false)
    if (started) {
      renderer?.suspendRendering()
      openingScene = ""
      opened = 0
    }
    started = false
    submitted = false
    dirty = true
  }

  private fun schedule() {
    if (!visible()) { park(); return }
    observe(!still && AudioPlayback.visualizerPlaying)
    if ((!observing && !dirty) || scheduled || submitted) return
    if (openingScene != sceneId) {
      openingScene = sceneId
      opened = SystemClock.uptimeMillis()
    }
    scheduled = true
    Choreographer.getInstance().postFrameCallback(displayTick)
  }

  private fun resetTiming() {
    windowFrames = 0
    windowStart = 0
    floorMisses = 0
  }

  /** Measure delivered moving frames, including GPU swap and scheduling. Ignore setup and scene changes. */
  private fun withinBudget(now: Long, period: Long): Boolean {
    if (windowStart == 0L) { windowStart = now; return true }
    if (++windowFrames < 50) return true
    val average = (now - windowStart).toDouble() / windowFrames
    windowStart = now
    windowFrames = 0
    if (average <= period * 1.5) { floorMisses = 0; return true }
    if (pixels > 0.30) {
      pixels = maxOf(0.30, pixels * 0.65)
      return true
    }
    return ++floorMisses < 2
  }

  private fun unavailable() {
    failed = true
    VisualizerNative.markRendererFailed()
    park()
    onUnavailable(emptyMap())
  }

  private fun drawFrame() {
    if (!visible()) { park(); return }
    if (!VisualizerNative.supported(context)) { unavailable(); return }
    val surface = texture.surfaceTexture ?: return
    val host = renderer ?: VisualizerRenderer(surface, context.assets).also { renderer = it }
    started = true
    if (measuredScene != sceneId) {
      measuredScene = sceneId
      resetTiming()
      pixels = 1.0
    }
    val budget = (if (lowRam) 360_000 else if (fullscreen) 921_600 else 600_000) * pixels
    val scale = minOf(1.0, sqrt(budget / (width.toDouble() * height)))
    val w = maxOf(2, (width * scale).roundToInt())
    val h = maxOf(2, (height * scale).roundToInt())
    val at = SystemClock.uptimeMillis()
    submitted = true
    dirty = false
    host.draw(w, h, sceneId, artworkTint, accent, if (observing) AudioPlayback.visualizerDecks() else emptyList()) { success ->
      submitted = false
      if (!success) {
        unavailable()
      } else {
        val now = SystemClock.uptimeMillis()
        val period = if (lowRam || tv || !fullscreen) 33L else 16L
        if (observing && visible()) {
          if (!withinBudget(now, period)) unavailable()
          else {
            scheduled = true
            Choreographer.getInstance().postFrameCallbackDelayed(displayTick, maxOf(0, period - (now - at) - 5))
          }
        } else schedule()
      }
    }
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) = refresh()
  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = refresh()
  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
    val host = renderer ?: return
    if (opened > 0 && host.firstScene == openingScene && surface.timestamp >= host.firstPresentationNs) {
      Log.i("VelaVisualizer", "firstFrame scene=$openingScene elapsedMs=${SystemClock.uptimeMillis() - opened}")
      opened = -1
    }
  }
  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
    park()
    val host = renderer ?: return true
    renderer = null
    host.close()
    return false // The GL worker releases the texture after its pending frame.
  }
}
