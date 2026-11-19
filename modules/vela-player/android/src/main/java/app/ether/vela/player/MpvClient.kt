// One libmpv handle: options, commands, properties, and its events on a thread of their own.
// Properties are observed (mpv_observe_property), never polled; each change reaches
// `onProperty` on the main thread, as do the lifecycle events in `onEvent`.
package app.ether.vela.player

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface

class MpvError(message: String) : Exception(message)

internal class MpvClient(options: Map<String, String>) {
  sealed interface Event {
    data object FileLoaded : Event
    data class EndFile(val reason: Int, val error: Int) : Event
    data object SeekDone : Event
    /** The server refused a media request (401, 403, 404, 410): an expired or revoked grant. */
    data class Refused(val status: Int) : Event
  }

  var onProperty: ((String, Any?) -> Unit)? = null
  var onEvent: ((Event) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())
  private var handle = MpvNative.create()
  private val events: Thread
  @Volatile private var closing = false

  init {
    if (handle == 0L) {
      throw MpvError("libmpv could not create a player")
    }
    try {
      for ((name, value) in BASE_OPTIONS + options) {
        check(MpvNative.setOption(handle, name, value), name)
      }
      check(MpvNative.initialize(handle), "initialize")
      MpvNative.requestLog(handle, "warn")
    } catch (error: MpvError) {
      MpvNative.destroy(handle)
      handle = 0
      throw error
    }
    val owned = handle
    events = Thread({ readEvents(owned) }, "vela-mpv-events")
    events.start()
  }

  /** Ends playback and frees the handle; no callbacks follow. */
  fun destroy() {
    if (handle == 0L) {
      return
    }
    onProperty = null
    onEvent = null
    closing = true
    MpvNative.wakeup(handle)
    val owned = handle
    handle = 0
    Thread({
      events.join()
      MpvNative.destroy(owned)
    }, "vela-mpv-release").start()
  }

  // Video output

  /** Draws into `surface`; null detaches it (the Surface is going away). */
  fun attach(surface: Surface?) {
    if (handle == 0L) {
      return
    }
    if (surface == null) {
      MpvNative.setPropertyString(handle, "vo", "null")
      MpvNative.setPropertyString(handle, "force-window", "no")
      MpvNative.setSurface(handle, null)
      return
    }
    MpvNative.setSurface(handle, surface)
    MpvNative.setPropertyString(handle, "force-window", "yes")
    MpvNative.setPropertyString(handle, "vo", VIDEO_OUTPUT)
  }

  /** The Surface's size in pixels, for mpv's output (android-surface-size). */
  fun resize(width: Int, height: Int) {
    if (handle != 0L && width > 0 && height > 0) {
      MpvNative.setPropertyString(handle, "android-surface-size", "${width}x$height")
    }
  }

  // Commands and properties

  fun command(vararg arguments: String) {
    if (handle != 0L) {
      MpvNative.command(handle, arrayOf(*arguments))
    }
  }

  fun set(name: String, value: String) {
    if (handle != 0L) {
      MpvNative.setPropertyString(handle, name, value)
    }
  }

  fun set(name: String, flag: Boolean) {
    if (handle != 0L) {
      MpvNative.setPropertyFlag(handle, name, flag)
    }
  }

  fun set(name: String, number: Double) {
    if (handle != 0L) {
      MpvNative.setPropertyDouble(handle, name, number)
    }
  }

  /**
   * The request headers for the next file. Credentials never follow a redirect: while any header is
   * set, redirects are refused outright, by mpv's libcurl stream (which carries http and https) and by
   * FFmpeg's HTTP should anything open through it.
   */
  fun setRequestHeaders(fields: List<String>) {
    if (handle == 0L) {
      return
    }
    val credentialed = fields.isNotEmpty()
    MpvNative.setPropertyStringList(handle, "http-header-fields", fields.toTypedArray())
    MpvNative.setPropertyString(handle, "curl-max-redirects", if (credentialed) "0" else "16")
    val lavf = if (credentialed) "max_redirects=0" else ""
    MpvNative.setPropertyString(handle, "stream-lavf-o", lavf)
    MpvNative.setPropertyString(handle, "demuxer-lavf-o", lavf)
  }

  fun observe(name: String, format: MpvFormat) {
    if (handle != 0L) {
      MpvNative.observe(handle, name, format.value)
    }
  }

  // Events

  private fun readEvents(owned: Long) {
    while (!closing) {
      val event = MpvNative.waitEvent(owned, -1.0) ?: continue
      when (event.id) {
        MpvEvent.PROPERTY_CHANGE -> {
          val name = event.name ?: continue
          main.post { onProperty?.invoke(name, event.value) }
        }
        MpvEvent.FILE_LOADED -> post(Event.FileLoaded)
        MpvEvent.END_FILE -> post(Event.EndFile(event.reason, event.error))
        MpvEvent.PLAYBACK_RESTART -> post(Event.SeekDone)
        MpvEvent.LOG_MESSAGE -> logMessage(event.name, event.value as? String)
        MpvEvent.SHUTDOWN -> return
      }
    }
  }

  private fun logMessage(prefix: String?, text: String?) {
    val line = text?.trimEnd() ?: return
    Log.w(LOG_TAG, "$prefix: $line")
    refusedStatus(line)?.let { post(Event.Refused(it)) }
  }

  private fun post(event: Event) {
    main.post { onEvent?.invoke(event) }
  }

  private fun check(status: Int, what: String) {
    if (status < 0) {
      throw MpvError("mpv $what: ${MpvNative.errorString(status)}")
    }
  }

  companion object {
    const val LOG_TAG = "VelaPlayer"

    private val httpError = Regex("HTTP error (\\d{3})")

    /** libcurl's "HTTP error 404" and FFmpeg's "HTTP error 404 Not Found", for a refused grant. */
    private fun refusedStatus(line: String): Int? {
      val status = httpError.find(line)?.groupValues?.get(1)?.toInt() ?: return null
      return status.takeIf { it in listOf(401, 403, 404, 410) }
    }

    /** OpenGL ES through mpv's Android context. gpu-next shader compilation can stall
     * surface startup/teardown on older mobile GPUs; gpu supports the same MediaCodec path. */
    private const val VIDEO_OUTPUT = "gpu"

    private val BASE_OPTIONS = linkedMapOf(
      "vo" to "null",
      "gpu-context" to "android",
      "opengl-es" to "yes",
      "hwdec" to if (Emulator.running) "no" else "mediacodec,mediacodec-copy",
      "hwdec-codecs" to "all",
      "ao" to "audiotrack,opensles",
      "keep-open" to "yes",
      "idle" to "yes",
      "cache" to "yes",
      "demuxer-max-bytes" to "128MiB",
      "demuxer-max-back-bytes" to "32MiB",
      "demuxer-readahead-secs" to "20",
      "audio-channels" to "auto-safe",
      "sub-auto" to "no",
      // No youtube-dl hook: a URL that fails to open is a failure, not a page to scrape.
      "ytdl" to "no",
      "input-default-bindings" to "no",
      "input-vo-keyboard" to "no",
      "terminal" to "no",
      "msg-level" to "all=warn",
      "tls-verify" to "yes",
    )
  }
}
