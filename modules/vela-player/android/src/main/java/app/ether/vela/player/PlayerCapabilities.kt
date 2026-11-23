// Media3 capabilities: platform video decoding plus the LGPL FFmpeg audio extension.
package app.ether.vela.player

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build

internal object PlayerCapabilities {
  /** MediaCodec MIME types and the names Vela's protocol gives their codecs. */
  private val videoTypes = listOf(
    "video/avc" to "h264",
    "video/hevc" to "hevc",
    "video/av01" to "av1",
    "video/x-vnd.on2.vp9" to "vp9",
    "video/x-vnd.on2.vp8" to "vp8",
    "video/mpeg2" to "mpeg2video",
    "video/mp4v-es" to "mpeg4",
    "video/wvc1" to "vc1",
    "video/3gpp" to "h263",
    "video/dolby-vision" to "dv",
  )

  private val audio = listOf(
    "aac", "ac3", "eac3", "dts", "truehd", "mlp", "flac", "alac", "opus", "vorbis", "mp3", "mp2",
    "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_bluray", "pcm_dvd",
  )

  fun capabilities(context: android.content.Context?): Map<String, Any> {
    val displayHdr = displayHdr(context)
    val hdr = playableHdr(displayHdr, decoders)
    val dvProfiles = dolbyVisionDecoderProfiles()
    val route = context?.let { runCatching { AudioRoute.probe(it) }.getOrNull() }
    return probed + buildMap {
      put("hdr", hdr)
      // Shown as Dolby Vision only where the display takes it; elsewhere the base layer plays as HDR10/HLG.
      if ("dv" in hdr) put("dolbyVisionProfiles", AvFormats.dolbyVisionProfiles(dvProfiles, DolbyVision.convertsProfile7))
      route?.let { put("audioOutput", AvFormats.audioOutput(it.passthrough, it.maxChannels, it.maxSampleRate, floatPcm = true)) }
    }
  }

  /** The HDR formats the default display reports ("hdr10", "hdr10+", "hlg", "dv"). */
  fun displayHdr(context: android.content.Context?): List<String> {
    val display = context?.getSystemService(android.hardware.display.DisplayManager::class.java)
      ?.getDisplay(android.view.Display.DEFAULT_DISPLAY)
    @Suppress("DEPRECATION")
    return (display?.hdrCapabilities?.supportedHdrTypes ?: intArrayOf()).toList().mapNotNull {
      when (it) {
        android.view.Display.HdrCapabilities.HDR_TYPE_HDR10 -> "hdr10"
        android.view.Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS -> "hdr10+"
        android.view.Display.HdrCapabilities.HDR_TYPE_HLG -> "hlg"
        android.view.Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION -> "dv"
        else -> null
      }
    }
  }

  /** Profile bits (CodecProfileLevel.DolbyVisionProfile*) of the hardware Dolby Vision decoders. */
  fun dolbyVisionDecoderProfiles(): Set<Int> =
    decoders.filter { it.codec == "dv" && it.hardware }.flatMap { it.profiles.map { p -> p.first } }.toSet()

  /** Whether a decoder is a hardware decoder, and whether it decodes Dolby Vision itself, by codec name. */
  fun decoderKind(name: String?): Pair<Boolean, Boolean>? {
    name ?: return null
    val info = runCatching { MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.firstOrNull { it.name == name } }.getOrNull() ?: return null
    return hardware(info) to info.supportedTypes.any { it.equals("video/dolby-vision", true) }
  }

  /** Full platform profiles/levels for device diagnostics; the v0 wire has codec names and global limits. */
  fun decoderDetails(): List<Map<String, Any>> = decoders.map { it.snapshot }

