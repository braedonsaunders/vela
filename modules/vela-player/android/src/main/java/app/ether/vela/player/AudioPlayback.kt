// Music, audiobooks and podcasts (modules/vela-player/src/audio.ts): one Media3 ExoPlayer for the whole
// app, not tied to a screen. It owns the app's MediaSession (MediaSessionHub, hosted by VelaAudioService)
// while it plays, so playback continues in the background and with the screen off, with the media
// notification, lock-screen and headset controls. The system's commands reach JavaScript, which drives
// the queue exactly as the app's own buttons do; JavaScript's commands reach this player directly.
// Speed keeps pitch (Media3's Sonic). Gapless: the next queue item waits behind the current one in the
// player's playlist (`preload`), and ExoPlayer moves on to it with no gap, trimming the encoder delay and
// padding the file declares (LAME/iTunes gapless metadata, MP4 edit lists); JavaScript hears `advanced`.
package app.ether.vela.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

internal object AudioPlayback : SessionOwner {
  /** The module's event sink ("onAudio"). */
  var emit: ((Map<String, Any?>) -> Unit)? = null

  private val main = Handler(Looper.getMainLooper())
  private var exo: ExoPlayer? = null
  /** The current item's media authorization; each request checks it (ScopedMediaDataSource). */
  @Volatile private var grant: MediaAccess? = null
  /** The id of the item playing (JavaScript's load or preload), as its MediaItem's mediaId. */
  private var loadId = 0
  private var info: SessionInfo? = null
  private var spoken = false
  private var failure: String? = null
  private var lastState = ""
  private var lastDuration = 0.0
  private val tick = object : Runnable {
    override fun run() {
      publish(tick = true)
      if (exo?.isPlaying == true) main.postDelayed(this, 500)
    }
  }

  /** The app's audio player, built on first use. */
  fun player(context: Context): ExoPlayer = exo ?: build(context.applicationContext).also { exo = it }

