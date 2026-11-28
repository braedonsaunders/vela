package app.ether.vela.player

/** Ether windows and timestamps are on the title clock. The renderer uses the media clock. */
internal class SubtitleWindowClock(private val originUs: Long) {
  fun titleMillis(mediaUs: Long): Long = ((mediaUs + originUs) / 1000).coerceAtLeast(0)
  fun mediaMicros(titleUs: Long): Long = titleUs - originUs
  fun fromMillis(mediaUs: Long, previous: Long?): Long {
    val current = titleMillis(mediaUs)
    // Move the base before the end of the two-minute window, giving the next request time to land.
    return if (previous == null || current < previous || current - previous >= 100_000) current else previous
  }
}
