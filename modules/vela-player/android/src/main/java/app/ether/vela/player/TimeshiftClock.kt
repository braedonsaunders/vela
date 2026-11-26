package app.ether.vela.player

/** One point common to the server's broadcast clock and the playlist's wall clock. */
internal data class TimeshiftClock(val edgeSeconds: Double, val edgeAtMs: Long, val plannedStartSeconds: Double) {
  fun broadcastSeconds(atMs: Double): Double = edgeSeconds + (atMs - edgeAtMs) / 1000.0

  fun windowStartSeconds(windowStartTimeMs: Long?): Double =
    windowStartTimeMs?.let { broadcastSeconds(it.toDouble()) } ?: plannedStartSeconds

  /** Resolve against the window that actually loaded, which may have advanced since the seek was accepted. */
  fun placement(positionSeconds: Double, windowStartTimeMs: Long?, durationSeconds: Double): TimeshiftPlacement {
    val offset = positionSeconds - windowStartSeconds(windowStartTimeMs)
    return when {
      offset < 0 && windowStartTimeMs != null -> TimeshiftPlacement.Evicted
      offset >= durationSeconds -> TimeshiftPlacement.Live
      else -> TimeshiftPlacement.Seek(offset.coerceAtLeast(0.0))
    }
  }
}

internal sealed interface TimeshiftPlacement {
  data class Seek(val windowSeconds: Double) : TimeshiftPlacement
  data object Live : TimeshiftPlacement
  data object Evicted : TimeshiftPlacement
}
