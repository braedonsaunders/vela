// Sound (docs/sound.md, Android): the audio player's levelling gain, the equalizer and AutoMix's fades,
// applied to decoded PCM by an AudioProcessor at the head of DefaultAudioSink's chain (before Sonic, so
// speed never changes the EQ). One processor per ExoPlayer. The EQ is Robert Bristow-Johnson's cookbook
// exactly as Web Audio's BiquadFilterNode and packages/core/src/audio/eq.ts define it, so a preset sounds
// the same on every platform.
//
// Which item's PCM the processor holds: within one playlist ExoPlayer does not flush between items, but
// every renderer moves the sink to the next item's stream offset (setOutputStreamOffsetUs) after the
// previous item's last buffer and before the next item's first, and the sink then drains the processors
// and flushes them before that first buffer. VelaSoundSink passes the offset change on, and the processor
// switches to the next item's gain at that flush: the switch lands on the item's first sample.
package app.ether.vela.player

import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** One EQ filter (NativeEqFilter in modules/vela-player/src/audio.ts). */
internal data class EqFilter(val type: String, val frequency: Double, val q: Double, val gainDb: Double)

/** A gain before the filters (dB), then the filters in order. */
internal data class EqChain(val preGainDb: Double, val filters: List<EqFilter>) {
  companion object {
    /** JavaScript's `eq` (null, or { preGainDb, filters }); null for none or a malformed value. */
    fun from(value: Any?): EqChain? {
      val map = value as? Map<*, *> ?: return null
      val filters = (map["filters"] as? List<*>).orEmpty().mapNotNull { item ->
        val filter = item as? Map<*, *> ?: return@mapNotNull null
        val type = filter["type"] as? String ?: return@mapNotNull null
        if (type !in listOf("lowshelf", "peaking", "highshelf")) return@mapNotNull null
        EqFilter(type, (filter["frequency"] as? Number)?.toDouble() ?: return@mapNotNull null,
          (filter["q"] as? Number)?.toDouble() ?: Math.sqrt(2.0), (filter["gainDb"] as? Number)?.toDouble() ?: 0.0)
      }
      return EqChain((map["preGainDb"] as? Number)?.toDouble() ?: 0.0, filters)
    }
  }
}

/** Normalised biquad coefficients (a0 = 1): y = b0·x + b1·x1 + b2·x2 − a1·y1 − a2·y2. */
internal data class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double)

private val PASS = Biquad(1.0, 0.0, 0.0, 0.0, 0.0)

/** A filter's coefficients at a sample rate: eq.ts `biquad()`, formula for formula. A frequency at or
 * above Nyquist passes the shelf's gain (high shelf) or nothing changes (peaking, low shelf). */
internal fun biquad(filter: EqFilter, sampleRate: Double): Biquad {
  val nyquist = sampleRate / 2
  val a = 10.0.pow(filter.gainDb / 40)
  if (filter.frequency >= nyquist) return if (filter.type == "highshelf") Biquad(a * a, 0.0, 0.0, 0.0, 0.0) else PASS
  // Not reachable from the app's chains; Web Audio clamps these, and a zero would put poles on the unit circle.
  if (filter.frequency <= 0 || (filter.type == "peaking" && filter.q <= 0)) return PASS
  val w0 = (2 * PI * filter.frequency) / sampleRate
  val cos = cos(w0)
  val sin = sin(w0)
  val b0: Double; val b1: Double; val b2: Double; val a0: Double; val a1: Double; val a2: Double
  if (filter.type == "peaking") {
    val alpha = sin / (2 * filter.q)
    b0 = 1 + alpha * a; b1 = -2 * cos; b2 = 1 - alpha * a
    a0 = 1 + alpha / a; a1 = -2 * cos; a2 = 1 - alpha / a
  } else {
    // Shelf slope 1.
    val alpha = (sin / 2) * sqrt(2.0)
    val root = 2 * sqrt(a) * alpha
    if (filter.type == "lowshelf") {
      b0 = a * ((a + 1) - (a - 1) * cos + root); b1 = 2 * a * ((a - 1) - (a + 1) * cos); b2 = a * ((a + 1) - (a - 1) * cos - root)
      a0 = (a + 1) + (a - 1) * cos + root; a1 = -2 * ((a - 1) + (a + 1) * cos); a2 = (a + 1) + (a - 1) * cos - root
    } else {
      b0 = a * ((a + 1) + (a - 1) * cos + root); b1 = -2 * a * ((a - 1) + (a + 1) * cos); b2 = a * ((a + 1) + (a - 1) * cos - root)
      a0 = (a + 1) - (a - 1) * cos + root; a1 = 2 * ((a - 1) - (a + 1) * cos); a2 = (a + 1) - (a - 1) * cos - root
    }
  }
  return Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
}

