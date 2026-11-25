package app.ether.vela.player

import android.content.res.AssetManager
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLExt
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Surface

/** EGL, Hermes, the recorder and the FFT all live on this view's worker, separate from React and Media3. */
internal class VisualizerRenderer private constructor(private var texture: SurfaceTexture, private val assets: AssetManager) {
  companion object {
    private var warm: VisualizerRenderer? = null // Main thread only.

    fun acquire(texture: SurfaceTexture, assets: AssetManager): VisualizerRenderer {
      val old = warm ?: return VisualizerRenderer(texture, assets)
      warm = null
      old.retarget(texture)
      return old
    }
  }
  private val worker = HandlerThread("VelaVisualizer").apply { start() }
  private val gl = Handler(worker.looper)
  private val main = Handler(Looper.getMainLooper())
  private var display = EGL14.EGL_NO_DISPLAY
  private var context = EGL14.EGL_NO_CONTEXT
  private var target = EGL14.EGL_NO_SURFACE
  private var config: EGLConfig? = null
  private var handle = 0L
  @Volatile var firstPresentationNs = 0L
    private set
  @Volatile var presentedTicket = -1L
    private set
  private var currentId = ""
  private var loggedDecks = 0
  private var currentArtwork = ""
  private var currentAccent = ""
  private var width = 0
  private var height = 0
  private val pcm = FloatArray(VisualizerAudio.WINDOW)
  @Volatile private var generation = 0
  @Volatile private var parked = false

  /** React can reparent a TextureView when the picker joins the hierarchy. Keep the existing
   * GPU context and scene for the explicit background-to-fullscreen transition only. */
  fun offerForFullscreen() {
    warm?.close()
    warm = this
    main.postDelayed({
      if (warm === this) { warm = null; close() }
    }, 400)
  }

  private fun retarget(next: SurfaceTexture) {
    generation++
    gl.post {
      if (texture !== next) {
        detachTarget()
        texture.release()
        texture = next
      }
      presentedTicket = -1L
    }
  }

  private fun detachTarget() {
    if (target == EGL14.EGL_NO_SURFACE) return
    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
    EGL14.eglDestroySurface(display, target)
    target = EGL14.EGL_NO_SURFACE
  }

  private fun configure(w: Int, h: Int) {
    if (context == EGL14.EGL_NO_CONTEXT) {
      display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
      check(display != EGL14.EGL_NO_DISPLAY && EGL14.eglInitialize(display, null, 0, null, 0))
      config = VisualizerEgl.config(display, EGL14.EGL_WINDOW_BIT)
      context = VisualizerEgl.createContext(display, config)
      check(context != EGL14.EGL_NO_CONTEXT)
    }
    if (w == width && h == height && target != EGL14.EGL_NO_SURFACE) return
    detachTarget()
    texture.setDefaultBufferSize(w, h)
    val surface = Surface(texture)
    try {
      target = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
    } finally { surface.release() }
    check(target != EGL14.EGL_NO_SURFACE && EGL14.eglMakeCurrent(display, target, target, context))
    width = w
    height = h
    if (handle != 0L) check(VisualizerNative.resize(handle, w, h))
  }

  fun draw(w: Int, h: Int, id: String, artwork: String, accent: String, presentationTicket: Long, decks: List<VisualizerDeck>, done: (Boolean) -> Unit) {
    parked = false
    val ticket = generation
    gl.post {
      if (ticket != generation) return@post
      val success = try {
        if (handle != 0L && currentId != id) release()
        val first = handle == 0L
        val start = if (first) SystemClock.uptimeMillis() else 0L
        configure(w, h)
        val eglReady = if (first) SystemClock.uptimeMillis() else 0L
        if (first) {
          handle = VisualizerNative.create(assets, w, h, id, artwork, accent)
          check(handle != 0L)
          currentId = id
          loggedDecks = 0
          currentArtwork = artwork
          currentAccent = accent
        }
        if (artwork != currentArtwork || accent != currentAccent) {
          check(VisualizerNative.tint(handle, artwork, accent))
          currentArtwork = artwork
          currentAccent = accent
        }
        pcm.fill(0f)
        for (deck in decks) deck.mix(pcm)
        // Log each newly observed output configuration once for the native performance probe.
        if (decks.size > loggedDecks && pcm.any { it > 0.001f || it < -0.001f }) {
          loggedDecks = decks.size
          Log.i("VelaVisualizer", "heardPcm scene=$id decks=$loggedDecks rate=${VisualizerAudio.RATE}")
        }
        val drawStart = if (first) SystemClock.uptimeMillis() else 0L
        check(VisualizerNative.frame(handle, pcm))
        val submittedAt = if (first) SystemClock.uptimeMillis() else 0L
        if (first || presentedTicket != presentationTicket) {
          val stamp = System.nanoTime()
          firstPresentationNs = if (EGLExt.eglPresentationTimeANDROID(display, target, stamp)) stamp else 0L
          presentedTicket = presentationTicket
        }
        check(EGL14.eglSwapBuffers(display, target))
        if (first) Log.i("VelaVisualizer", "firstSwap scene=$id eglMs=${eglReady-start} engineAndPcmMs=${drawStart-eglReady} drawMs=${submittedAt-drawStart} swapMs=${SystemClock.uptimeMillis()-submittedAt}")
        true
      } catch (failure: RuntimeException) {
        Log.w("VelaVisualizer", "Surface unavailable", failure)
        release()
        false
      }
      main.post { if (ticket == generation) done(success) }
    }
  }

  private fun release() {
    if (handle != 0L) {
      VisualizerNative.destroy(handle, context != EGL14.EGL_NO_CONTEXT && EGL14.eglGetCurrentContext() == context)
      handle = 0
    }
    if (display != EGL14.EGL_NO_DISPLAY) {
      EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
      if (target != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, target)
      if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
      EGL14.eglReleaseThread()
      EGL14.eglTerminate(display)
    }
    display = EGL14.EGL_NO_DISPLAY
    target = EGL14.EGL_NO_SURFACE
    context = EGL14.EGL_NO_CONTEXT
    width = 0
    height = 0
  }

  fun suspendRendering(transition: Boolean) {
    presentedTicket = -1L
    parked = true
    val ticket = ++generation
    if (transition) {
      gl.postDelayed({ if (parked && ticket == generation) release() }, 400)
    } else gl.post { release() }
  }

  fun close() {
    generation++
    gl.post {
      release()
      texture.release()
      worker.quitSafely()
    }
  }
}
