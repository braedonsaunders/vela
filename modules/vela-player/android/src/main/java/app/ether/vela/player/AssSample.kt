// A Matroska SSA/ASS subtitle sample as Media3 hands it on. Pure, so it runs on a plain JVM.
package app.ether.vela.player

/** MatroskaExtractor's SSA sample: "Dialogue: 0:00:00:00,<duration H:MM:SS:CC>," then the Matroska block
 * ("ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text"), which is libass's chunk. Pure. */
internal object AssSample {
  private val PREFIX = "Dialogue: ".toByteArray()

  /** The event's duration in milliseconds and its Matroska block, or null for anything else. */
  fun parse(sample: ByteArray, offset: Int = 0, length: Int = sample.size - offset): Pair<Long, ByteArray>? {
    val end = offset + length
    if (length < PREFIX.size || (PREFIX.indices).any { sample[offset + it] != PREFIX[it] }) return null
    val first = (offset + PREFIX.size until end).firstOrNull { sample[it] == ','.code.toByte() } ?: return null
    val second = (first + 1 until end).firstOrNull { sample[it] == ','.code.toByte() } ?: return null
    val duration = timecodeMs(String(sample, first + 1, second - first - 1, Charsets.US_ASCII)) ?: return null
    return duration to sample.copyOfRange(second + 1, end)
  }

  /** "H:MM:SS:CC" (centiseconds, as MatroskaExtractor writes it) or "H:MM:SS.CC" in milliseconds. */
  fun timecodeMs(value: String): Long? {
    val parts = value.trim().split(':', '.')
    if (parts.size != 4) return null
    val (hours, minutes, seconds, centis) = parts.map { it.toLongOrNull() ?: return null }
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + centis * 10
  }
}
