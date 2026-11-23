// Subtitle delay (the CC menu's subtitleOffset) for every format Media3's text renderer draws: text, and the
// bitmap formats (PGS, VobSub, DVB) that arrive as the same parsed cue samples. The renderer runs `offset`
// behind the playback clock, so a positive delay shows cues later and a negative one earlier (reading cues
// already buffered ahead). libass draws ASS/SSA by time itself and takes the same offset (Media3Engine).
//
// The text renderer drops cues once they have passed, so a larger delay, which moves its clock back, would
// lose the cue that belongs on screen now. The renderer's stream keeps the samples it has handed over for a
// while, and a change of delay resets the renderer at its new position and hands it those again: the cue
// moves at once, without a seek.
package app.ether.vela.player

import android.os.Bundle
import android.os.Parcel
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.exoplayer.FormatHolder
import androidx.media3.exoplayer.ForwardingRenderer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.RendererConfiguration
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.SampleStream

/** The delay the engine sets on the main thread and the renderer reads on the playback thread. */
internal class SubtitleDelay {
  @Volatile var offsetUs: Long = 0L

  fun set(seconds: Double) { offsetUs = (seconds * 1_000_000).toLong() }
}

internal class DelayedTextRenderer(renderer: Renderer, private val delay: SubtitleDelay) : ForwardingRenderer(renderer) {
  /** The delay the renderer's clock runs at now. */
  private var applied = 0L
  /** The period's own stream: the player recognises the renderer's stream by identity. */
  private var source: SampleStream? = null
  private var stream: ReplayingSampleStream? = null
  private var streamOffsetUs = 0L

  override fun enable(
    configuration: RendererConfiguration,
    formats: Array<Format>,
    stream: SampleStream,
    positionUs: Long,
    joining: Boolean,
    mayRenderStartOfStream: Boolean,
    startPositionUs: Long,
    offsetUs: Long,
    mediaPeriodId: MediaSource.MediaPeriodId,
  ) {
    applied = delay.offsetUs
    super.enable(configuration, formats, wrap(stream, offsetUs), positionUs - applied, joining, mayRenderStartOfStream,
      startPositionUs - applied, offsetUs, mediaPeriodId)
  }

  override fun replaceStream(
    formats: Array<Format>,
    stream: SampleStream,
    startPositionUs: Long,
    offsetUs: Long,
    mediaPeriodId: MediaSource.MediaPeriodId,
  ) = super.replaceStream(formats, wrap(stream, offsetUs), startPositionUs - applied, offsetUs, mediaPeriodId)

  override fun getStream(): SampleStream? = if (super.getStream() == null) null else source

  override fun resetPosition(positionUs: Long, sampleStreamIsResetToKeyFrame: Boolean) {
    // A seek: the stream now reads from the new position, and what it handed over earlier is stale.
    stream?.forget()
    applied = delay.offsetUs
    super.resetPosition(positionUs - applied, sampleStreamIsResetToKeyFrame)
  }

  override fun render(positionUs: Long, elapsedRealtimeUs: Long) {
    val offset = delay.offsetUs
    if (offset != applied) {
      applied = offset
      val at = positionUs - offset
      stream?.rewind(at - streamOffsetUs)
      super.resetPosition(at, /* sampleStreamIsResetToKeyFrame= */ true)
      // The renderer takes one sample per call: hand it the replayed ones now, not one per frame.
      for (turn in 0 until REPLAY_MAX) {
        val left = stream?.replayCount ?: 0
        if (left == 0) break
        super.render(at, elapsedRealtimeUs)
        // A cue more than a second ahead waits for the clock.
        if (stream?.replayCount == left) break
      }
    }
    super.render(positionUs - offset, elapsedRealtimeUs)
  }

  override fun getDurationToProgressUs(positionUs: Long, elapsedRealtimeUs: Long): Long =
    super.getDurationToProgressUs(positionUs - applied, elapsedRealtimeUs)

  override fun disable() {
    stream?.forget()
    source = null
    stream = null
    super.disable()
  }

  private fun wrap(upstream: SampleStream, offsetUs: Long): SampleStream {
    source = upstream
    streamOffsetUs = offsetUs
    return ReplayingSampleStream(upstream).also { stream = it }
  }