/** The EQ running at one sample rate: the pre-gain, then the biquads in Direct Form I (double), with
 * each channel's history. No EQ is an empty chain at unity. */
private class Filters(chain: EqChain?, rate: Int, val channels: Int) {
  val pre = if (chain == null) 1.0 else 10.0.pow(chain.preGainDb / 20)
  val stages = chain?.filters.orEmpty().map { biquad(it, rate.toDouble()) }.filter { it != PASS }.toTypedArray()
  /** x1, x2, y1, y2 per stage per channel. */
  val state = DoubleArray(channels * stages.size * 4)
  val dry = stages.isEmpty() && pre == 1.0

  fun process(channel: Int, input: Double): Double {
    var x = input * pre
    var k = channel * stages.size * 4
    for (s in stages) {
      val y = s.b0 * x + s.b1 * state[k] + s.b2 * state[k + 1] - s.a1 * state[k + 2] - s.a2 * state[k + 3]
      state[k + 1] = state[k]; state[k] = x
      state[k + 3] = state[k + 2]; state[k + 2] = y
      x = y
      k += 4
    }
    return x
  }

  /** Carries a running chain's history over (same shape), so a preset change starts warm. */
  fun warmFrom(old: Filters) {
    if (old.stages.size == stages.size && old.channels == channels) old.state.copyInto(state)
  }
}

/** An equal-power fade over an item's own clock: out (cos) from `startUs`, or in (sin). */
internal data class Fade(val itemId: Int, val startUs: Long, val durationUs: Long, val incoming: Boolean)

/** How long a gain or EQ change glides (a levelling change, the EQ, a new preset): never a click. */
private const val GLIDE_SECONDS = 0.010

internal class VelaSoundProcessor(val deck: Int) : BaseAudioProcessor() {
  // Set on the main thread, read by the playback thread under `lock`.
  private val lock = Any()
  private val gains = HashMap<Int, Double>()
  private val nextOf = HashMap<Int, Int>()
  private var sharedEq: EqChain? = null
  private var eqVersion = 0
  private var resetId = 0
  private var resetGeneration = 0
  private var sharedFades = emptyList<Fade>()

  /** The media position (µs, the item's own clock) of the next frame the processor takes, and its item.
   * Ahead of what is heard by the sink's buffer. */
  @Volatile var positionUs = 0L
    private set
  @Volatile var processingId = 0
    private set

  // The playback thread's own.
  private var itemId = 0
  private var appliedGeneration = 0
  private var awaitingFirstOffset = true
  private val itemOffsets = HashMap<Long, Int>()
  private var newestOffset = Long.MIN_VALUE
  private var pendingItem: Int? = null
  private var appliedEqVersion = -1
  private var eqChain: EqChain? = null
  private var filters: Filters? = null
  private var oldFilters: Filters? = null
  private var eqGlideLeft = 0
  private var eqGlideFrames = 1
  private var level = 1.0
  private var levelTarget = 1.0
  private var levelStep = 0.0
  private var levelGlideLeft = 0
  private var fades = emptyList<Fade>()
  /** The media frame (item clock) of the next input frame. */
  private var frame = 0.0
  /** Nothing processed since the item was loaded: a gain set now applies at once. */
  private var fresh = true
  private var capture: SoundCapture.Deck? = null

