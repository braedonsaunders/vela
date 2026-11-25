package app.ether.vela.player

import android.content.res.AssetManager
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLExt
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import android.view.Surface

/** EGL, Hermes, the recorder and the FFT all live on this view's worker, separate from React and Media3. */
internal class VisualizerRenderer(private val texture: SurfaceTexture, private val assets: AssetManager) {
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
  @Volatile var firstScene = ""
    private set
  private var currentId = ""
  private var loggedDecks = 0
  private var currentArtwork = ""
  private var currentAccent = ""
  private var width = 0
  private var height = 0
  private val pcm = FloatArray(VisualizerAudio.WINDOW)
  @Volatile private var generation = 0

  private fun configure(w: Int, h: Int) {
    if (context == EGL14.EGL_NO_CONTEXT) {
      display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
      check(display != EGL14.EGL_NO_DISPLAY && EGL14.eglInitialize(display, null, 0, null, 0))
      val configs = arrayOfNulls<EGLConfig>(1)
      val count = IntArray(1)
      val attrs = intArrayOf(EGL14.EGL_RENDERABLE_TYPE, 0x40, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
        EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_NONE)
      check(EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, count, 0) && count[0] > 0)
      config = configs[0]
      context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT,
        intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0)
      check(context != EGL14.EGL_NO_CONTEXT)
    }
    if (w == width && h == height && target != EGL14.EGL_NO_SURFACE) return
    if (target != EGL14.EGL_NO_SURFACE) {
      EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
      EGL14.eglDestroySurface(display, target)
      target = EGL14.EGL_NO_SURFACE
    }
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

  fun draw(w: Int, h: Int, id: String, artwork: String, accent: String, decks: List<VisualizerDeck>, done: (Boolean) -> Unit) {
    val ticket = generation
    gl.post {
      if (ticket != generation) return@post
      val success = try {
        if (handle != 0L && currentId != id) release()
        configure(w, h)
        val first = handle == 0L
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
        check(VisualizerNative.frame(handle, pcm))
        if (first) {
          val stamp = System.nanoTime()
          firstPresentationNs = if (EGLExt.eglPresentationTimeANDROID(display, target, stamp)) stamp else 0L
          firstScene = id
        }
        check(EGL14.eglSwapBuffers(display, target))
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

  fun suspendRendering() {
    firstScene = ""
    generation++
    gl.post { release() }
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
