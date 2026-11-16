// What this device's libmpv plays, declared to the server (packages/player-api PlayerCapabilities).
// Video is what MediaCodec decodes in hardware (mpv's software decoders could take the rest, but not
// at 4K in real time on a TV's processor); audio and subtitles are all decoded by FFmpeg on the device.
// The same shape as the Apple probe (ios/PlayerCapabilities.swift).
package app.ether.vela.player

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build

internal object PlayerCapabilities {
  /** MediaCodec MIME types and the names Vela's protocol gives their codecs. */
  private val videoTypes = listOf(
    "video/hevc" to "hevc",
    "video/av01" to "av1",
    "video/x-vnd.on2.vp9" to "vp9",
  )

  private val audio = listOf(
    "aac", "ac3", "eac3", "dts", "truehd", "mlp", "flac", "alac", "opus", "vorbis", "mp3", "mp2",
    "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_bluray", "pcm_dvd",
  )

  val probed: Map<String, Any> by lazy { probe() }

  private fun probe(): Map<String, Any> {
    val decoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder && hardware(it) }
    val decodable = decoders.flatMap { decoder -> decoder.supportedTypes.map { it.lowercase() } }.toSet()
    val video = listOf("h264") + videoTypes.filter { (type, _) -> type in decodable }.map { it.second }
    return mapOf(
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
        "demuxContainers" to listOf("mkv", "webm", "mp4", "mpegts"),
        "videoDecoders" to video,
        "audioDecoders" to audio,
      ),
    )
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
