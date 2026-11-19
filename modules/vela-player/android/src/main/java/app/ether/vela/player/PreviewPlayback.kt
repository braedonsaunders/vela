package app.ether.vela.player

import android.content.Context
import android.net.ConnectivityManager
import android.os.Handler
import android.os.Looper

internal class PreviewPlayback(
  private val context: Context,
  private val host: PlayerHost,
  private val report: PlayerReport,
  private val showVideo: (Boolean) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private val expire = Runnable { expired() }
  private var source: PreviewSource? = null
  private var engine: PlaybackEngine? = null
  private var state = PlayerState()
  private var active = true
  private var onScreen = false
  private var paused = false

  /** A preview is set (the view plays previews, not plans). */
  val isSet: Boolean
    get() = source != null

  fun setPreview(value: Map<String, Any?>?) {
    val next = value?.let(PreviewSource::from)
    val previous = source
    if (next != null && previous != null && next.url == previous.url && next.loop == previous.loop) {
      source = next
      schedule(next)
      return
    }
    stop()
    source = next
    paused = false
    if (next != null) {
      report.adoptPreview()
      state = PlayerState()
      refresh()
    }
  }

  fun setActive(value: Boolean) {
    active = value
    refresh()
  }

  fun setOnScreen(value: Boolean) {
    onScreen = value
    refresh()
  }

  /** play and pause; a preview takes no other command. */
  fun command(type: String): String? {
    when (type) {
      "play" -> paused = false
      "pause" -> paused = true
      else -> return "A preview takes play and pause only"
    }
    engine?.play(!paused)
    return null
  }

  fun surfaceCreated() {
    host.surface?.let { engine?.attach(it) }
  }

  fun surfaceChanged(width: Int, height: Int) {
    // Surface geometry is owned by the view.
  }

  fun surfaceDestroyed() {
    engine?.attach(null)
  }

  fun release() {
    stop()
    source = null
  }

  // Playback

  /** Starts or stops so that the preview plays exactly while it may. */
  private fun refresh() {
    val preview = source ?: return
    val wanted = active && onScreen && preview.remaining() > 0 && !savingData()
    if (wanted && engine == null && !state.finished) {
      start(preview)
    } else if (!wanted && engine != null) {
      stop()
      if (preview.remaining() <= 0) {
        expired()
      }
    }
  }

  private fun start(preview: PreviewSource) {
    val url = MediaAccessStore.resolve(preview.url)
    if (url == null) {
      fail("The preview URL cannot be resolved without a media access origin")
      return
    }
    state = PlayerState()
    val client = Media3Engine(context, true)
    engine = client
    state = client.state
    client.onChange = {
      if (engine === client) {
        showVideo(state.hasFrame)
        report.publish(state, null)
        if (state.finished) stop()
      }
    }
    client.onFailure = { code, _ -> fail("The preview could not be played (Media3 $code)") }
    host.surface?.let { client.attach(it) }
    client.volume(0f)
    client.load(url, null, preview.startSeconds, preview.loop)
    client.play(!paused)
    schedule(preview)
    report.publish(state, null, force = true)
  }

  private fun schedule(preview: PreviewSource) {
    main.removeCallbacks(expire)
    main.postDelayed(expire, maxOf(0, preview.remaining()))
  }

  /** The grant ran out: playback ends for good. */
  private fun expired() {
    stop()
    state.finished = true
    report.publish(state, null, force = true)
  }

  private fun fail(message: String) {
    stop()
    state.failure = message
    state.failureKind = "source"
    report.publish(state, null, force = true)
  }

  private fun stop() {
    showVideo(false)
    main.removeCallbacks(expire)
    val client = engine ?: return
    engine = null
    client.release()
  }

  /** The viewer turned on Data Saver and the network is metered. */
  private fun savingData(): Boolean {
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return false
    val restricted = connectivity.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
    return restricted && connectivity.isActiveNetworkMetered
  }
}
