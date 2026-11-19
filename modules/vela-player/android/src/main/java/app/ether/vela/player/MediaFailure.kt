package app.ether.vela.player

/** Temporary transport failures do not justify starting another server transcode. */
internal fun transientMediaFailure(code: Int) = code in 500..599 || code in listOf(408, 429, 2001, 2002)

internal fun mediaFailureMessage(code: Int) = if (transientMediaFailure(code)) {
  "The stream is temporarily unavailable. Please try again."
} else {
  "This media could not be played. Please try again."
}