  @Volatile var visualizer: VisualizerAudio? = null
  private var visualizerOffset = 0L
  private var nextVisualizerOffset = 0L

  // Commands (main thread)

  /** A new item loaded into this processor's player (its playlist starts over). */
  fun reset(id: Int, gain: Double) = synchronized(lock) {
    gains.clear(); nextOf.clear()
    gains[id] = gain
    resetId = id
    resetGeneration++
    sharedFades = emptyList()
  }

  /** The item queued behind `after` in the same playlist (gapless), with its levelling. */
  fun queue(after: Int, id: Int, gain: Double) = synchronized(lock) {
    nextOf[after] = id
    gains[id] = gain
  }

  /** Nothing queued behind `after` any more. */
  fun dequeue(after: Int) = synchronized(lock) { nextOf.remove(after)?.let { gains.remove(it) } }

  /** The levelling gain of item `id` (linear). It glides if that item is playing. */
  fun setGain(id: Int, gain: Double) = synchronized(lock) { gains[id] = gain }

  fun setEq(chain: EqChain?) = synchronized(lock) {
    if (chain != sharedEq) { sharedEq = chain; eqVersion++ }
  }

  fun setFades(fades: List<Fade>) = synchronized(lock) { sharedFades = fades }

  // Item tracking (playback thread, from VelaSoundSink)

  /** The sink moved to a stream offset: a new item's stream when it is new, or an earlier one again. */
  fun onStreamOffset(offsetUs: Long) {
    nextVisualizerOffset = offsetUs
    synchronized(lock) { applyReset() }
    if (awaitingFirstOffset) {
      awaitingFirstOffset = false
      itemOffsets[offsetUs] = itemId
      newestOffset = offsetUs
      return
    }
    val known = itemOffsets[offsetUs]
    if (known != null) {
      if (known != itemId) pendingItem = known
    } else if (offsetUs > newestOffset) {
      // The next item in the playlist: the one queued behind the newest item seen. An unknown one plays at unity.
      val newest = itemOffsets[newestOffset] ?: itemId
      val next = synchronized(lock) { nextOf[newest] } ?: -1
      itemOffsets[offsetUs] = next
      newestOffset = offsetUs
      pendingItem = next
    }
  }

  fun onSinkPosition(positionUs: Long, offsetUs: Long) {
    capture?.position(positionUs, offsetUs)
  }

  /** Under `lock`: a load from the main thread starts the item map over. */
  private fun applyReset() {
    if (appliedGeneration == resetGeneration) return
    appliedGeneration = resetGeneration
    itemOffsets.clear()
    newestOffset = Long.MIN_VALUE
    awaitingFirstOffset = true
    pendingItem = null
    itemId = resetId
    processingId = itemId
    level = gains[itemId] ?: 1.0
    levelTarget = level
    levelGlideLeft = 0
    fresh = true
  }

