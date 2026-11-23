// Dolby Vision Profile 7 (UHD Blu-ray: an HDR10 base layer plus an enhancement layer and RPU in one HEVC
// track). Media3 gives Profile 7 no fallback decoder (MediaCodecUtil.getAlternativeCodecMimeType skips
// DvheDtb), so without help a device lacking a Profile 7 decoder refuses the video. Vela instead either
// converts it to Profile 8.1 (the RPU rewritten by libdovi, the enhancement layer dropped: dovi_tool's
// mode 2, the same conversion the Apple player makes) where a Profile 8 decoder exists, or plays the HDR10
// base layer alone. Pure: sample rewriting and the policy, no Android or Media3 types.
package app.ether.vela.player

internal enum class DolbyVisionAction { KEEP, CONVERT_TO_81, BASE_LAYER }

internal object DolbyVision {
  /** MediaCodecInfo.CodecProfileLevel.DolbyVisionProfileDvheDtb (7) and DvheSt (8). */
  const val PROFILE_7 = 0x80
  const val PROFILE_8 = 0x100

  /** HEVC NAL unit types Dolby Vision uses: 62 carries the RPU, 63 the enhancement layer. */
  const val NAL_RPU = 62
  const val NAL_ENHANCEMENT = 63

  /** Whether Vela converts a Profile 7 stream to 8.1 before decoding (declared as '7' in capabilities). */
  val convertsProfile7: Boolean get() = DoviNative.available

  /** What to do with a Dolby Vision track of `profile`, given the device's Dolby Vision decoder profiles. */
  fun plan(profile: Int?, decoderProfiles: Set<Int>, canConvert: Boolean): DolbyVisionAction = when {
    profile != 7 -> DolbyVisionAction.KEEP
    PROFILE_7 in decoderProfiles -> DolbyVisionAction.KEEP
    PROFILE_8 in decoderProfiles && canConvert -> DolbyVisionAction.CONVERT_TO_81
    else -> DolbyVisionAction.BASE_LAYER
  }

  /** The profile number of an RFC 6381 Dolby Vision codec string ("dvhe.07.06" is 7). */
  fun profile(codecs: String?): Int? = codecs?.split('.')?.getOrNull(1)?.toIntOrNull()

  /** The codec string of the converted stream: the same level as Profile 8. */
  fun profile8Codecs(codecs: String): String {
    val parts = codecs.split('.').toMutableList()
    if (parts.size >= 2) parts[1] = "08"
    return parts.joinToString(".")
  }

  /**
   * Rewrites an Annex-B HEVC access unit: enhancement-layer NAL units are dropped, and each RPU NAL unit
   * (from its two-byte header on) is replaced by `rpu`'s result, or dropped when that is null.
   * Returns null when the sample has neither, so it can pass through untouched.
   */
  fun rewrite(sample: ByteArray, length: Int = sample.size, rpu: (ByteArray) -> ByteArray?): ByteArray? {
    val units = nalUnits(sample, length)
    if (units.none { type(sample, it.first) == NAL_RPU || type(sample, it.first) == NAL_ENHANCEMENT }) return null
    val out = java.io.ByteArrayOutputStream(length)
    for ((start, end) in units) {
      when (type(sample, start)) {
        NAL_ENHANCEMENT -> {}
        NAL_RPU -> rpu(sample.copyOfRange(start, end))?.let { out.write(START_CODE); out.write(it) }
        else -> { out.write(START_CODE); out.write(sample, start, end - start) }
      }
    }
    return out.toByteArray()
  }

  private val START_CODE = byteArrayOf(0, 0, 0, 1)

  private fun type(data: ByteArray, start: Int) = (data[start].toInt() shr 1) and 0x3f

  /** [start, end) of each NAL unit after a 3- or 4-byte start code, without trailing zero bytes. */
  fun nalUnits(data: ByteArray, length: Int = data.size): List<Pair<Int, Int>> {
    val starts = mutableListOf<Int>()
    var i = 0
    while (i + 2 < length) {
      if (data[i].toInt() == 0 && data[i + 1].toInt() == 0 && data[i + 2].toInt() == 1) {
        starts += i + 3
        i += 3
      } else i++
    }
    return starts.mapIndexedNotNull { index, start ->
      var end = if (index + 1 < starts.size) starts[index + 1] - 3 else length
      while (end > start && data[end - 1].toInt() == 0) end--
      if (end - start >= 2) start to end else null
    }
  }
}

/** libdovi (MIT) through JNI: Profile 7 RPU to 8.1. Absent library means no conversion. */
internal object DoviNative {
  val available: Boolean by lazy { runCatching { System.loadLibrary("vela_dovi"); true }.getOrDefault(false) }

  /** An UNSPEC62 NAL unit (header 0x7C01 onward, emulation prevention intact), converted, or null on failure. */
  fun convertTo81(nal: ByteArray): ByteArray? = if (available) runCatching { convert(nal, 2) }.getOrNull() else null

  /** libdovi conversion `mode` (dovi_convert_rpu_with_mode): 2 is Profile 8.1 with no-op mapping curves. */
  // Public: an internal member's JVM name is mangled, and JNI binds by name.
  @JvmStatic external fun convert(nal: ByteArray, mode: Int): ByteArray?
}
