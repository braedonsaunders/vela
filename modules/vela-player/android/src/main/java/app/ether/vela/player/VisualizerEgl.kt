package app.ether.vela.player

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLDisplay
import android.opengl.GLES30
import android.util.Log

internal object VisualizerEgl {
  fun config(display: EGLDisplay, surfaceType: Int): EGLConfig {
    val configs = arrayOfNulls<EGLConfig>(1)
    val count = IntArray(1)
    val attrs = intArrayOf(EGL14.EGL_RENDERABLE_TYPE, 0x40, EGL14.EGL_SURFACE_TYPE, surfaceType,
      EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_NONE)
    check(EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, count, 0) && count[0] > 0)
    return checkNotNull(configs[0])
  }

  fun createContext(display: EGLDisplay, config: EGLConfig?) =
    EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT,
      intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0)

  /** Probe one pixel once per process. A virtual device can use either real hardware or a CPU renderer. */
  fun eligibleRenderer(tv: Boolean): Boolean {
    val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    if (display == EGL14.EGL_NO_DISPLAY || !EGL14.eglInitialize(display, null, 0, null, 0)) return false
    var target = EGL14.EGL_NO_SURFACE
    var context = EGL14.EGL_NO_CONTEXT
    try {
      val cfg = config(display, EGL14.EGL_PBUFFER_BIT)
      context = createContext(display, cfg)
      if (context == EGL14.EGL_NO_CONTEXT) return false
      target = EGL14.eglCreatePbufferSurface(display, cfg,
        intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
      if (target == EGL14.EGL_NO_SURFACE || !EGL14.eglMakeCurrent(display, target, target, context)) return false
      val name = GLES30.glGetString(GLES30.GL_RENDERER).orEmpty()
      val hardware = !VisualizerTier.software(name)
      val eligible = hardware && !VisualizerTier.slowTvTranslation(name, tv)
      Log.i("VelaVisualizer", "hardwareRenderer=$hardware visualizerEligible=$eligible tv=$tv renderer=$name")
      return eligible
    } finally {
      EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
      if (target != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, target)
      if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
      EGL14.eglReleaseThread()
      EGL14.eglTerminate(display)
    }
  }
}
