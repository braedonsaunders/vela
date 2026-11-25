// The PCM tap: an AudioProcessor at the head of DefaultAudioSink's chain, the mechanism Vela's VelaSound uses
// (modules/vela-player/android/.../VelaSound.kt). It hands the decoded PCM, mixed to mono, to the native ring
// buffer indexed by media frame, and outputs silence: nothing this spike plays is ever audible, but the
// AudioTrack still runs, so its clock and underruns are real.
@file:OptIn(UnstableApi::class)

package app.vela.vizspike

import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.nio.ByteBuffer

class VizTap : BaseAudioProcessor() {
  private var mono = FloatArray(4096)
  /** The media frame (item clock, in samples) of the next input frame. */
  private var frame = 0L

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    // Never NOT_SET: an inactive processor is bypassed, and the music would be heard.
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT)
      throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
    return inputAudioFormat
  }

  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
    val offset = streamMetadata.positionOffsetUs
    frame = if (offset == C.TIME_UNSET) 0 else offset * inputAudioFormat.sampleRate / 1_000_000
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val format = inputAudioFormat
    val channels = format.channelCount
    val float = format.encoding == C.ENCODING_PCM_FLOAT
    val bytes = if (float) 4 else 2
    val frames = inputBuffer.remaining() / (channels * bytes)
    if (frames == 0) return
    if (mono.size < frames) mono = FloatArray(frames)
    val scale = 1f / channels
    for (f in 0 until frames) {
      var s = 0f
      for (c in 0 until channels) s += if (float) inputBuffer.getFloat() else inputBuffer.getShort() / 32768f
      mono[f] = s * scale
    }
    Native.tapWrite(mono, frames, frame, format.sampleRate)
    frame += frames
    // Silence out, same length.
    val size = frames * channels * bytes
    val output = replaceOutputBuffer(size)
    var left = size
    while (left >= 8) { output.putLong(0L); left -= 8 }
    while (left > 0) { output.put(0); left-- }
    output.flip()
  }
}

/** What the sink last reported as heard: item-clock µs at elapsedRealtimeNanos [atNs]. */
class Heard(val positionUs: Long, val atNs: Long)

/**
 * DefaultAudioSink, keeping what is heard for the GL thread (as VelaSoundSink does): the sink's position already
 * accounts for the AudioTrack's latency, so it is the speaker's clock, behind the tap by the sink's buffer.
 */
class HeardSink(sink: AudioSink) : ForwardingAudioSink(sink) {
  private var offsetUs = 0L
  @Volatile private var playing = false
  @Volatile private var heard: Heard? = null

  /** The item-clock position heard now (µs), extrapolated from the sink's last report; -1 if unknown. */
  fun heardNowUs(): Long {
    val last = heard ?: return -1
    if (!playing) return last.positionUs
    return last.positionUs + (SystemClock.elapsedRealtimeNanos() - last.atNs) / 1000
  }

  override fun setOutputStreamOffsetUs(outputStreamOffsetUs: Long) {
    offsetUs = outputStreamOffsetUs
    super.setOutputStreamOffsetUs(outputStreamOffsetUs)
  }

  override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
    val position = super.getCurrentPositionUs(sourceEnded)
    if (position != AudioSink.CURRENT_POSITION_NOT_SET) heard = Heard(position - offsetUs, SystemClock.elapsedRealtimeNanos())
    return position
  }

  override fun play() { playing = true; super.play() }
  override fun pause() { playing = false; super.pause() }
  override fun flush() { heard = null; super.flush() }
  override fun reset() { playing = false; heard = null; super.reset() }
}
