// Source → output facts for the info card (Snapshot.format, modules/vela-player/web/engine/format-info.ts),
// from what Media3 actually reports: input formats, initialized decoders and the AudioTrack it opened.
// An unknown stays absent.
package app.ether.vela.player

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.audio.AudioSink

internal class PlaybackFormatFacts {
  var video: Format? = null
  var videoDecoder: String? = null
    set(value) { field = value; decoderKind = PlayerCapabilities.decoderKind(value) }
  var audio: Format? = null
  var audioDecoder: String? = null
  var audioTrack: AudioSink.AudioTrackConfig? = null
  var route: AudioRouteFacts? = null
  /** Per format id: the TrueHD stream's major sync announced an Atmos presentation. */
  val trueHdAtmos = mutableMapOf<String, Boolean>()
  /** Per format id: the source's Dolby Vision profile and what Vela did to it before decoding. */
  val dolbyVision = mutableMapOf<String, Pair<Int, DolbyVisionAction>>()
  /** Hardware decoder, decodes Dolby Vision itself. */
  private var decoderKind: Pair<Boolean, Boolean>? = null

  fun snapshot(display: Map<String, Any>): Map<String, Any?> =
    mapOf("video" to video(), "videoOut" to videoOut(display), "audio" to audio(), "audioOut" to audioOut())

  private val atmos: Boolean
    get() = trueHdAtmos[audio?.id.orEmpty()] ?: trueHdAtmos.values.singleOrNull() ?: false
  private val sourceDolbyVision: Pair<Int, DolbyVisionAction>?
    get() = dolbyVision[video?.id.orEmpty()] ?: dolbyVision.values.singleOrNull()

  val frameRate: Double? get() = video?.frameRate?.toDouble()?.takeIf { it > 0 }?.let(DisplayModes::exactRate)

  private fun video(): Map<String, Any>? {
    val format = video ?: return null
    val codec = AvFormats.videoCodec(format.sampleMimeType, format.codecs) ?: return null
    val transfer = transfer(format)
    val dv = if (format.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION) AvFormats.dolbyVision(format.codecs, transfer) else null
    return buildMap {
      put("codec", codec)
      (format.colorInfo?.lumaBitdepth?.takeIf { it != Format.NO_VALUE } ?: AvFormats.videoBitDepth(codec, format.codecs))?.let { put("bitDepth", it) }
      if (format.width > 0 && format.height > 0) { put("width", format.width); put("height", format.height) }
      frameRate?.let { put("frameRate", it) }
      val tapped = sourceDolbyVision
      (if (tapped != null) "dv" else range(format, transfer))?.let { put("range", it) }
      (tapped?.first?.toString() ?: dv?.first)?.let { put("dvProfile", it) }
      dv?.second?.let { put("dvLevel", it) }
    }
  }

  private fun videoOut(display: Map<String, Any>): Map<String, Any>? {
    val format = video ?: return null
    val transfer = transfer(format)
    val source = range(format, transfer)
    val (hardware, decodesDv) = decoderKind ?: (null to null)
    val tapped = sourceDolbyVision?.second
    val baseLayer = tapped == DolbyVisionAction.BASE_LAYER || (source == "dv" && decodesDv == false)
    return buildMap {
      putAll(display)
      (if (baseLayer) baseRange(transfer) else source)?.let { put("range", it) }
      if (source == "dv" && decodesDv == true) AvFormats.dolbyVision(format.codecs, transfer)?.let { put("dvProfile", it.first) }
      when {
        baseLayer -> put("dvConversion", "base-layer")
        tapped == DolbyVisionAction.CONVERT_TO_81 -> put("dvConversion", "p7-to-8.1")
      }
      hardware?.let { put("decoder", if (it) "hardware" else "software") }
      videoDecoder?.let { put("decoderName", it) }
    }
  }

  private fun audio(): Map<String, Any>? {
    val format = audio ?: return null
    val codec = sourceAudioCodec(format) ?: return null
    return buildMap {
      put("codec", codec)
      AvFormats.audioProfile(format.sampleMimeType, atmos)?.let { put("profile", it) }
      if (format.channelCount > 0) {
        put("channels", format.channelCount)
        AvFormats.layout(format.channelCount)?.let { put("layout", it) }
      }
      if (format.sampleRate > 0) put("sampleRate", format.sampleRate)
      pcmBits(format.pcmEncoding)?.let { put("bitDepth", it) }
      AvFormats.immersive(format.sampleMimeType, atmos)?.let { put("immersive", it) }
      format.language?.takeIf { it.isNotBlank() && it != C.LANGUAGE_UNDETERMINED }?.let { put("language", it) }
    }
  }

