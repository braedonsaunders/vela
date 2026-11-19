package app.ether.vela.player

/** Media3 IO errors (2000–2002) and temporary HTTP failures do not justify starting another server transcode. */
internal fun transientMediaFailure(code: Int) = code in 500..599 || code in listOf(408, 429, 2000, 2001, 2002)

internal fun mediaFailureMessage(code: Int) = if (transientMediaFailure(code)) {
  "The stream is temporarily unavailable. Please try again."
} else {
  "This media could not be played. Please try again."
}


/** Extractors can omit an unsupported video stream while retaining perfectly playable audio. */
internal fun missingSupportedVideo(hasTracks: Boolean, hasVideo: Boolean, supportedVideo: Boolean, expectsVideo: Boolean) =
  hasTracks && ((hasVideo && !supportedVideo) || (!hasVideo && expectsVideo))


/** External sidecars belong to the client even over a server-generated HLS/DASH path. */
internal fun localSubtitleSelection(original: Boolean, selected: PlanTrack?, clientOnly: Boolean) =
  original || clientOnly || selected?.canRenderExternal == true