  // AudioProcessor (playback thread)

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) return AudioProcessor.AudioFormat.NOT_SET
    return inputAudioFormat
  }

  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
    val format = inputAudioFormat
    synchronized(lock) { applyReset() }
    visualizerOffset = nextVisualizerOffset
    val offset = streamMetadata.positionOffsetUs
    frame = if (offset == C.TIME_UNSET) 0.0 else offset * format.sampleRate / 1_000_000.0
    // A new item's first sample: its own gain, at once (the boundary between two songs, not a glide).
    pendingItem?.let { next ->
      pendingItem = null
      itemId = next
      processingId = next
      val gain = synchronized(lock) { gains[next] } ?: 1.0
      level = gain; levelTarget = gain; levelGlideLeft = 0
      capture?.segment("item", frame, itemId)
    }
    if (levelGlideLeft > 0) { level = levelTarget; levelGlideLeft = 0 }
    // The EQ keeps its history across a flush (a gapless join must not restart the filters), unless the format changed.
    val current = filters
    if (current == null || current.channels != format.channelCount || appliedRate != format.sampleRate) {
      appliedRate = format.sampleRate
      filters = Filters(eqChain, format.sampleRate, format.channelCount)
      oldFilters = null
      eqGlideLeft = 0
    }
    capture?.segment("flush", frame, itemId)
    positionUs = (frame * 1_000_000.0 / format.sampleRate).toLong()
  }

  private var appliedRate = 0

  override fun onReset() {
    filters = null
    oldFilters = null
    appliedRate = 0
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val format = inputAudioFormat
    val channels = format.channelCount
    val float = format.encoding == C.ENCODING_PCM_FLOAT
    val bytes = if (float) 4 else 2
    val frames = inputBuffer.remaining() / (channels * bytes)
    if (frames == 0) return
    sync(format.sampleRate, channels)
    val output = replaceOutputBuffer(frames * channels * bytes)
    val capture = capture
    val chain = filters!!
    val rate = format.sampleRate.toDouble()
    for (f in 0 until frames) {
      if (levelGlideLeft > 0) { levelGlideLeft--; level = if (levelGlideLeft == 0) levelTarget else level + levelStep }
      val gain = level * envelope(rate)
      val mix = if (eqGlideLeft > 0) eqGlideLeft.toDouble() / eqGlideFrames else 0.0
      val old = if (eqGlideLeft > 0) oldFilters else null
      for (c in 0 until channels) {
        val x = if (float) inputBuffer.getFloat().toDouble() else inputBuffer.getShort() / 32768.0
        var y = if (chain.dry) x else chain.process(c, x)
        if (mix > 0) y = (old?.process(c, x) ?: x) * mix + y * (1 - mix)
        y *= gain
        if (float) {
          val v = y.toFloat()
          capture?.sample(v)
          output.putFloat(if (capture != null) 0f else v)
        } else {
          val v = (y * 32768.0).roundToInt().coerceIn(-32768, 32767).toShort()
          capture?.sample(v / 32768f)
          output.putShort(if (capture != null) 0 else v)
        }
      }
      if (eqGlideLeft > 0 && --eqGlideLeft == 0) oldFilters = null
      frame += 1.0
    }
    output.flip()
    visualizer?.write(output, frames, channels, format.sampleRate, float, frame - frames, visualizerOffset)
    fresh = false
    positionUs = (frame * 1_000_000.0 / rate).toLong()
  }

  /** The fade gain at the current frame: 1 outside any fade of this item. */
  private fun envelope(rate: Double): Double {
    var gain = 1.0
    for (fade in fades) {
      if (fade.itemId != itemId) continue
      val x = ((frame - fade.startUs * rate / 1_000_000.0) / (fade.durationUs * rate / 1_000_000.0)).coerceIn(0.0, 1.0)
      gain *= if (fade.incoming) sin(x * PI / 2) else cos(x * PI / 2)
    }
    return gain
  }

  /** Picks up the main thread's changes at the start of a buffer. */
  private fun sync(rate: Int, channels: Int) {
    var target: Double
    synchronized(lock) {
      applyReset()
      target = gains[itemId] ?: 1.0
      fades = sharedFades
      if (appliedEqVersion != eqVersion) {
        appliedEqVersion = eqVersion
        eqChain = sharedEq
        val previous = filters
        val next = Filters(eqChain, rate, channels)
        if (previous != null && !fresh) {
          next.warmFrom(previous)
          oldFilters = previous
          eqGlideFrames = (GLIDE_SECONDS * rate).toInt().coerceAtLeast(1)
          eqGlideLeft = eqGlideFrames
        }
        filters = next
        appliedRate = rate
      }
    }
    if (filters == null) { filters = Filters(eqChain, rate, channels); appliedRate = rate }
    if (target != levelTarget) {
      if (fresh) { level = target; levelTarget = target; levelGlideLeft = 0 }
      else {
        levelTarget = target
        levelGlideLeft = (GLIDE_SECONDS * rate).toInt().coerceAtLeast(1)
        levelStep = (target - level) / levelGlideLeft
      }
    }
    val wanted = SoundCapture.deck(this, rate, channels)
    if (wanted !== capture) {
      capture = wanted
      wanted?.segment("start", frame, itemId)
    }
  }
}

