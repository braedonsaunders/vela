// Extractor-level taps on original files: every track passes through untouched except
//   - TrueHD, whose first access units are read (not changed) for the Atmos presentation flag, and
//   - Dolby Vision Profile 7, converted to 8.1 or reduced to its HDR10 base layer (DolbyVision.plan).
// Server HLS does not come through here; it never carries either.
package app.ether.vela.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.text.SubtitleParser
import java.io.EOFException

/** What the taps need of the device, and where they report (on the loading thread). */
internal class TapPolicy(
  val dolbyVisionDecoderProfiles: Set<Int>,
  val convertsDolbyVision: Boolean,
  val onTrueHd: (formatId: String?, atmos: Boolean) -> Unit,
  val onDolbyVision: (formatId: String?, profile: Int, action: DolbyVisionAction) -> Unit,
)

internal class TappedExtractorsFactory(private var base: ExtractorsFactory, private val policy: TapPolicy) : ExtractorsFactory {
  override fun createExtractors(): Array<Extractor> = wrap(base.createExtractors())
  override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>): Array<Extractor> =
    wrap(base.createExtractors(uri, responseHeaders))

  // Media3 configures subtitle parsing through the factory; it must reach the wrapped one.
  override fun experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled: Boolean): ExtractorsFactory =
    apply { base = base.experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled) }
  override fun setSubtitleParserFactory(subtitleParserFactory: SubtitleParser.Factory): ExtractorsFactory =
    apply { base = base.setSubtitleParserFactory(subtitleParserFactory) }
  override fun experimentalSetCodecsToParseWithinGopSampleDependencies(codecsToParseWithinGopSampleDependencies: Int): ExtractorsFactory =
    apply { base = base.experimentalSetCodecsToParseWithinGopSampleDependencies(codecsToParseWithinGopSampleDependencies) }
  override fun setParseHagcMetadata(parseHagcMetadata: Boolean): ExtractorsFactory =
    apply { base = base.setParseHagcMetadata(parseHagcMetadata) }

  private fun wrap(extractors: Array<Extractor>): Array<Extractor> =
    extractors.map { TappedExtractor(it, policy) }.toTypedArray()
}

private class TappedExtractor(private val inner: Extractor, private val policy: TapPolicy) : Extractor {
  private val taps = mutableListOf<TrackTap>()
  override fun sniff(input: ExtractorInput) = inner.sniff(input)
  override fun getSniffFailureDetails() = inner.sniffFailureDetails
  override fun init(output: ExtractorOutput) = inner.init(object : ExtractorOutput {
    override fun track(id: Int, type: Int): TrackOutput {
      val track = output.track(id, type)
      if (type != C.TRACK_TYPE_AUDIO && type != C.TRACK_TYPE_VIDEO) return track
      return TrackTap(track, policy).also { taps += it }
    }
    override fun endTracks() = output.endTracks()
    override fun seekMap(seekMap: SeekMap) = output.seekMap(seekMap)
  })
  override fun read(input: ExtractorInput, seekPosition: PositionHolder) = inner.read(input, seekPosition)
  override fun seek(position: Long, timeUs: Long) {
    taps.forEach(TrackTap::discard)
    inner.seek(position, timeUs)
  }
  override fun release() = inner.release()
  override fun getUnderlyingImplementation(): Extractor = inner.underlyingImplementation
}

private class TrackTap(private val track: TrackOutput, private val policy: TapPolicy) : TrackOutput {
  private enum class Mode { PASS, INSPECT_TRUEHD, DOLBY_VISION }
  private var mode = Mode.PASS
  private var action = DolbyVisionAction.KEEP
  private var formatId: String? = null
  private var inspected = 0
  /** Bytes given since the last sample was emitted (DOLBY_VISION), or the current sample's start (INSPECT). */
  private var pending = ByteArray(0)
  private var pendingSize = 0
  private var opaque = false

