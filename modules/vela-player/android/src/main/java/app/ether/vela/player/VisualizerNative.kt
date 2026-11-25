package app.ether.vela.player

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.os.Handler
import android.os.Looper
import android.util.Log

internal object VisualizerNative {
  private val available by lazy {
    try { System.loadLibrary("vela_visualizer"); true } catch (_: LinkageError) { false }
  }

  @Volatile private var deviceSupported: Boolean? = null
  @Volatile private var rendererFailed = false
  private var probing = false

  fun supported(context: Context): Boolean {
    if (rendererFailed) return false
    deviceSupported?.let { return it }
    synchronized(this) {
      if (!probing && deviceSupported == null) {
        probing = true
        val app = context.applicationContext
        Thread({
          deviceSupported = try { probeDevice(app) } catch (failure: Exception) {
            Log.w("VelaVisualizer", "GLES capability probe failed", failure)
            false
          } catch (_: LinkageError) { false }
          Handler(Looper.getMainLooper()).post { AudioPlayback.onVisualizerAvailability?.invoke() }
        }, "VelaVisualizerProbe").start()
      }
    }
    return false
  }

  fun markRendererFailed() {
    rendererFailed = true
    AudioPlayback.onVisualizerAvailability?.invoke()
  }

  private fun probeDevice(context: Context): Boolean {
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val tv = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    val memory = ActivityManager.MemoryInfo().also { manager.getMemoryInfo(it) }
    if (manager.isLowRamDevice || (tv && memory.totalMem <= 2304L * 1024 * 1024)) {
      Log.i("VelaVisualizer", "hardwareRenderer=false memoryMiB=${memory.totalMem / (1024 * 1024)} tv=$tv")
      return false
    }
    return manager.deviceConfigurationInfo.reqGlEsVersion >= 0x30000 && available &&
      context.assets.list("vela-visualizer")?.contains("viz-native.js") == true && VisualizerEgl.hardwareRenderer()
  }

  external fun create(assets: AssetManager, width: Int, height: Int, id: String, artwork: String, accent: String): Long
  external fun tint(handle: Long, artwork: String, accent: String): Boolean
  external fun resize(handle: Long, width: Int, height: Int): Boolean
  external fun frame(handle: Long, pcm: FloatArray): Boolean
  external fun destroy(handle: Long, glValid: Boolean)
}