/** What the sink last said is heard: the item-clock position (µs) at elapsedRealtimeNanos `atNs`. */
internal class Heard(val positionUs: Long, val rendererUs: Long, val atNs: Long, val playing: Boolean)

/** DefaultAudioSink with the processor told which stream (item) its next buffers belong to, and the
 * heard position kept for the main thread (ExoPlayer's own getCurrentPosition is only as fresh as the
 * playback thread's last update, tens of milliseconds and more). */
internal class VelaSoundSink(sink: AudioSink, private val sound: VelaSoundProcessor) : ForwardingAudioSink(sink) {
  @Volatile var decodedPcm = true
    private set

  override fun configure(audioSinkConfig: AudioSink.AudioSinkConfig) {
    super.configure(audioSinkConfig)
    val decoded = audioSinkConfig.format.sampleMimeType == MimeTypes.AUDIO_RAW
    if (decoded != decodedPcm) {
      decodedPcm = decoded
      AudioPlayback.visualizerFormatChanged()
    }
  }

  private var offsetUs = 0L
  private var playing = false
  @Volatile var heard: Heard? = null
    private set

  /** The heard position now (item clock, µs), extrapolated from the sink's last report; null if unknown or stopped. */
  fun heardNowUs(speed: Double): Long? {
    val last = heard ?: return null
    if (!last.playing) return null
    return last.positionUs + ((SystemClock.elapsedRealtimeNanos() - last.atNs) / 1000.0 * speed).toLong()
  }

  fun heardRendererUs(speed: Double): Long? {
    val last = heard ?: return null
    if (!last.playing) return null
    return last.rendererUs + ((SystemClock.elapsedRealtimeNanos() - last.atNs) / 1000.0 * speed).toLong()
  }

  override fun setOutputStreamOffsetUs(outputStreamOffsetUs: Long) {
    offsetUs = outputStreamOffsetUs
    sound.onStreamOffset(outputStreamOffsetUs)
    super.setOutputStreamOffsetUs(outputStreamOffsetUs)
  }

  override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
    val position = super.getCurrentPositionUs(sourceEnded)
    if (position != AudioSink.CURRENT_POSITION_NOT_SET) {
      heard = Heard(position - offsetUs, position, SystemClock.elapsedRealtimeNanos(), playing)
      sound.onSinkPosition(position, offsetUs)
    }
    return position
  }

  override fun play() { playing = true; super.play() }
  override fun pause() { playing = false; heard = null; super.pause() }
  override fun flush() { heard = null; sound.visualizer?.invalidate(); super.flush() }
  override fun reset() { playing = false; heard = null; sound.visualizer?.invalidate(); super.reset() }
}

/**
 * A debug capture for measuring the engine (audioCapture): every processor writes what it outputs (after
 * levelling, EQ and fades) to `<path>-deck<n>.wav` (32-bit float) and sends silence to the device instead,
 * so nothing is heard. `<path>-deck<n>.json` maps the captured frames to the item clock (`segments`: at
 * capture frame `at`, media frame `frame` of item `item`) and the item clock to the time it is heard
 * (`positions`: the sink's own position, as ExoPlayer reports it, against elapsedRealtimeNanos), so two
 * players' captures can be summed as heard. `marks` are engine events (a crossfade's commit and start).
 */
