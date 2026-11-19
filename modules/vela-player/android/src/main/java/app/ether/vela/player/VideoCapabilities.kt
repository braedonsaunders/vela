package app.ether.vela.player

/** Device facts, kept separate from Android's codec APIs so declaration policy can be tested. */
internal data class VideoDecoderFacts(
  val name: String,
  val codec: String,
  val mime: String,
  val width: Int,
  val height: Int,
  val frameRate: Double?,
  val profiles: List<Pair<Int, Int>>,
  val hdr: Set<String>,
) {
  val snapshot: Map<String, Any>
    get() = buildMap {
      put("name", name); put("codec", codec); put("mimeType", mime)
      put("hardware", true); put("maxWidth", width); put("maxHeight", height)
      frameRate?.let { put("maxFrameRateAtMaxSize", it) }
      put("profiles", profiles.map { mapOf("profile" to it.first, "level" to it.second) })
      put("hdr", hdr.toList())
    }
}

internal fun playableHdr(displayModes: List<String>, decoders: List<VideoDecoderFacts>): List<String> =
  displayModes.distinct().filter { mode -> decoders.any { it.hdr.contains(mode) } }

internal fun maximumVideoSize(decoders: List<VideoDecoderFacts>): Pair<Int, Int>? =
  decoders.filter { it.width > 0 && it.height > 0 }
    .maxByOrNull { it.width.toLong() * it.height }?.let { it.width to it.height }
