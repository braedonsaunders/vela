// HDR to SDR for a display that cannot show the video's HDR: Android 12+ decoders that can tone-map honour
// MediaFormat.KEY_COLOR_TRANSFER_REQUEST (the same request Media3's transformer makes). A decoder that
// cannot ignores it and outputs HDR as before; the output format says which happened.
package app.ether.vela.player

import android.content.Context
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.audio.AudioOutputProvider
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.AudioTrackAudioOutputProvider
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.DefaultAudioTrackBufferSizeProvider
import androidx.media3.exoplayer.audio.ForwardingAudioOutputProvider
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.text.TextOutput
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener

/** DefaultRenderersFactory whose MediaCodec video renderer asks for SDR output when `wantsSdr` says so, whose
 * text renderer runs `subtitleDelay` behind the clock (SubtitleDelay.kt), and whose audio sink decodes every
 * encoded track to PCM when `decodeAll` (OutputPreferences) or the route takes no bitstream, shapes decoded PCM
 * by `pcmLimit`, and applies speed to PCM at the AudioTrack, which time-stretches float output too (Media3's own
 * speed processor takes 16-bit PCM only). */
internal class VelaRenderersFactory(
  context: Context,
  private val wantsSdr: (Format) -> Boolean,
  private val onToneMapped: (Boolean) -> Unit,
  private val subtitleDelay: SubtitleDelay? = null,
  private val decodeAll: Boolean = false,
  /** Whether the route may take a bitstream now (AudioRoute.takesBitstream): asked at each track selection. */
  private val takesBitstream: () -> Boolean = { true },
  /** Decoded PCM shaped for a low-RAM device or an unknown sink (PcmFit.kt), or null. */
  private val pcmLimit: PcmLimit? = null,
) : DefaultRenderersFactory(context) {
  override fun buildTextRenderers(context: Context, output: TextOutput, outputLooper: Looper, extensionRendererMode: Int, out: ArrayList<Renderer>) {
    val first = out.size
    super.buildTextRenderers(context, output, outputLooper, extensionRendererMode, out)
    val delay = subtitleDelay ?: return
    for (index in first until out.size) out[index] = DelayedTextRenderer(out[index], delay)
  }

  override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink {
    val tracks = AudioTrackAudioOutputProvider.Builder(context).setMaxPlaybackSpeed(2f).apply {
      pcmLimit?.bufferUs?.let { setAudioTrackBufferSizeProvider(DefaultAudioTrackBufferSizeProvider.Builder().setTargetPcmBufferDurationUs(it).build()) }
    }.build()
    val provider = object : ForwardingAudioOutputProvider(tracks) {
      override fun getFormatSupport(formatConfig: AudioOutputProvider.FormatConfig): AudioOutputProvider.FormatSupport =
        if (formatConfig.format.sampleMimeType != MimeTypes.AUDIO_RAW && (decodeAll || !takesBitstream())) AudioOutputProvider.FormatSupport.UNSUPPORTED
        else super.getFormatSupport(formatConfig)

      // A bitstream for the receiver plays at 1×: never ask its AudioTrack for another speed.
      override fun getOutputConfig(formatConfig: AudioOutputProvider.FormatConfig): AudioOutputProvider.OutputConfig =
        super.getOutputConfig(if (formatConfig.format.sampleMimeType == MimeTypes.AUDIO_RAW) formatConfig
          else formatConfig.buildUpon().setEnablePlaybackParameters(false).build())
    }
    return DefaultAudioSink.Builder(context)
      // The limit's processors run only on the sink's 16-bit path.
      .setEnableFloatOutput(enableFloatOutput && pcmLimit == null)
      .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
      .setAudioOutputProvider(provider)
      .apply { pcmLimit?.let { setAudioProcessors(it.processors()) } }
      .build()
  }

  override fun buildVideoRenderers(
    context: Context,
    extensionRendererMode: Int,
    mediaCodecSelector: MediaCodecSelector,
    enableDecoderFallback: Boolean,
    eventHandler: Handler,
    eventListener: VideoRendererEventListener,
    allowedVideoJoiningTimeMs: Long,
    out: ArrayList<Renderer>,
  ) {
    val first = out.size
    super.buildVideoRenderers(context, extensionRendererMode, mediaCodecSelector, enableDecoderFallback, eventHandler,
      eventListener, allowedVideoJoiningTimeMs, out)
    for (index in first until out.size) {
      if (out[index].javaClass != MediaCodecVideoRenderer::class.java) continue
      out[index] = SdrRequestingVideoRenderer(
        MediaCodecVideoRenderer.Builder(context)
          .setCodecAdapterFactory(codecAdapterFactory)
          .setMediaCodecSelector(mediaCodecSelector)
          .setAllowedJoiningTimeMs(allowedVideoJoiningTimeMs)
          .setEnableDecoderFallback(enableDecoderFallback)
          .setEventHandler(eventHandler)
          .setEventListener(eventListener)
          .setMaxDroppedFramesToNotify(MAX_DROPPED_VIDEO_FRAME_COUNT_TO_NOTIFY),
        wantsSdr, onToneMapped)
    }
  }
}

private class SdrRequestingVideoRenderer(
  builder: Builder,
  private val wantsSdr: (Format) -> Boolean,
  private val onToneMapped: (Boolean) -> Unit,
) : MediaCodecVideoRenderer(builder) {
  private var requested = false

  override fun getMediaFormat(
    format: Format,
    codecMimeType: String,
    codecMaxValues: CodecMaxValues,
    codecOperatingRate: Float,
    deviceNeedsNoPostProcessWorkaround: Boolean,
    tunnelingAudioSessionId: Int,
  ): MediaFormat {
    val media = super.getMediaFormat(format, codecMimeType, codecMaxValues, codecOperatingRate,
      deviceNeedsNoPostProcessWorkaround, tunnelingAudioSessionId)
    // A Dolby Vision decoder maps to the display itself.
    requested = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && codecMimeType != MimeTypes.VIDEO_DOLBY_VISION && wantsSdr(format)
    if (requested) media.setInteger(MediaFormat.KEY_COLOR_TRANSFER_REQUEST, MediaFormat.COLOR_TRANSFER_SDR_VIDEO)
    return media
  }

  override fun onOutputFormatChanged(format: Format, mediaFormat: MediaFormat?) {
    super.onOutputFormatChanged(format, mediaFormat)
    if (!requested || mediaFormat == null) return
    onToneMapped(mediaFormat.containsKey(MediaFormat.KEY_COLOR_TRANSFER) &&
      mediaFormat.getInteger(MediaFormat.KEY_COLOR_TRANSFER) == MediaFormat.COLOR_TRANSFER_SDR_VIDEO)
  }
}
