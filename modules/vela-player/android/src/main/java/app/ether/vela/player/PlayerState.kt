// What mpv reports about the file playing, kept from its observed properties.
package app.ether.vela.player

internal class PlayerState {
  enum class Phase(val wire: String) {
    LOADING("loading"),
    PLAYING("playing"),
    PAUSED("paused"),
    BUFFERING("buffering"),
    ENDED("ended"),
    FAILED("failed"),
  }

  var loaded = false
  var hasFrame = false
  var position = 0.0
  var duration: Double? = null
  var paused = true
  var pausedForCache = false
  var seeking = false
  var endReached = false
  /** The view ended playback itself (a preview whose grant expired). */
  var finished = false
  /** Seconds of media read ahead of the position. */
  var cacheAhead: Double? = null
  /** Bytes per second the cache fills at. */
  var cacheSpeed: Long? = null
  var droppedFrames: Long? = null
  var tracks: List<Map<String, Any?>> = emptyList()
  var audioId: Long? = null
  var subtitleId: Long? = null
  var videoParams: Map<String, Any?> = emptyMap()
  var frameRate: Double? = null
  var videoCodec: String? = null
  var failure: String? = null
  var failureKind = "source"

  val phase: Phase
    get() = when {
      failure != null -> Phase.FAILED
      finished -> Phase.ENDED
      !loaded -> Phase.LOADING
      endReached && atEnd -> Phase.ENDED
      pausedForCache || seeking -> Phase.BUFFERING
      paused -> Phase.PAUSED
      else -> Phase.PLAYING
    }

  /** Applies one observed property's new value. */
  fun update(name: String, value: Any?) {
    when (name) {
      "video-pts" -> hasFrame = value is Double
      "time-pos" -> position = (value as? Double) ?: position
      "duration" -> duration = value as? Double
      "pause" -> paused = (value as? Boolean) ?: paused
      "paused-for-cache" -> pausedForCache = value == true
      "seeking" -> seeking = value == true
      "eof-reached" -> endReached = value == true
      "demuxer-cache-time" -> cacheAhead = (value as? Double)?.let { maxOf(0.0, it - position) }
      "cache-speed" -> cacheSpeed = value as? Long
      "frame-drop-count" -> droppedFrames = value as? Long
      "track-list" -> tracks = (value as? List<*>)?.mapNotNull { asMap(it) } ?: emptyList()
      "aid" -> audioId = value as? Long
      "sid" -> subtitleId = value as? Long
      "video-params" -> videoParams = asMap(value) ?: emptyMap()
      "container-fps" -> frameRate = value as? Double
      "video-codec-name" -> videoCodec = value as? String
    }
  }

  /** The position is at the file's end. mpv also raises `eof-reached` for a moment while it switches
   * tracks on a network stream; reporting that as `ended` makes Ether end the session. */
  private val atEnd: Boolean
    get() {
      val length = duration ?: return false
      return position >= length - 1.5
    }

  /** The mpv track id of a source stream (FFmpeg stream index), for `aid` and `sid`. */
  fun trackId(type: String, streamIndex: Int): Long? {
    val track = tracks.firstOrNull { it["type"] == type && (it["ff-index"] as? Long)?.toInt() == streamIndex }
    return track?.get("id") as? Long
  }

  /** sdr, hdr10, hlg or dv from the decoded video's parameters. */
  val dynamicRange: String?
    get() {
      val gamma = videoParams["gamma"] as? String ?: return null
      if (videoParams["dovi"] != null || videoParams["light"] == "dolby-vision") {
        return "dv"
      }
      return when (gamma) {
        "pq" -> "hdr10"
        "hlg" -> "hlg"
        else -> "sdr"
      }
    }

  companion object {
    /** Properties the view observes, with the format each is read in. */
    val observed = listOf(
      "video-pts" to MpvFormat.DOUBLE,
      "time-pos" to MpvFormat.DOUBLE,
      "duration" to MpvFormat.DOUBLE,
      "pause" to MpvFormat.FLAG,
      "paused-for-cache" to MpvFormat.FLAG,
      "seeking" to MpvFormat.FLAG,
      "eof-reached" to MpvFormat.FLAG,
      "demuxer-cache-time" to MpvFormat.DOUBLE,
      "cache-speed" to MpvFormat.INT64,
      "frame-drop-count" to MpvFormat.INT64,
      "track-list" to MpvFormat.NODE,
      "aid" to MpvFormat.INT64,
      "sid" to MpvFormat.INT64,
      "video-params" to MpvFormat.NODE,
      "container-fps" to MpvFormat.DOUBLE,
      "video-codec-name" to MpvFormat.STRING,
    )

    @Suppress("UNCHECKED_CAST")
    private fun asMap(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>
  }
}
