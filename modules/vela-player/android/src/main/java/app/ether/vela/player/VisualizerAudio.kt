package app.ether.vela.player

import java.nio.ByteBuffer
import java.util.concurrent.locks.ReentrantLock
import kotlin.math.roundToLong

/** One music deck's post-EQ, post-fade PCM in the sink's (continuous across items) clock.
 * Both ends may skip work. The playback thread never waits for the visualizer. */
internal class VisualizerAudio {
  companion object {
    const val RATE = 48_000
    const val WINDOW = 4096
  }
  private val lock = ReentrantLock()
  private val mono = FloatArray(1 shl 18)
  private var first = 0L
  private var end = 0L

  fun write(output: ByteBuffer, frames: Int, channels: Int, rate: Int, float: Boolean, itemFrame: Double, offsetUs: Long) {
    if (!lock.tryLock()) return
    try {
      val start = (itemFrame * RATE / rate + offsetUs * (RATE / 1e6)).roundToLong()
      val stop = ((itemFrame + frames) * RATE / rate + offsetUs * (RATE / 1e6)).roundToLong()
      if (start != end) first = start
      val bytes = if (float) 4 else 2
      for (frame in start until stop) {
        val source = (((frame - start) * rate / RATE).toInt().coerceAtMost(frames - 1)) * channels * bytes
        var sum = 0f
        for (ch in 0 until channels) {
          val at = source + ch * bytes
          sum += if (float) output.getFloat(at) else output.getShort(at) / 32768f
        }
        mono[frame.toInt() and (mono.size - 1)] = sum / channels
      }
      first = maxOf(first, stop - mono.size)
      end = stop
    } finally { lock.unlock() }
  }

  fun add(heardUs: Long, dest: FloatArray) {
    if (!lock.tryLock()) return
    try {
      val pos = (heardUs * (RATE / 1e6)).roundToLong() - dest.size
      for (i in maxOf(first - pos, 0L) until minOf(end - pos, dest.size.toLong())) {
        dest[i.toInt()] += mono[(pos + i).toInt() and (mono.size - 1)]
      }
    } finally { lock.unlock() }
  }
}
