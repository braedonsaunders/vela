package app.ether.vela.player

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.atomic.AtomicLong

internal object VisualizerNative {
  private val available by lazy {
    try { System.loadLibrary("vela_visualizer"); true } catch (_: LinkageError) { false }
  }

  @Volatile private var deviceSupported: Boolean? = null
  @Volatile private var rendererFailed = false
  private var probing = false
  @Volatile private var preparedViews = 0
  private val fullscreenAction = AtomicLong(0)
  val canOpen get() = !rendererFailed && preparedViews > 0 && AudioPlayback.visualizerPcm

  fun beginFullscreen() { fullscreenAction.set(SystemClock.uptimeMillis()) }
  fun takeFullscreenAction() = fullscreenAction.getAndSet(0)

  /** Main thread. Withdraw entry when its prepared backdrop leaves the hierarchy. */
  fun prepared(ready: Boolean) {
    val before = preparedViews
    preparedViews += if (ready) 1 else -1
    if ((before == 0) != (preparedViews == 0)) AudioPlayback.onVisualizerAvailability?.invoke()
  }
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
      context.assets.list("vela-visualizer")?.contains("viz-native.js") == true && VisualizerEgl.eligibleRenderer(tv)
  }

  external fun create(assets: AssetManager, width: Int, height: Int, id: String, artwork: String, accent: String): Long
  external fun tint(handle: Long, artwork: String, accent: String): Boolean
  external fun resize(handle: Long, width: Int, height: Int): Boolean
  external fun frame(handle: Long, pcm: FloatArray): Boolean
  external fun destroy(handle: Long, glValid: Boolean)
}
