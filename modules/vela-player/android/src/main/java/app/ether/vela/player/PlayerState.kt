// Engine-independent state published through the existing Vela player contract.
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
      pausedForCache || seeking -> Phase.BUFFERING
      paused -> Phase.PAUSED
      else -> Phase.PLAYING
    }

  /** The engine track id of a source stream (the plan stream index). */
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

}
