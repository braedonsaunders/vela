// Names for the info card (Snapshot.format) and the server's capability tokens (packages/protocol), from
// Media3 MIME types and codec strings. Pure: no Android or Media3 types, so it runs on a plain JVM.
package app.ether.vela.player

internal object AvFormats {
  /** FFmpeg's name for a Media3 video MIME type; a Dolby Vision stream is named by its base layer codec. */
  fun videoCodec(mime: String?, codecs: String? = null): String? {
    val lower = mime?.lowercase() ?: return null
    if (lower == "video/dolby-vision") {
      return when (codecs?.substringBefore('.')?.lowercase()) {
        "dvav", "dva1" -> "h264"
        "dav1" -> "av1"
        else -> "hevc"
      }
    }
    return when (lower) {
      "video/avc" -> "h264"
      "video/hevc" -> "hevc"
      "video/av01" -> "av1"
      "video/x-vnd.on2.vp9" -> "vp9"
      "video/x-vnd.on2.vp8" -> "vp8"
      "video/mpeg2" -> "mpeg2video"
      "video/mpeg" -> "mpeg1video"
      "video/mp4v-es", "video/divx" -> "mpeg4"
      "video/wvc1" -> "vc1"
      "video/3gpp" -> "h263"
      "video/mjpeg" -> "mjpeg"
      "video/x-flv" -> "flv1"
      else -> lower.substringAfter('/')
    }
  }

  /** FFmpeg's name for a Media3 audio MIME type. */
  fun audioCodec(mime: String?): String? = when (val lower = mime?.lowercase()) {
    null -> null
    "audio/mp4a-latm" -> "aac"
    "audio/ac3" -> "ac3"
    "audio/eac3", "audio/eac3-joc" -> "eac3"
    "audio/ac4" -> "ac4"
    "audio/true-hd" -> "truehd"
    "audio/vnd.dts", "audio/vnd.dts.hd", "audio/vnd.dts.hd;profile=lbr", "audio/vnd.dts.uhd;profile=p2" -> "dts"
    "audio/flac" -> "flac"
    "audio/alac" -> "alac"
    "audio/opus" -> "opus"
    "audio/vorbis" -> "vorbis"
    "audio/mpeg" -> "mp3"
    "audio/mpeg-l2" -> "mp2"
    "audio/mpeg-l1" -> "mp1"
    "audio/raw" -> "pcm"
    "audio/g711-alaw" -> "pcm_alaw"
    "audio/g711-mlaw" -> "pcm_mulaw"
    else -> lower.substringAfter('/')
  }

  /** A profile name where the MIME type alone establishes it. */
  fun audioProfile(mime: String?, atmos: Boolean): String? = when (mime?.lowercase()) {
    "audio/eac3-joc" -> "E-AC-3 + JOC"
    "audio/true-hd" -> if (atmos) "Dolby TrueHD + Atmos" else "Dolby TrueHD"
    "audio/vnd.dts.hd" -> "DTS-HD"
    "audio/vnd.dts.hd;profile=lbr" -> "DTS Express"
    "audio/vnd.dts.uhd;profile=p2" -> "DTS:X"
    else -> null
  }

  /** 'atmos' or 'dtsx' when the stream itself carries objects or heights. */
  fun immersive(mime: String?, trueHdAtmos: Boolean): String? = when (mime?.lowercase()) {
    "audio/eac3-joc" -> "atmos"
    "audio/true-hd" -> if (trueHdAtmos) "atmos" else null
    "audio/vnd.dts.uhd;profile=p2" -> "dtsx"
    else -> null
  }

  /** FFmpeg's layout name for a channel count, for the usual speaker sets only. */
  fun layout(channels: Int): String? = when (channels) {
    1 -> "mono"
    2 -> "stereo"
    3 -> "2.1"
    4 -> "quad"
    5 -> "5.0"
    6 -> "5.1"
    7 -> "6.1"
    8 -> "7.1"
    10 -> "5.1.4"
    12 -> "7.1.4"
    16 -> "9.1.6"
    else -> null
  }

  /**
   * Dolby Vision profile and level from an RFC 6381 codec string ("dvhe.07.06", "dvh1.08.09", "dav1.10.06").
   * Profile 8 and 10 are named by their base layer's transfer: 8.1/10.1 over PQ, 8.4/10.4 over HLG, 8.2 over SDR.
   */
  fun dolbyVision(codecs: String?, transfer: String?): Pair<String, Int?>? {
    val parts = codecs?.split('.') ?: return null
    if (parts.size < 2 || parts[0].lowercase() !in setOf("dvhe", "dvh1", "dvav", "dva1", "dav1")) return null
    val profile = parts[1].toIntOrNull() ?: return null
    val level = parts.getOrNull(2)?.toIntOrNull()
    val name = when (profile) {
      8, 10 -> "$profile." + when (transfer) { "hlg" -> "4"; "sdr" -> "2"; else -> "1" }
      else -> profile.toString()
    }
    return name to level
  }