  private companion object {
    const val REPLAY_MAX = 256
  }
}

/** A sample stream that keeps what it read (ten minutes, 32 MB at most) and can hand part of it over again
 * before it goes on reading upstream. Each sample is a whole parsed cue list (Media3's CueEncoder: a Bundle with
 * its duration), so replaying one is safe; one without a duration lasts until the next. */
internal class ReplayingSampleStream(private val upstream: SampleStream) : SampleStream {
  private class Sample(val timeUs: Long, val keyFrame: Boolean, val data: ByteArray, val durationUs: Long)

  private val kept = ArrayDeque<Sample>()
  private var keptBytes = 0L
  private val replay = ArrayDeque<Sample>()

  val replayCount: Int get() = replay.size

  /** Hands over again, in order, what was read that is still on at `fromUs` (stream time) or comes later. */
  fun rewind(fromUs: Long) {
    replay.clear()
    kept.forEachIndexed { index, sample -> if (end(index) > fromUs) replay.addLast(sample) }
    while (replay.size > MAX_REPLAYED) replay.removeFirst()
  }

  private fun end(index: Int): Long {
    val sample = kept[index]
    if (sample.durationUs != C.TIME_UNSET) return sample.timeUs + sample.durationUs
    return kept.getOrNull(index + 1)?.timeUs ?: Long.MAX_VALUE
  }

  fun forget() {
    kept.clear()
    keptBytes = 0
    replay.clear()
  }

  override fun isReady(): Boolean = replay.isNotEmpty() || upstream.isReady

  override fun maybeThrowError() = upstream.maybeThrowError()

  override fun readData(formatHolder: FormatHolder, buffer: DecoderInputBuffer, readFlags: Int): Int {
    val sample = replay.firstOrNull()
    if (sample == null || readFlags and SampleStream.FLAG_REQUIRE_FORMAT != 0) {
      val result = upstream.readData(formatHolder, buffer, readFlags)
      if (result == C.RESULT_BUFFER_READ && !buffer.isEndOfStream &&
        readFlags and (SampleStream.FLAG_PEEK or SampleStream.FLAG_OMIT_SAMPLE_DATA) == 0) keep(buffer)
      return result
    }
    buffer.timeUs = sample.timeUs
    buffer.setFlags(if (sample.keyFrame) C.BUFFER_FLAG_KEY_FRAME else 0)
    if (readFlags and SampleStream.FLAG_OMIT_SAMPLE_DATA == 0) {
      buffer.ensureSpaceForWrite(sample.data.size)
      buffer.data!!.put(sample.data)
    }
    if (readFlags and SampleStream.FLAG_PEEK == 0) replay.removeFirst()
    return C.RESULT_BUFFER_READ
  }

  override fun skipData(positionUs: Long): Int = if (replay.isNotEmpty()) 0 else upstream.skipData(positionUs)

  private fun keep(buffer: DecoderInputBuffer) {
    val data = buffer.data ?: return
    val bytes = ByteArray(data.position())
    data.duplicate().apply { flip() }.get(bytes)
    kept.addLast(Sample(buffer.timeUs, buffer.isKeyFrame, bytes, durationUs(bytes)))
    keptBytes += bytes.size
    while (kept.size > 1 && (keptBytes > MAX_KEPT_BYTES || end(0) < buffer.timeUs - KEPT_US)) {
      keptBytes -= kept.removeFirst().data.size
    }
  }

  /** The cue list's duration (CueDecoder's "d"; Media3 1.11), without decoding its cues or bitmaps. */
  private fun durationUs(bytes: ByteArray): Long {
    val parcel = Parcel.obtain()
    return try {
      parcel.unmarshall(bytes, 0, bytes.size)
      parcel.setDataPosition(0)
      parcel.readBundle(Bundle::class.java.classLoader)?.getLong("d", C.TIME_UNSET) ?: C.TIME_UNSET
    } catch (_: RuntimeException) {
      C.TIME_UNSET
    } finally {
      parcel.recycle()
    }
  }

  private companion object {
    /** Longer than the longest delay (ten minutes). */
    const val KEPT_US = 660_000_000L
    const val MAX_KEPT_BYTES = 32L * 1024 * 1024
    const val MAX_REPLAYED = 256
  }
}