internal object SoundCapture {
  @Volatile private var path: String? = null
  private val decks = HashMap<VelaSoundProcessor, Deck>()
  private val marks = ArrayList<String>()

  fun start(path: String) = synchronized(this) {
    decks.clear(); marks.clear()
    this.path = path
  }

  /** Stops and writes the files; returns their paths. */
  fun stop(): List<String> = synchronized(this) {
    val prefix = path ?: return emptyList()
    path = null
    val written = ArrayList<String>()
    for (deck in decks.values) {
      val base = "$prefix-deck${deck.number}"
      deck.write(File("$base.wav"), File("$base.json"), marks)
      written += "$base.wav"
    }
    decks.clear(); marks.clear()
    written
  }

  fun mark(label: String) = synchronized(this) {
    if (path != null) marks += "{\"label\":\"$label\",\"ns\":${SystemClock.elapsedRealtimeNanos()}}"
  }

  /** The processor's capture while one runs (and its format matches), else null. */
  fun deck(processor: VelaSoundProcessor, rate: Int, channels: Int): Deck? {
    if (path == null) return null
    return synchronized(this) {
      if (path == null) return null
      val deck = decks[processor]
      if (deck != null && deck.rate == rate && deck.channels == channels) deck
      else if (deck != null) null
      else Deck(processor.deck, rate, channels).also { decks[processor] = it }
    }
  }

  class Deck(val number: Int, val rate: Int, val channels: Int) {
    private var samples = FloatArray(rate * channels * 40)
    private var count = 0
    private val segments = ArrayList<String>()
    private val positions = ArrayList<String>()
    private var lastPositionNs = 0L

    @Synchronized fun sample(value: Float) {
      if (count == samples.size) samples = samples.copyOf(samples.size * 2)
      samples[count++] = value
    }

    @Synchronized fun segment(reason: String, frame: Double, item: Int) {
      segments += "{\"reason\":\"$reason\",\"at\":${count / channels},\"frame\":$frame,\"item\":$item,\"ns\":${SystemClock.elapsedRealtimeNanos()}}"
    }

    @Synchronized fun position(positionUs: Long, offsetUs: Long) {
      val now = SystemClock.elapsedRealtimeNanos()
      if (now - lastPositionNs < 2_000_000) return
      lastPositionNs = now
      positions += "[$now,$positionUs,$offsetUs]"
    }

    @Synchronized fun write(wav: File, json: File, marks: List<String>) {
      val data = count * 4
      DataOutputStream(FileOutputStream(wav).buffered()).use { out ->
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(36 + data).put("WAVE".toByteArray())
        header.put("fmt ".toByteArray()).putInt(16).putShort(3).putShort(channels.toShort()).putInt(rate)
          .putInt(rate * channels * 4).putShort((channels * 4).toShort()).putShort(32)
        header.put("data".toByteArray()).putInt(data)
        out.write(header.array())
        val chunk = ByteBuffer.allocate(64 * 1024).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until count) {
          if (!chunk.hasRemaining()) { out.write(chunk.array(), 0, chunk.position()); chunk.clear() }
          chunk.putFloat(samples[i])
        }
        out.write(chunk.array(), 0, chunk.position())
      }
      json.writeText("{\"deck\":$number,\"rate\":$rate,\"channels\":$channels,\"frames\":${count / channels}," +
        "\"segments\":[${segments.joinToString(",")}],\"positions\":[${positions.joinToString(",")}],\"marks\":[${marks.joinToString(",")}]}")
    }
  }
}

internal data class VisualizerDeck(val audio: VisualizerAudio, val sink: VelaSoundSink, val speed: Double) {
  fun mix(pcm: FloatArray) {
    sink.heardRendererUs(speed)?.let { audio.add(it, pcm) }
  }
}