  private val decoders: List<VideoDecoderFacts> by lazy { probeDecoders() }
  private val probed: Map<String, Any> by lazy {
    val video = videoTypes.map { it.second }.filter { codec -> codec != "dv" && decoders.any { it.codec == codec } }
    val size = maximumVideoSize(decoders)
    mapOf(
      // What the server's HLS may carry when an original cannot be played.
      "containers" to listOf("mp4"),
      "videoCodecs" to video,
      "audioCodecs" to listOf("aac", "ac3", "eac3"),
      "subtitleFormats" to listOf("webvtt", "srt", "ass", "ssa", "pgs", "tx3g"),
      "hls" to true,
      "mse" to false,
      "originalPlayback" to mapOf(
        "version" to 1,
        "range" to true,
        "webgpu" to false,
        // Media3's extractors. Not m2ts: Media3 reads 188-byte TS only, without the Blu-ray stream types.
        "demuxContainers" to listOf("mkv", "webm", "mp4", "mov", "mpegts", "avi", "ogg", "flv", "mpegps"),
        "videoDecoders" to video,
        "audioDecoders" to audio,
      ),
    ) + (size?.let { mapOf("maxWidth" to it.first, "maxHeight" to it.second) } ?: emptyMap())
  }

  private fun probeDecoders(): List<VideoDecoderFacts> {
    val all = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter {
      !it.isEncoder && (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !it.isAlias)
    }
    val accelerated = all.filter(::hardware)
    // An emulator may expose only a software AVC codec. Permit bounded SDR playback there,
    // without representing it as hardware or advertising software HEVC/HDR originals.
    val softwareAvc = if (accelerated.any { it.supportedTypes.any { mime -> mime.equals("video/avc", true) } }) null
      else all.firstOrNull { it.supportedTypes.any { mime -> mime.equals("video/avc", true) } }
    return (accelerated + listOfNotNull(softwareAvc)).distinctBy { it.name }.flatMap { decoder ->
      val acceleratedDecoder = hardware(decoder)
      videoTypes.mapNotNull { (mime, codec) ->
        if (!acceleratedDecoder && codec != "h264") return@mapNotNull null
        if (decoder.supportedTypes.none { it.equals(mime, true) }) return@mapNotNull null
        runCatching {
          val caps = decoder.getCapabilitiesForType(mime)
          val video = caps.videoCapabilities ?: return@runCatching null
          // Check pairs: independent width/height range maxima can describe an impossible frame size.
          val sizes = listOf(7680 to 4320, 4096 to 2160, 3840 to 2160, 2560 to 1440, 1920 to 1080, 1280 to 720, 720 to 480, 640 to 360, 320 to 240, 160 to 120)
          val size = sizes.firstOrNull { (width, height) ->
            (acceleratedDecoder || (width <= 1920 && height <= 1080)) && video.isSizeSupported(width, height)
          } ?: return@runCatching null
          val profiles = caps.profileLevels.map { it.profile to it.level }
          val main10 = profiles.any { (profile, _) -> when (codec) {
            "hevc" -> profile in listOf(2, 4096, 8192) // HEVC Main10, Main10 HDR10 and HDR10+.
            "vp9" -> profile in listOf(4, 8, 4096, 8192, 16384, 32768) // Profile2/3 and HDR variants.
            "av1" -> profile in listOf(2, 4096, 8192) // AV1 Main10 and HDR variants.
            else -> false
          } }
          // HDR10+ only where the decoder names an HDR10+ profile (HEVC/AV1 0x2000, VP9 0x4000/0x8000).
          val hdr10Plus = profiles.any { (profile, _) -> when (codec) {
            "hevc", "av1" -> profile == 8192
            "vp9" -> profile == 16384 || profile == 32768
            else -> false
          } }
          val modes = if (codec == "dv" && profiles.isNotEmpty()) setOf("dv")
            else if (main10) setOfNotNull("hdr10", "hlg", "hdr10+".takeIf { hdr10Plus }) else emptySet()
          val rate = runCatching { video.getSupportedFrameRatesFor(size.first, size.second).upper.takeIf { it.isFinite() && it > 0 } }.getOrNull()
          VideoDecoderFacts(decoder.name, codec, mime, size.first, size.second, rate, profiles, modes, acceleratedDecoder)
        }.getOrNull()
      }
    }
  }

  /** A hardware decoder; before Android 10 the platform's software codecs are known by name. */
  private fun hardware(codec: MediaCodecInfo): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      return codec.isHardwareAccelerated && !codec.isAlias
    }
    val name = codec.name.lowercase()
    return !name.startsWith("omx.google.") && !name.startsWith("c2.android.") && !name.contains(".sw.")
  }
}