  private fun audioOut(): Map<String, Any>? {
    val track = audioTrack ?: return null
    val source = audio
    val pcm = Util.isEncodingLinearPcm(track.encoding)
    val channels = Integer.bitCount(track.channelConfig)
    val sourceChannels = source?.channelCount?.takeIf { it > 0 }
    val sourceRate = source?.sampleRate?.takeIf { it > 0 }
    val downmixed = pcm && sourceChannels != null && channels < sourceChannels
    val resampled = pcm && sourceRate != null && track.sampleRate != sourceRate
    return buildMap {
      put("delivery", if (pcm) "decoded" else "passthrough")
      put("codec", if (pcm) "pcm" else AudioRoute.passthroughToken(track.encoding) ?: "bitstream")
      if (channels > 0) { put("channels", channels); AvFormats.layout(channels)?.let { put("layout", it) } }
      if (track.sampleRate > 0) put("sampleRate", track.sampleRate)
      if (pcm) pcmBits(track.encoding)?.let { put("bitDepth", it) }
      if (pcm) { put("downmixed", downmixed); put("resampled", resampled) }
      lossless(source, track, pcm, downmixed || resampled)?.let { put("lossless", it) }
      // A bitstream carries the objects to the receiver; decoding to PCM keeps the channel bed only.
      if (!pcm) AvFormats.immersive(source?.sampleMimeType, atmos)?.let { put("immersive", it) }
      if (pcm) audioDecoder?.let { put("decoderName", it) }
      route?.let { put("route", it.route) }
    }
  }

  /** Lossless when the bitstream passes unchanged, or a lossless source decodes into enough PCM bits. */
  private fun lossless(source: Format?, track: AudioSink.AudioTrackConfig, pcm: Boolean, changed: Boolean): Boolean? {
    if (!pcm) return true
    val codec = source?.let(::sourceAudioCodec) ?: return null
    val losslessSource = codec == "truehd" || codec == "mlp" || codec == "flac" || codec == "alac" || codec.startsWith("pcm")
    if (!losslessSource) return if (codec == "dts") null else false
    if (changed) return false
    val sourceBits = pcmBits(source.pcmEncoding) ?: if (codec == "truehd" || codec == "mlp") 24 else null
    val outputBits = if (track.encoding == C.ENCODING_PCM_FLOAT) 24 else pcmBits(track.encoding) ?: return null
    return sourceBits?.let { it <= outputBits }
  }

  private fun sourceAudioCodec(format: Format): String? {
    if (format.sampleMimeType != MimeTypes.AUDIO_RAW) return AvFormats.audioCodec(format.sampleMimeType)
    return when (format.pcmEncoding) {
      C.ENCODING_PCM_8BIT -> "pcm_u8"
      C.ENCODING_PCM_16BIT -> "pcm_s16le"
      C.ENCODING_PCM_16BIT_BIG_ENDIAN -> "pcm_s16be"
      C.ENCODING_PCM_24BIT -> "pcm_s24le"
      C.ENCODING_PCM_24BIT_BIG_ENDIAN -> "pcm_s24be"
      C.ENCODING_PCM_32BIT -> "pcm_s32le"
      C.ENCODING_PCM_32BIT_BIG_ENDIAN -> "pcm_s32be"
      C.ENCODING_PCM_FLOAT -> "pcm_f32le"
      else -> "pcm"
    }
  }

  private fun pcmBits(encoding: Int): Int? =
    if (encoding == Format.NO_VALUE || !Util.isEncodingLinearPcm(encoding)) null else Util.getByteDepth(encoding) * 8

  private fun transfer(format: Format): String? = when (format.colorInfo?.colorTransfer) {
    C.COLOR_TRANSFER_ST2084 -> "pq"
    C.COLOR_TRANSFER_HLG -> "hlg"
    C.COLOR_TRANSFER_SDR, C.COLOR_TRANSFER_GAMMA_2_2, C.COLOR_TRANSFER_SRGB, C.COLOR_TRANSFER_LINEAR -> "sdr"
    else -> null
  }

  private fun range(format: Format, transfer: String?): String? =
    if (format.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION) "dv" else baseRange(transfer)

  private fun baseRange(transfer: String?): String? = when (transfer) {
    "pq" -> "hdr10"
    "hlg" -> "hlg"
    "sdr" -> "sdr"
    else -> null
  }
}
