// HDR to SDR for a display that cannot show the video's HDR: Android 12+ decoders that can tone-map honour
// MediaFormat.KEY_COLOR_TRANSFER_REQUEST (the same request Media3's transformer makes). A decoder that
// cannot ignores it and outputs HDR as before; the output format says which happened.
package app.ether.vela.player

import android.content.Context
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener

/** DefaultRenderersFactory whose MediaCodec video renderer asks for SDR output when `wantsSdr` says so. */
internal class VelaRenderersFactory(
  context: Context,
  private val wantsSdr: (Format) -> Boolean,
  private val onToneMapped: (Boolean) -> Unit,
) : DefaultRenderersFactory(context) {
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
