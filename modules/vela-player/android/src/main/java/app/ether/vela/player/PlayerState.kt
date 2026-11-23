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
  var totalFrames: Long? = null
  var tracks: List<Map<String, Any?>> = emptyList()
  var audioId: Long? = null
  var subtitleId: Long? = null
  var videoParams: Map<String, Any?> = emptyMap()
  var frameRate: Double? = null
  var videoCodec: String? = null
  /** Source and output facts for the info card. */
  val format = PlaybackFormatFacts()
  /** A live stream's retained window, on the axis of `position` (Media3's window time). */
  var live: LiveWindow? = null
  /** The position in the live window before it is held at zero: negative once the window slid past it. */
  var windowPosition = 0.0
  /** A lost connection is being re-established (a read retry), until playback is ready again. */
  var reconnecting = false
  /** The speed the player runs at (the audio output may refuse a requested one). */
  var speed = 1.0
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

/** A live stream's retained window on the axis of `position`. Media3 reports positions relative to the
 * current Timeline window, so the window starts at 0 and its edge is the window's duration. */
internal data class LiveWindow(
  /** The oldest position that can be played. */
  val start: Double,
  /** The newest position that can be played: the end of the playlist. */
  val edge: Double,
  /** How far behind the edge playback normally sits: the live configuration's target offset, else 6 s. */
  val latency: Double,
  /** The segment (target) duration: the edge advances by about this much at a time. */
  val segment: Double,
  /** LiveSnapshot.edgeSource: `playlist` (an HLS media playlist) or `seekable` (another live window). */
  val source: String,
)

/** Live timeshift arithmetic for the snapshot and the commands: the web player's rules
 * (modules/vela-player/web/engine/live-behind.ts and host/live.ts), as ios/PlayerState.swift. */
internal object LiveTimeline {
  /** Seconds playback trails its usual live position (the edge less the latency target), or null when
   * that cannot be told: a position before the window, where the player is about to be put. */
  fun lag(window: LiveWindow, position: Double): Double? {
    if (!position.isFinite() || position < window.start - 1) return null
    return maxOf(0.0, window.edge - window.latency - position)
  }

  /** Behind live enough to tell the viewer: at least 10 s (or two segments when segments are longer), and
   * once behind, until back within 3 s, so it cannot flicker. */
  fun behind(lag: Double?, wasBehind: Boolean, segment: Double): Boolean {
    lag ?: return false
    return if (wasBehind) lag > 3 else lag >= maxOf(10.0, 2 * segment)
  }

  /** Where catching up to live lands: the edge less the latency target, inside the window; null when that
   * is not ahead of `position`, so there is nothing newer to go to. */
  fun catchUpTarget(window: LiveWindow, position: Double): Double? {
    if (window.edge - window.start < 0.25) return null
    val target = maxOf(window.start + 0.05, window.edge - window.latency)
    return if (target > position + 0.25) minOf(target, window.edge - 0.1) else null
  }

  /** A seek target held inside the window, short of the edge by a second; null for a non-finite target. */
  fun clamp(seconds: Double, window: LiveWindow): Double? {
    if (!seconds.isFinite() || window.edge < window.start) return null
    return minOf(maxOf(seconds, window.start), maxOf(window.start, window.edge - 1))
  }

  /** Where a paused live stream resumes when the window slid past its position meanwhile: a little inside
   * the window's start, so the next slide does not take it again at once. Null when still inside. */
  fun resumeTarget(window: LiveWindow, position: Double): Double? {
    if (position >= window.start) return null
    return window.start + minOf(5.0, maxOf(0.0, window.edge - 1 - window.start))
  }
}
