package app.ether.vela.player

internal data class PlaybackBuffering(
  val minimumMs: Int, val maximumMs: Int, val startMs: Int, val resumeMs: Int, val prioritizeTime: Boolean,
)

/** Live Wi-Fi needs enough media to bridge packet jitter before starting/resuming.
 * Trailer and VOD start latency stays unchanged. Only one live decoder is retained. */
internal fun playbackBuffering(preview: Boolean, live: Boolean) = PlaybackBuffering(
  minimumMs = if (preview) { if (live) 8000 else 2000 } else 15000,
  maximumMs = if (preview) { if (live) 20000 else 5000 } else 50000,
  startMs = if (live) 3000 else 500,
  resumeMs = if (live) 5000 else 1000,
  prioritizeTime = live,
)
