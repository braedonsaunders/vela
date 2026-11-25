package app.ether.vela.player

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.AssetManager

internal object VisualizerNative {
  private val available by lazy {
    try { System.loadLibrary("vela_visualizer"); true } catch (_: LinkageError) { false }
  }

  @Volatile private var deviceSupported: Boolean? = null
  @Volatile private var rendererFailed = false

  fun supported(context: Context): Boolean {
    if (rendererFailed) return false
    return deviceSupported ?: synchronized(this) {
      deviceSupported ?: probeDevice(context).also { deviceSupported = it }
    }
  }

  fun markRendererFailed() {
    rendererFailed = true
    AudioPlayback.onVisualizerAvailability?.invoke()
  }

  private fun probeDevice(context: Context): Boolean {
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val tv = context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    val memory = ActivityManager.MemoryInfo().also { manager.getMemoryInfo(it) }
    if (manager.isLowRamDevice || (tv && memory.totalMem <= 2304L * 1024 * 1024)) return false
    return manager.deviceConfigurationInfo.reqGlEsVersion >= 0x30000 && available &&
      context.assets.list("vela-visualizer")?.contains("viz-native.js") == true
  }

  external fun create(assets: AssetManager, width: Int, height: Int, id: String, artwork: String, accent: String): Long
  external fun tint(handle: Long, artwork: String, accent: String): Boolean
  external fun resize(handle: Long, width: Int, height: Int): Boolean
  external fun frame(handle: Long, pcm: FloatArray): Boolean
  external fun destroy(handle: Long, glValid: Boolean)
}