  override fun format(format: Format) {
    formatId = format.id
    val mime = format.sampleMimeType
    if (mime == MimeTypes.AUDIO_TRUEHD) {
      if (mode != Mode.INSPECT_TRUEHD) { mode = Mode.INSPECT_TRUEHD; inspected = 0 }
      track.format(format)
      return
    }
    val profile = if (mime == MimeTypes.VIDEO_DOLBY_VISION) DolbyVision.profile(format.codecs) else null
    action = DolbyVision.plan(profile, policy.dolbyVisionDecoderProfiles, policy.convertsDolbyVision)
    if (profile == null || action == DolbyVisionAction.KEEP) {
      mode = Mode.PASS
      track.format(format)
      return
    }
    mode = Mode.DOLBY_VISION
    policy.onDolbyVision(format.id, profile, action)
    track.format(when (action) {
      DolbyVisionAction.CONVERT_TO_81 -> format.buildUpon().setCodecs(DolbyVision.profile8Codecs(format.codecs!!)).build()
      // The base layer is plain HEVC Main 10 with its HDR10 signalling intact.
      else -> format.buildUpon().setSampleMimeType(MimeTypes.VIDEO_H265).setCodecs(null).build()
    })
  }

  override fun durationUs(durationUs: Long) = track.durationUs(durationUs)

  override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
    if (mode == Mode.PASS || (mode == Mode.INSPECT_TRUEHD && inspected >= INSPECT_SAMPLES)) {
      return track.sampleData(input, length, allowEndOfInput, sampleDataPart)
    }
    reserve(length)
    val read = input.read(pending, pendingSize, length)
    if (read == C.RESULT_END_OF_INPUT) {
      if (allowEndOfInput) return C.RESULT_END_OF_INPUT
      throw EOFException()
    }
    accepted(pendingSize, read, sampleDataPart)
    return read
  }

  override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
    if (mode == Mode.PASS || (mode == Mode.INSPECT_TRUEHD && inspected >= INSPECT_SAMPLES)) {
      track.sampleData(data, length, sampleDataPart)
      return
    }
    reserve(length)
    data.readBytes(pending, pendingSize, length)
    accepted(pendingSize, length, sampleDataPart)
  }

  private fun accepted(at: Int, length: Int, part: Int) {
    pendingSize += length
    if (part != TrackOutput.SAMPLE_DATA_PART_MAIN) opaque = true
    if (mode == Mode.INSPECT_TRUEHD) {
      // Read, never altered: the bytes go straight on, and only the first ones stay for the parse.
      track.sampleData(ParsableByteArray(pending.copyOfRange(at, at + length)), length, part)
      pendingSize = minOf(pendingSize, INSPECT_BYTES)
    }
  }

  override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
    when (mode) {
      Mode.PASS -> track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
      Mode.INSPECT_TRUEHD -> {
        if (inspected < INSPECT_SAMPLES) {
          inspected++
          val sync = TrueHdSync.parse(pending, 0, pendingSize)
          if (sync != null) { inspected = INSPECT_SAMPLES; policy.onTrueHd(formatId, sync.atmos) }
          pendingSize = 0
        }
        track.sampleMetadata(timeUs, flags, size, offset, cryptoData)
      }
      Mode.DOLBY_VISION -> emit(timeUs, flags, size, offset, cryptoData)
    }
  }

  /** Emits the finished sample, rewritten, and keeps the `offset` bytes that already belong to the next. */
  private fun emit(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
    val end = pendingSize - offset
    val start = end - size
    if (start < 0 || end > pendingSize) { discard(); return }
    val sample = pending.copyOfRange(start, end)
    val untouchable = opaque || cryptoData != null || flags and C.BUFFER_FLAG_HAS_SUPPLEMENTAL_DATA != 0
    val out = if (untouchable) sample else DolbyVision.rewrite(sample) { rpu ->
      if (action == DolbyVisionAction.CONVERT_TO_81) DoviNative.convertTo81(rpu) else null
    } ?: sample
    track.sampleData(ParsableByteArray(out), out.size, TrackOutput.SAMPLE_DATA_PART_MAIN)
    track.sampleMetadata(timeUs, flags, out.size, 0, cryptoData)
    System.arraycopy(pending, end, pending, 0, pendingSize - end)
    pendingSize -= end
    opaque = false
  }

  fun discard() { pendingSize = 0; opaque = false }

  private fun reserve(length: Int) {
    if (pendingSize + length > pending.size) pending = pending.copyOf(maxOf(pendingSize + length, pending.size * 2, 64 * 1024))
  }

  private companion object {
    const val INSPECT_SAMPLES = 16
    const val INSPECT_BYTES = 64
  }
}
