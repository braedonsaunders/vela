// The spike: a muted ExoPlayer feeding the PCM tap, and a GLSurfaceView whose GL thread hosts the visualizer.
//   adb shell am start -n app.vela.vizspike/.MainActivity --es scene ink|tunnel [--ez gpuFinish true] [--es media <path>]
// D-pad left/right switches scenes. Logcat tag VizSpike carries one STAT line a second.
@file:OptIn(UnstableApi::class)

package app.vela.vizspike

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

private const val TAG = "VizSpike"

class MainActivity : Activity() {
  private lateinit var view: GLSurfaceView
  private lateinit var renderer: VizRenderer
  private var player: ExoPlayer? = null
  @Volatile private var sink: HeardSink? = null
  private val underruns = AtomicInteger()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val scene = intent.getStringExtra("scene") ?: "ink"
    val gpuFinish = intent.getBooleanExtra("gpuFinish", false)
    val media = intent.getStringExtra("media") ?: File(getExternalFilesDir(null), "track.mp3").path
    val bundle = assets.open("viz-native.js").use { it.readBytes() }
    renderer = VizRenderer(bundle, scene, gpuFinish, { sink?.heardNowUs() ?: -1L }, { underruns.get() })
    view = GLSurfaceView(this).apply {
      setEGLContextClientVersion(3)
      setEGLConfigChooser(8, 8, 8, 8, 0, 0)
      preserveEGLContextOnPause = true
      setRenderer(renderer)
      renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
    }
    setContentView(view)
    Log.i(TAG, "scene=$scene gpuFinish=$gpuFinish media=$media")
    startPlayer(media)
  }

  private fun startPlayer(path: String) {
    val tap = VizTap()
    val renderers = object : DefaultRenderersFactory(this) {
      override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink =
        HeardSink(DefaultAudioSink.Builder(context)
          .setEnableFloatOutput(enableFloatOutput)
          .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
          .setAudioProcessors(arrayOf(tap))
          .build()).also { sink = it }
    }
    val p = ExoPlayer.Builder(this, renderers).build()
    p.addAnalyticsListener(object : AnalyticsListener {
      override fun onAudioUnderrun(eventTime: AnalyticsListener.EventTime, bufferSize: Int, bufferSizeMs: Long, elapsedSinceLastFeedMs: Long) {
        val n = underruns.incrementAndGet()
        Log.w(TAG, "audio underrun #$n: buffer ${bufferSizeMs} ms, ${elapsedSinceLastFeedMs} ms since the last feed")
      }
      override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, config: AudioSink.AudioTrackConfig) {
        Log.i(TAG, "AudioTrack: ${config.sampleRate} Hz, encoding ${config.encoding}, buffer ${config.bufferSize} bytes, offload ${config.offload}")
      }
      override fun onPlayerError(eventTime: AnalyticsListener.EventTime, error: PlaybackException) {
        Log.e(TAG, "player error", error)
      }
    })
    p.setMediaItem(MediaItem.fromUri(Uri.fromFile(File(path))))
    p.repeatMode = Player.REPEAT_MODE_ALL
    p.prepare()
    p.play()
    player = p
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    val delta = when (keyCode) { KeyEvent.KEYCODE_DPAD_LEFT -> -1; KeyEvent.KEYCODE_DPAD_RIGHT -> 1; else -> 0 }
    if (delta == 0) return super.onKeyDown(keyCode, event)
    view.queueEvent { renderer.step(delta) }
    return true
  }

  override fun onResume() { super.onResume(); view.onResume() }
  override fun onPause() { view.onPause(); super.onPause() }
  override fun onDestroy() {
    player?.release()
    player = null
    view.queueEvent { renderer.release() }
    super.onDestroy()
  }
}

/** The GL thread: the engine is made once the surface has a size and lives as long as the EGL context. */
class VizRenderer(
  private val bundle: ByteArray,
  private val scene: String,
  private val gpuFinish: Boolean,
  private val heardUs: () -> Long,
  private val underruns: () -> Int,
) : GLSurfaceView.Renderer {
  private var handle = 0L

  override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
    // A new context: whatever the old engine held on the GPU is gone with the old one.
    if (handle != 0L) { Native.destroy(handle, false); handle = 0L }
  }

  override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
    if (handle == 0L) handle = Native.create(bundle, width, height, scene, gpuFinish)
    else Native.resize(handle, width, height)
  }

  override fun onDrawFrame(gl: GL10?) {
    if (handle != 0L) Native.frame(handle, heardUs(), underruns())
  }

  fun step(delta: Int) { if (handle != 0L) Native.step(handle, delta) }
  fun release() { if (handle != 0L) { Native.destroy(handle, true); handle = 0L } }
}