  private fun build(context: Context): ExoPlayer {
    // Every request (and redirect, and seek) goes through the grant scope; Ether's URLs need no headers.
    val sources = DataSource.Factory { ScopedMediaDataSource(grant) }
    // Platform decoders first, the LGPL FFmpeg extension for the rest (ALAC; Opus, Vorbis and FLAC where
    // MediaCodec lacks them). No float output: it bypasses Sonic, which is what keeps pitch at speed.
    val renderers = DefaultRenderersFactory(context)
      .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
      .setEnableDecoderFallback(true)
    val player = ExoPlayer.Builder(context, renderers)
      .setMediaSourceFactory(DefaultMediaSourceFactory(sources))
      .setAudioAttributes(attributes(false), true)
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .setSeekBackIncrementMs(15_000)
      .setSeekForwardIncrementMs(30_000)
      .build()
    player.addListener(object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) {
        publish()
        if (player.isPlaying) { main.removeCallbacks(tick); main.postDelayed(tick, 500) }
      }

      override fun onPlayerError(error: PlaybackException) {
        failure = mediaFailureMessage((error.cause as? MediaHttpFailure)?.status ?: error.errorCode)
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) advanced(player, mediaItem)
      }
    })
    return player
  }

  private fun attributes(spoken: Boolean): AudioAttributes = AudioAttributes.Builder()
    .setUsage(C.USAGE_MEDIA)
    .setContentType(if (spoken) C.AUDIO_CONTENT_TYPE_SPEECH else C.AUDIO_CONTENT_TYPE_MUSIC)
    .build()

  // Commands (from JavaScript, on the main thread)

  fun load(context: Context, id: Int, url: String, access: Map<String, Any?>?, start: Double, rate: Double) {
    val player = player(context)
    main.removeCallbacks(empty)
    loadId = id
    failure = null
    lastState = ""
    lastDuration = 0.0
    val uri = Uri.parse(url)
    grant = try { access?.let(MediaAccess::from) } catch (_: IllegalArgumentException) { null }
    if (uri.scheme !in listOf("http", "https")) {
      failure = "This item has no playable audio"
      publish()
      return
    }
    player.setAudioAttributes(attributes(spoken), true)
    player.playWhenReady = false
    player.setMediaItem(item(id, uri), (start.coerceAtLeast(0.0) * 1000).toLong())
    player.setPlaybackSpeed(rate.toFloat().coerceIn(0.25f, 4f))
    player.prepare()
    MediaSessionHub.claim(context, this)
    publish()
  }

  private fun item(id: Int, uri: Uri): MediaItem =
    MediaItem.Builder().setMediaId(id.toString()).setUri(uri).setMediaMetadata(sessionMetadata).build()

  /**
   * Queues the next item behind the current one (null: drops it), so the player goes straight on to it.
   * An item that starts part-way (an audiobook part's resume point) is not queued: the current one ends
   * and JavaScript loads it.
   */
  fun preload(id: Int?, url: String?, access: Map<String, Any?>?, start: Double) {
    val player = exo ?: return
    if (player.mediaItemCount == 0) return
    val after = player.currentMediaItemIndex + 1
    if (player.mediaItemCount > after) player.removeMediaItems(after, player.mediaItemCount)
    if (id == null || url == null || start > 0) return
    val uri = Uri.parse(url)
    if (uri.scheme !in listOf("http", "https")) return
    // One queue plays from one server: the next item's grant (if it needs one) is the current one's.
    if (access != null) grant = try { MediaAccess.from(access) } catch (_: IllegalArgumentException) { grant }
    player.addMediaItem(item(id, uri))
  }

  /** The player went on to the queued item by itself: it is now the one JavaScript hears about. */
  private fun advanced(player: Player, mediaItem: MediaItem?) {
    val id = mediaItem?.mediaId?.toIntOrNull() ?: return
    if (id == loadId) return
    loadId = id
    failure = null
    lastState = ""
    lastDuration = 0.0
    // The finished item leaves the playlist; the one playing stays at its head.
    if (player.currentMediaItemIndex > 0) player.removeMediaItems(0, player.currentMediaItemIndex)
    emit?.invoke(buildMap {
      put("id", id)
      put("type", "advanced")
      put("position", player.currentPosition.coerceAtLeast(0) / 1000.0)
      put("duration", player.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.div(1000.0) ?: 0.0)
    })
    publish(tick = true)
  }

  fun play() {
    val player = exo ?: return
    if (player.mediaItemCount == 0) return
    if (player.playbackState == Player.STATE_IDLE) player.prepare()
    player.play()
  }

  fun pause() { exo?.pause() }

  fun seek(seconds: Double) {
    val player = exo ?: return
    if (player.mediaItemCount == 0) return
    player.seekTo((seconds.coerceAtLeast(0.0) * 1000).toLong())
    publish(tick = true)
  }

  fun setRate(rate: Double) { exo?.setPlaybackSpeed(rate.toFloat().coerceIn(0.25f, 4f)) }

  /**
   * Unloads the item. The store unloads before every load, so the player only pauses at first and keeps
   * the item, and with it the notification and the service's foreground state: the next track, loaded
   * from the background with the screen off, may not start a foreground service again. Only when no
   * load follows is the player emptied, taking the notification and the lock-screen controls with it.
   */
  fun unload() {
    val player = exo ?: return
    main.removeCallbacks(tick)
    failure = null
    player.pause()
    if (player.mediaItemCount > 1) player.removeMediaItems(player.currentMediaItemIndex + 1, player.mediaItemCount)
    main.removeCallbacks(empty)
    main.postDelayed(empty, UNLOAD_GRACE_MS)
  }

  private val empty = Runnable {
    exo?.let { it.stop(); it.clearMediaItems() }
    grant = null
    MediaSessionHub.release(this)
  }

  fun setNowPlaying(value: SessionInfo?, spoken: Boolean) {
    val restyled = spoken != this.spoken
    info = value
    this.spoken = spoken
    if (restyled) exo?.setAudioAttributes(attributes(spoken), true)
    MediaSessionHub.update(this)
  }

  // SessionOwner

  override val sessionPlayer: Player? get() = exo
  override val sessionStyle: SessionStyle get() = if (spoken) SessionStyle.SPOKEN else SessionStyle.MUSIC
  override val sessionMetadata: MediaMetadata get() = info?.metadata(spoken, video = false) ?: SessionInfo("", "", "", null).metadata(spoken, false)

  override fun sessionCommand(command: String, seconds: Double?) = remote(command, seconds)

  /** A system command (notification, lock screen, headset, car, assistant) for JavaScript's queue. */
  private fun remote(command: String, seconds: Double?) {
    emit?.invoke(buildMap {
      put("id", loadId)
      put("type", "remote")
      put("command", command)
      if (seconds != null) put("seconds", seconds)
    })
  }

  // State

  private fun state(player: Player): String = when {
    player.mediaItemCount == 0 -> if (failure != null) "failed" else "idle"
    failure != null || player.playerError != null -> "failed"
    player.playbackState == Player.STATE_ENDED -> "ended"
    player.isPlaying -> "playing"
    player.playbackState == Player.STATE_READY -> "paused"
    player.playbackState == Player.STATE_BUFFERING && player.playWhenReady -> "buffering"
    else -> "loading"
  }

  /** Reports the state to JavaScript when it changed, and every half second while playing. */
  private fun publish(tick: Boolean = false) {
    val player = exo ?: return
    val state = state(player)
    if (state == "idle") return
    val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.div(1000.0) ?: 0.0
    if (state == lastState && duration == lastDuration && !(tick && (state == "playing" || state == "paused"))) return
    lastState = state
    lastDuration = duration
    val position = player.currentPosition.coerceAtLeast(0) / 1000.0
    emit?.invoke(buildMap {
      put("id", loadId)
      put("type", "status")
      put("state", state)
      put("position", position)
      put("duration", duration)
      put("rate", player.playbackParameters.speed.toDouble())
      put("buffered", listOf(mapOf("startSeconds" to position, "endSeconds" to player.bufferedPosition.coerceAtLeast(0) / 1000.0)))
      if (state == "failed") put("error", failure ?: mediaFailureMessage(player.playerError?.errorCode ?: 0))
    })
  }
}

/** How long an unloaded item stays (paused) for the next one: a plan request, not a pause. */
private const val UNLOAD_GRACE_MS = 15_000L
