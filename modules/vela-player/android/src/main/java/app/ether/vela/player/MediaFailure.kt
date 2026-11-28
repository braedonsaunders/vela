package app.ether.vela.player

/** Media3 IO errors (2000–2002) and temporary HTTP failures do not justify starting another server transcode. */
internal fun transientMediaFailure(code: Int) = code in 500..599 || code in listOf(408, 429, 2000, 2001, 2002)

internal fun mediaFailureMessage(code: Int) = if (transientMediaFailure(code)) {
  "The stream is temporarily unavailable. Please try again."
} else {
  "This media could not be played. Please try again."
}

internal fun originalLostResponse(status: Int, marker: String?) =
  status == 409 && marker == "original_lost"

internal fun originalEndedEarly(positionSeconds: Double, durationSeconds: Double?) =
  durationSeconds != null && durationSeconds.isFinite() && durationSeconds > 2 && positionSeconds < durationSeconds - 2


/** Extractors can omit an unsupported video stream while retaining perfectly playable audio. */
/**
 * A file on the device (a download) has no server to fall back to, so video a decoder reports as beyond
 * its rated capabilities still counts: Media3 plays it, usually fine (1080p60 AVC on a MediaTek phone).
 * A stream refuses it instead, so the server can transcode.
 */
internal fun localMedia(scheme: String?) = scheme == "file" || scheme == "content"

internal fun missingSupportedVideo(hasTracks: Boolean, hasVideo: Boolean, supportedVideo: Boolean, expectsVideo: Boolean) =
  hasTracks && ((hasVideo && !supportedVideo) || (!hasVideo && expectsVideo))


/** External sidecars belong to the client even over a server-generated HLS/DASH path. */
internal fun localSubtitleSelection(original: Boolean, selected: PlanTrack?, clientOnly: Boolean) =
  original || clientOnly || selected?.canRenderExternal == true
