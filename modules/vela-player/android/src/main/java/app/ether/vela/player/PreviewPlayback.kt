// A trailer preview on libmpv (the `preview` and `active` props): muted, from the start, with small
// caches, no display matching, no screen-on and no observations. It plays only while active, on
// screen, before the grant expires and when the viewer has not asked to save data; when any of those
// ends the mpv handle is destroyed at once, which releases the decoder. There is no retry after
// expiry: the host asks the server for a new grant.
package app.ether.vela.player

import android.content.Context
import android.net.ConnectivityManager
import android.os.Handler
import android.os.Looper

internal class PreviewPlayback(
  private val context: Context,
  private val host: PlayerHost,
  private val report: PlayerReport,
) {
  private val main = Handler(Looper.getMainLooper())
  private val expire = Runnable { expired() }
  private var source: PreviewSource? = null
  private var mpv: MpvClient? = null
  private var state = PlayerState()
  private var active = true
  private var onScreen = true
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
    mpv?.set("pause", paused)
    return null
  }

  fun surfaceCreated() {
    host.surface?.let { mpv?.attach(it) }
  }

  fun surfaceChanged(width: Int, height: Int) {
    mpv?.resize(width, height)
  }

  fun surfaceDestroyed() {
    mpv?.attach(null)
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
    if (wanted && mpv == null && !state.finished) {
      start(preview)
    } else if (!wanted && mpv != null) {
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
    val client = try {
      MpvClient(
        mapOf(
          "pause" to if (paused) "yes" else "no",
          "mute" to "yes",
          "audio" to "no",
          "sid" to "no",
          "loop-file" to if (preview.loop) "inf" else "no",
          "demuxer-max-bytes" to "16MiB",
          "demuxer-max-back-bytes" to "4MiB",
          "demuxer-readahead-secs" to "5",
          "tls-ca-file" to TrustStore.file(context).path,
        ),
      )
    } catch (error: Exception) {
      fail(error.message ?: "The preview player could not start")
      return
    }
    mpv = client
    client.onProperty = { name, value ->
      state.update(name, value)
      report.publish(state, null)
    }
    client.onEvent = { event -> event(event) }
    for ((name, format) in PlayerState.observed) {
      client.observe(name, format)
    }
    host.surface?.let { client.attach(it) }
    client.setRequestHeaders(MediaAccessStore.headerFields(url))
    client.command("loadfile", url.toString(), "replace")
    schedule(preview)
    report.publish(state, null, force = true)
  }

  private fun event(event: MpvClient.Event) {
    when (event) {
      MpvClient.Event.FileLoaded -> state.loaded = true
      is MpvClient.Event.EndFile -> if (event.reason == MpvEvent.END_REASON_ERROR) {
        state.failure = "The preview could not be played (${MpvNative.errorString(event.error)})"
        state.failureKind = if (event.error == MpvEvent.ERROR_LOADING_FAILED) "network" else "source"
      }
      MpvClient.Event.SeekDone -> Unit
    }
    report.publish(state, null, force = true)
    if (state.phase == PlayerState.Phase.ENDED || state.phase == PlayerState.Phase.FAILED) {
      stop()
    }
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
    state.failure = message
    state.failureKind = "source"
    report.publish(state, null, force = true)
  }

  private fun stop() {
    main.removeCallbacks(expire)
    val client = mpv ?: return
    mpv = null
    client.destroy()
  }

  /** The viewer turned on Data Saver and the network is metered. */
  private fun savingData(): Boolean {
    val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return false
    val restricted = connectivity.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
    return restricted && connectivity.isActiveNetworkMetered
  }
}