  /** Bit depth from a codec profile where it decides it (HEVC Main 10, VP9 profile 2, AV1 10-bit). */
  fun videoBitDepth(codec: String?, codecs: String?): Int? {
    val parts = codecs?.lowercase()?.split('.') ?: return null
    return when (codec) {
      "hevc" -> when (parts.getOrNull(1)?.trimStart('a', 'b', 'c')) { "1" -> 8; "2" -> 10; else -> null }
      "vp9" -> parts.getOrNull(3)?.toIntOrNull()
      "av1" -> parts.getOrNull(3)?.toIntOrNull()
      // avc1.PPCCLL: High 10 (profile_idc 110) is 10-bit; High 4:2:2/4:4:4 may be either.
      "h264" -> when (parts.getOrNull(1)?.take(2)?.toIntOrNull(16)) { null, 122, 244 -> null; 110 -> 10; else -> 8 }
      else -> null
    }?.takeIf { it in 8..16 }
  }

  /** The `ClientCapabilities.audioOutput` block for what the current route takes. */
  fun audioOutput(passthrough: Set<String>, maxChannels: Int, maxSampleRate: Int?, floatPcm: Boolean): Map<String, Any> {
    val order = listOf("ac3", "eac3", "eac3-joc", "truehd", "dts", "dts-hd", "dts-uhd")
    val immersive = buildList {
      if ("eac3-joc" in passthrough) add("eac3-joc")
      // The TrueHD bitstream carries the Atmos objects; the receiver renders them.
      if ("truehd" in passthrough) add("truehd-atmos")
      // DTS:X rides in the DTS-HD MA extension substream (or DTS UHD).
      if ("dts-hd" in passthrough || "dts-uhd" in passthrough) add("dtsx")
    }
    // Lossless: a TrueHD bitstream reaches the receiver, or decoded float PCM keeps 24 bits over a 7.1 route.
    val lossless = "truehd" in passthrough || (floatPcm && maxChannels >= 8)
    return buildMap {
      put("passthrough", order.filter { it in passthrough })
      put("immersive", immersive)
      put("maxChannels", maxChannels)
      maxSampleRate?.let { put("maxSampleRate", it) }
      put("lossless", lossless)
    }
  }

  /** Dolby Vision profiles a decoder shows as Dolby Vision; '7' when Vela converts Profile 7 to 8.1 itself. */
  fun dolbyVisionProfiles(decoderProfiles: Set<Int>, convertsProfile7: Boolean): List<String> = buildList {
    // MediaCodecInfo.CodecProfileLevel.DolbyVisionProfile* bit values.
    if (decoderProfiles.contains(0x20)) add("5")
    if (decoderProfiles.contains(0x80) || (convertsProfile7 && decoderProfiles.contains(0x100))) add("7")
    if (decoderProfiles.contains(0x100)) { add("8.1"); add("8.4") }
    if (decoderProfiles.contains(0x400)) { add("10.1"); add("10.4") }
  }
}

/** Facts from a TrueHD access unit's major sync (FFmpeg libavcodec/mlp_parse.c ff_mlp_read_major_sync). */
internal data class TrueHdSync(val sampleRate: Int, val substreams: Int, val substreamInfo: Int) {
  /** Atmos: four substreams, the fourth carrying the 16-channel object presentation. */
  val atmos: Boolean get() = substreams == 4 && substreamInfo and 0x80 != 0

  companion object {
    /** Reads the major sync of an access unit that starts at `offset`, or null when it has none. */
    fun parse(data: ByteArray, offset: Int = 0, length: Int = data.size - offset): TrueHdSync? {
      val sync = offset + 4
      if (length < 4 + 18) return null
      fun byte(index: Int) = data[sync + index].toInt() and 0xff
      if (byte(0) != 0xf8 || byte(1) != 0x72 || byte(2) != 0x6f || byte(3) != 0xba) return null
      val rateBits = byte(4) shr 4
      val rate = when (rateBits) { 0, 1, 2 -> 48000 shl rateBits; 8, 9, 10 -> 44100 shl (rateBits - 8); else -> 0 }
      // After 32 bits of format info, 48 of signature/flags/reserved and 16 of vbr(1)/peak rate(15):
      // substreams(4), reserved(2), extended substream info(2), substream info(8).
      val substreams = byte(16) shr 4
      val info = byte(17)
      return TrueHdSync(rate, substreams, info)
    }
  }
}
