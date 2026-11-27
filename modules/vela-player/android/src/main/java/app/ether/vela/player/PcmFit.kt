// Decoded PCM shaped to what the device can open (AudioRoute.pcmLimit). Two cases need it:
//
//   low-RAM   AudioFlinger gives a low-RAM device's app 1 MiB for all its track buffers. A 7.1 TrueHD track
//             decoded to float at 96 kHz with Media3's default 500 ms buffer (doubled for 2x speed) asked for
//             4 MiB on the lab's Allwinner H313 and was refused (error -12), so playback never started. Such a
//             device gets 16-bit PCM at 48 kHz at most, in a 250 ms buffer.
//   unknown   an HDMI source whose route is reported as its speaker (AudioRoute): the system mixer there may
//   sink      be stereo only and the sink unknown, so the player mixes to stereo itself.
//
// The limit also turns float output off: Media3's sink runs its audio processors (this downmix and rate cap)
// only on its 16-bit path, and the low-RAM mixer is 16-bit anyway.
package app.ether.vela.player

import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.audio.SonicAudioProcessor
import java.nio.ByteBuffer

internal data class PcmLimit(
  /** Decoded audio mixed down to this many channels, or null to keep the source's. */
  val maxChannels: Int?,
  /** Decoded audio resampled down to this rate, or null to keep the source's. */
  val maxSampleRate: Int?,
  /** The AudioTrack's PCM buffer at 1x (Media3's default is 500 ms), or null for the default. */
  val bufferUs: Int?,
) {
  /** The audio processors that apply it, ahead of Media3's own chain (speed). */
  fun processors(): Array<AudioProcessor> = listOfNotNull(
    maxChannels?.let { max -> ChannelMixingAudioProcessor().also { mixer ->
      for (channels in 1..8) mixer.putChannelMixingMatrix(downmix(channels, max)) } },
    maxSampleRate?.let(::RateCapProcessor),
  ).toTypedArray()

  companion object {
    /** The limit for a device, or null when PCM may go to the system as decoded. */
    fun of(lowRam: Boolean, unknownSink: Boolean): PcmLimit? = when {
      !lowRam && !unknownSink -> null
      else -> PcmLimit(
        maxChannels = if (unknownSink) 2 else null,
        maxSampleRate = if (lowRam) 48_000 else null,
        bufferUs = if (lowRam) 250_000 else null,
      )
    }

    /** `ro.hdmi.device_type` lists the CEC logical types a device takes: 4 is a playback device (a source
     * box), 0 a television. */
    fun hdmiSource(deviceTypes: String?): Boolean {
      val types = deviceTypes?.split(',')?.map { it.trim() }.orEmpty()
      return "4" in types && "0" !in types
    }

    /** A mix of `channels` (Android/Media3 order) down to `max` channels, or the identity when it fits. */
    fun downmix(channels: Int, max: Int): ChannelMixingMatrix =
      if (channels <= max) ChannelMixingMatrix(channels, channels, identity(channels))
      else ChannelMixingMatrix(channels, max, if (max == 1) mono(channels) else stereo(channels))

    private fun identity(n: Int) = FloatArray(n * n) { if (it / n == it % n) 1f else 0f }

    /** Input-major ([in][out]) stereo coefficients, as Android's own channel mix (audio_utils ChannelMix):
     * centre and surrounds at -3 dB, LFE at -6 dB, a back centre split between both sides. */
    fun stereo(channels: Int): FloatArray {
      val c = 0.7071f
      val rows: List<Pair<Float, Float>> = when (channels) {
        1 -> listOf(c to c)
        2 -> listOf(1f to 0f, 0f to 1f)
        // FL FR FC
        3 -> listOf(1f to 0f, 0f to 1f, c to c)
        // FL FR BL BR
        4 -> listOf(1f to 0f, 0f to 1f, c to 0f, 0f to c)
        // FL FR FC BL BR
        5 -> listOf(1f to 0f, 0f to 1f, c to c, c to 0f, 0f to c)
        // FL FR FC LFE BL BR
        6 -> listOf(1f to 0f, 0f to 1f, c to c, 0.5f to 0.5f, c to 0f, 0f to c)
        // FL FR FC LFE BL BR BC
        7 -> listOf(1f to 0f, 0f to 1f, c to c, 0.5f to 0.5f, c to 0f, 0f to c, 0.5f to 0.5f)
        // FL FR FC LFE BL BR SL SR
        else -> listOf(1f to 0f, 0f to 1f, c to c, 0.5f to 0.5f, c to 0f, 0f to c, c to 0f, 0f to c) +
          List(channels - 8) { 0f to 0f }
      }
      return rows.flatMap { listOf(it.first, it.second) }.toFloatArray()
    }

    private fun mono(channels: Int): FloatArray = stereo(channels).toList().chunked(2).map { (l, r) -> (l + r) * 0.7071f }.toFloatArray()
  }
}

/** Resamples PCM above `max` Hz down to it (Sonic); anything at or below passes through untouched. */
internal class RateCapProcessor(private val max: Int) : AudioProcessor {
  private val sonic = SonicAudioProcessor()

  override fun configure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    sonic.setOutputSampleRateHz(if (inputAudioFormat.sampleRate > max) max else SonicAudioProcessor.SAMPLE_RATE_NO_CHANGE)
    return sonic.configure(inputAudioFormat)
  }
  override fun isActive() = sonic.isActive
  override fun queueInput(inputBuffer: ByteBuffer) = sonic.queueInput(inputBuffer)
  override fun queueEndOfStream() = sonic.queueEndOfStream()
  override fun getOutput(): ByteBuffer = sonic.output
  override fun isEnded() = sonic.isEnded
  override fun flush(streamMetadata: AudioProcessor.StreamMetadata) = sonic.flush(streamMetadata)
  override fun getDurationAfterProcessorApplied(durationUs: Long) = sonic.getDurationAfterProcessorApplied(durationUs)
  override fun reset() = sonic.reset()
}

/** A bitstream (passthrough) output whose clock never moves while the player is ready and playing: some
 * HALs accept the track and then pause it on underrun forever (the lab's Allwinner H313 did with AC-3),
 * which holds the picture still. `check` answers true once, after `limitMs` without movement. */
internal class BitstreamStall(private val limitMs: Long = 8000) {
  private var since = -1L
  private var at = Long.MIN_VALUE
  private var fired = false

  fun check(bitstream: Boolean, playing: Boolean, positionMs: Long, nowMs: Long): Boolean {
    if (fired || !bitstream || !playing || positionMs != at) {
      at = positionMs
      since = if (bitstream && playing) nowMs else -1L
      return false
    }
    if (since < 0) since = nowMs
    if (nowMs - since < limitMs) return false
    fired = true
    return true
  }
}
