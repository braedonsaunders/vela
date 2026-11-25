// Music, audiobooks and podcasts (modules/vela-player/src/audio.ts): Media3 ExoPlayer for the whole app,
// not tied to a screen. It owns the app's MediaSession (MediaSessionHub, hosted by VelaAudioService)
// while it plays, so playback continues in the background and with the screen off, with the media
// notification, lock-screen and headset controls. The system's commands reach JavaScript, which drives
// the queue exactly as the app's own buttons do; JavaScript's commands reach this player directly.
// Speed keeps pitch (Media3's Sonic). Gapless: the next queue item waits behind the current one in the
// player's playlist (`preload`), and ExoPlayer moves on to it with no gap, trimming the encoder delay and
// padding the file declares (LAME/iTunes gapless metadata, MP4 edit lists); JavaScript hears `advanced`.
//
// Sound (docs/sound.md): every player's PCM passes through a VelaSoundProcessor (levelling gain, the EQ,
// AutoMix's fades). AutoMix's crossfade uses a second player (a deck) prepared with the preloaded item:
// at `at` on the outgoing item's clock it starts, the outgoing deck fades out (cos) and the incoming one
// in (sin), and the incoming deck becomes the player JavaScript and the media session follow. The fades
// are applied by each processor on its own item's samples; only the incoming deck's start is timed, on
// the main thread against the outgoing player's position.
package app.ether.vela.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import kotlin.math.roundToLong

internal object AudioPlayback : SessionOwner {
  /** The module's event sink ("onAudio"). */
  var emit: ((Map<String, Any?>) -> Unit)? = null

  /** One ExoPlayer with its sound processor and media authorization (each request checks it). */
  private class Deck(val number: Int, val sound: VelaSoundProcessor) {
    lateinit var player: ExoPlayer
    lateinit var sink: VelaSoundSink
    val decodedPcm get() = !::sink.isInitialized || sink.decodedPcm
    @Volatile var grant: MediaAccess? = null
  }

  /** A crossfade waiting for its start: `deck` holds the incoming item, prepared and paused. */
  private class Crossfade(val deck: Deck, var id: Int, val uri: Uri, val startMs: Long, var atUs: Long, var durationUs: Long) {
    /** When the outgoing deck's fade-out was handed to its processor (item clock, µs); null until then. */
    var committedUs: Long? = null
    /** elapsedRealtimeNanos of the incoming deck's play(). */
    var playNs = 0L
  }

  private val main = Handler(Looper.getMainLooper())
  private var context: Context? = null
  private var decks = 0
  private var visualizerUsers = 0
  @Volatile var visualizerPcm = true
    private set
  @Volatile var onVisualizerAvailability: (() -> Unit)? = null

  /** Sink configuration can change when an external receiver takes encoded passthrough. */
  fun visualizerFormatChanged() { main.post { updateVisualizerAvailability() } }

  private fun updateVisualizerAvailability() {
    val available = active?.decodedPcm != false
    if (visualizerPcm == available) return
    visualizerPcm = available
    onVisualizerAvailability?.invoke()
  }

  val visualizerListeners = mutableSetOf<() -> Unit>()
  val visualizerPlaying: Boolean get() = visualizerPcm && !spoken && active?.player?.isPlaying == true

  /** Main thread. Allocate taps only while at least one foreground music surface needs PCM. */
  fun observeVisualizer(start: Boolean) {
    visualizerUsers += if (start) 1 else -1
    if ((start && visualizerUsers != 1) || (!start && visualizerUsers != 0)) return
    for (deck in listOfNotNull(active, fading, spare, crossfade?.deck).distinct()) {
      deck.sound.visualizer = if (start) VisualizerAudio() else null
    }
  }

  fun visualizerDecks(): List<VisualizerDeck> {
    if (spoken) return emptyList()
    return listOfNotNull(active, fading).mapNotNull { deck ->
      val audio = deck.sound.visualizer
      if (audio == null || !deck.player.isPlaying) null
      else VisualizerDeck(audio, deck.sink, deck.player.playbackParameters.speed.toDouble())
    }
  }

  /** The deck JavaScript and the media session follow. */
  private var active: Deck? = null
  /** The outgoing deck while it fades out. */
  private var fading: Deck? = null
  /** A stopped deck kept for the next crossfade. */
  private var spare: Deck? = null
  private var crossfade: Crossfade? = null
  /** The crossfade fading now, until its incoming deck's start has been measured. */
  private var started: Crossfade? = null
  /** How long a prepared deck takes from play() to its first sample heard: learnt from each crossfade. */
  private var startLeadMs = DEFAULT_START_LEAD_MS
  private var eq: EqChain? = null
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
      if (active?.player?.isPlaying == true) main.postDelayed(this, 500)
    }
  }

  /** The app's audio player (the active deck), built on first use. */
  fun player(context: Context): ExoPlayer = (active ?: build(context.applicationContext).also { active = it }).player

  private fun build(context: Context): Deck {
    this.context = context
    val number = decks++
    val deck = Deck(number, VelaSoundProcessor(number))
    if (visualizerUsers > 0) deck.sound.visualizer = VisualizerAudio()
    // Every request (and redirect, and seek) goes through the grant scope; Ether's URLs need no headers.
    val sources = DataSource.Factory { ScopedMediaDataSource(deck.grant) }
    // Platform decoders first, the LGPL FFmpeg extension for the rest (ALAC; Opus, Vorbis and FLAC where
    // MediaCodec lacks them). No float output: it bypasses Sonic, which is what keeps pitch at speed.
    // MP3 always decodes in FFmpeg: Media3 trims the LAME delay plus the 529-sample decoder delay FFmpeg's
    // decoder has, but Android's MP3 decoder already drops those 529 samples itself, so with it each track
    // lost its first 12 ms and ended on 12 ms of padding (a dropout at every gapless join).
    val renderers = object : DefaultRenderersFactory(context) {
      // The sound processor heads the sink's chain, before Sonic (speed).
      override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink =
        VelaSoundSink(DefaultAudioSink.Builder(context)
          .setEnableFloatOutput(enableFloatOutput)
          .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
          .setAudioProcessors(arrayOf(deck.sound))
          .build(), deck.sound).also { deck.sink = it }
    }
      .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
      .setMediaCodecSelector { mimeType, secure, tunneling ->
        if (mimeType == MimeTypes.AUDIO_MPEG) emptyList() else MediaCodecSelector.DEFAULT.getDecoderInfos(mimeType, secure, tunneling)
      }
      .setEnableDecoderFallback(true)
    // Only the active deck handles audio focus (a crossfade's incoming deck takes it once the outgoing one stops).
    val player = ExoPlayer.Builder(context, renderers)
      .setMediaSourceFactory(DefaultMediaSourceFactory(sources))
      .setAudioAttributes(attributes(spoken), active == null)
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .setSeekBackIncrementMs(15_000)
      .setSeekForwardIncrementMs(30_000)
      .build()
    deck.player = player
    deck.sound.setEq(eq)
    player.addListener(object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) {
        when {
          deck === active -> {
            if (crossfade != null) armCrossfade()
            // A pause, focus loss or unplugged headphones during a crossfade ends it: the incoming item stays.
            if (fading != null && (!player.playWhenReady || player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE)) endFade()
            if (deck !== active) return
            publish()
            if (player.isPlaying) { main.removeCallbacks(tick); main.postDelayed(tick, 500) }
          }
          deck === crossfade?.deck -> if (player.playbackState == Player.STATE_READY) armCrossfade()
          // The outgoing deck still holds the audio focus while it fades: its loss pauses the incoming one too.
          deck === fading -> if (!player.playWhenReady || player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) {
            active?.player?.pause()
            endFade()
          }
        }
      }

      override fun onPlayerError(error: PlaybackException) {
        if (deck === active) failure = mediaFailureMessage((error.cause as? MediaHttpFailure)?.status ?: error.errorCode)
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        if (deck === active && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) advanced(player, mediaItem)
      }
    })
    return deck
  }

  private fun attributes(spoken: Boolean): AudioAttributes = AudioAttributes.Builder()
    .setUsage(C.USAGE_MEDIA)
    .setContentType(if (spoken) C.AUDIO_CONTENT_TYPE_SPEECH else C.AUDIO_CONTENT_TYPE_MUSIC)
    .build()

  // Commands (from JavaScript, on the main thread)

  fun load(context: Context, id: Int, url: String, access: Map<String, Any?>?, start: Double, rate: Double) {
    player(context)
    val deck = active!!
    val player = deck.player
    dropCrossfade()
    endFade()
    main.removeCallbacks(empty)
    loadId = id
    failure = null
    lastState = ""
    lastDuration = 0.0
    val uri = Uri.parse(url)
    deck.grant = try { access?.let(MediaAccess::from) } catch (_: IllegalArgumentException) { null }
    if (uri.scheme !in listOf("http", "https")) {
      failure = "This item has no playable audio"
      publish()
      return
    }
    // Unity until JavaScript's sound arrives (it follows every load at once).
    deck.sound.reset(id, 1.0)
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
   * Readies the next item (null: drops it). Gapless (no `crossfade`): it waits behind the current one in
   * the player's playlist, so the player goes straight on to it; one that starts part-way (an audiobook
   * part's resume point) is not queued: the current one ends and JavaScript loads it. With `crossfade`
   * (seconds, at), a second deck prepares it to start `at` seconds into the current item. `gain` is its
   * levelling.
   */
  fun preload(id: Int?, url: String?, access: Map<String, Any?>?, start: Double, gain: Double = 1.0, crossfade: Pair<Double, Double>? = null) {
    val deck = active ?: return
    val player = deck.player
    if (player.mediaItemCount == 0) return
    val after = player.currentMediaItemIndex + 1
    if (player.mediaItemCount > after) player.removeMediaItems(after, player.mediaItemCount)
    deck.sound.dequeue(loadId)
    val uri = url?.let(Uri::parse)
    if (id == null || uri == null || uri.scheme !in listOf("http", "https")) { dropCrossfade(); return }
    // One queue plays from one server: the next item's grant (if it needs one) is the current one's.
    val grant = access?.let { try { MediaAccess.from(it) } catch (_: IllegalArgumentException) { null } }
    if (crossfade != null && crossfade.first > 0) {
      prepareCrossfade(id, uri, grant ?: deck.grant, start, gain, crossfade.first, crossfade.second)
      return
    }
    dropCrossfade()
    if (start > 0) return
    if (grant != null) deck.grant = grant
    player.addMediaItem(item(id, uri))
    deck.sound.queue(loadId, id, gain)
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
    emitAdvanced(player)
  }

  private fun emitAdvanced(player: Player) {
    emit?.invoke(buildMap {
      put("id", loadId)
      put("type", "advanced")
      put("position", player.currentPosition.coerceAtLeast(0) / 1000.0)
      put("duration", player.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.div(1000.0) ?: 0.0)
    })
    publish(tick = true)
  }

  fun play() {
    val player = active?.player ?: return
    if (player.mediaItemCount == 0) return
    if (player.playbackState == Player.STATE_IDLE) player.prepare()
    player.play()
  }

  fun pause() {
    active?.player?.pause()
    endFade()
  }

  fun seek(seconds: Double) {
    val player = active?.player ?: return
    if (player.mediaItemCount == 0) return
    endFade()
    // A committed fade-out belongs to the position it was timed from: it is timed again from the new one.
    crossfade?.let { plan -> if (plan.committedUs != null) { plan.committedUs = null; active?.sound?.setFades(emptyList()) } }
    player.seekTo((seconds.coerceAtLeast(0.0) * 1000).toLong())
    publish(tick = true)
  }

  fun setRate(rate: Double) { active?.player?.setPlaybackSpeed(rate.toFloat().coerceIn(0.25f, 4f)) }

  /** Levelling (the playing item's gain, linear) and the EQ (every deck, until changed). */
  fun sound(gain: Double, eq: EqChain?) {
    this.eq = eq
    active?.sound?.setGain(loadId, gain.coerceIn(0.0, 16.0))
    listOfNotNull(active, fading, spare, crossfade?.deck).forEach { it.sound.setEq(eq) }
  }

  /** A debug capture of the processed output (SoundCapture); the device gets silence. Null stops it and
   * returns the files written. */
  fun capture(path: String?): List<String> {
    if (path != null) { SoundCapture.start(path); return emptyList() }
    return SoundCapture.stop()
  }

  /**
   * Unloads the item. The store unloads before every load, so the player only pauses at first and keeps
   * the item, and with it the notification and the service's foreground state: the next track, loaded
   * from the background with the screen off, may not start a foreground service again. Only when no
   * load follows is the player emptied, taking the notification and the lock-screen controls with it.
   */
  fun unload() {
    val player = active?.player ?: return
    main.removeCallbacks(tick)
    failure = null
    dropCrossfade()
    endFade()
    player.pause()
    if (player.mediaItemCount > 1) player.removeMediaItems(player.currentMediaItemIndex + 1, player.mediaItemCount)
    active?.sound?.dequeue(loadId)
    main.removeCallbacks(empty)
    main.postDelayed(empty, UNLOAD_GRACE_MS)
  }

  private val empty = Runnable {
    active?.let { it.player.stop(); it.player.clearMediaItems(); it.grant = null }
    spare?.let { it.player.release(); spare = null }
    MediaSessionHub.release(this)
  }

  fun setNowPlaying(value: SessionInfo?, spoken: Boolean) {
    val restyled = spoken != this.spoken
    info = value
    this.spoken = spoken
    if (restyled) {
      active?.player?.setAudioAttributes(attributes(spoken), fading == null)
      listOfNotNull(fading, spare, crossfade?.deck).forEach { it.player.setAudioAttributes(attributes(spoken), it === fading) }
    }
    MediaSessionHub.update(this)
  }

  // AutoMix

  private fun prepareCrossfade(id: Int, uri: Uri, grant: MediaAccess?, start: Double, gain: Double, seconds: Double, at: Double) {
    val startMs = (start.coerceAtLeast(0.0) * 1000).toLong()
    val atUs = (at * 1_000_000).toLong()
    val durationUs = (seconds * 1_000_000).toLong()
    val current = crossfade
    // The same item again (new settings, a new id): keep the prepared deck.
    if (current != null && current.uri == uri && current.startMs == startMs) {
      current.id = id
      current.deck.sound.reset(id, gain)
      current.deck.sound.setFades(listOf(Fade(id, startMs * 1000, durationUs, incoming = true)))
      if (current.atUs != atUs || current.durationUs != durationUs) {
        current.atUs = atUs
        current.durationUs = durationUs
        if (current.committedUs != null) { current.committedUs = null; active?.sound?.setFades(emptyList()) }
      }
      armCrossfade()
      return
    }
    dropCrossfade()
    val deck = spare ?: build(context ?: return)
    spare = null
    deck.grant = grant
    deck.sound.setEq(eq)
    deck.sound.reset(id, gain)
    deck.sound.setFades(listOf(Fade(id, startMs * 1000, durationUs, incoming = true)))
    deck.player.setAudioAttributes(attributes(spoken), false)
    deck.player.playWhenReady = false
    deck.player.setMediaItem(item(id, uri), startMs)
    deck.player.setPlaybackSpeed(1f)
    deck.player.prepare()
    crossfade = Crossfade(deck, id, uri, startMs, atUs, durationUs)
    armCrossfade()
  }

  private val arm = Runnable { armCrossfade() }
  private val start = Runnable { startCrossfade(fade = true) }

  /**
   * Times the crossfade from the outgoing player's position (what is heard): COMMIT_LEAD_MS ahead, once
   * the incoming deck is ready, the outgoing processor gets its fade-out (on its own samples, from `at`,
   * or a little later if the processor has already passed it); then the incoming deck starts so that its
   * first sample is heard when the outgoing item reaches that point. Called again on every change.
   */
  private fun armCrossfade() {
    main.removeCallbacks(arm)
    main.removeCallbacks(start)
    val plan = crossfade ?: return
    val deck = active ?: return
    val player = deck.player
    if (player.playbackState == Player.STATE_ENDED) {
      // The outgoing item ended first (the incoming one was not ready in time): straight on, no fade.
      if (plan.deck.player.playbackState == Player.STATE_READY && plan.deck.player.playerError == null) startCrossfade(fade = false)
      else dropCrossfade()
      return
    }
    if (!player.isPlaying) return
    val speed = player.playbackParameters.speed.toDouble()
    // The sink's heard position, extrapolated to now; ExoPlayer's own lags the playback thread.
    val position = (deck.sink.heardNowUs(speed) ?: (player.currentPosition * 1000)) / 1000.0
    if (plan.committedUs == null) {
      val commitAt = plan.atUs / 1000 - COMMIT_LEAD_MS
      if (position < commitAt) { main.postDelayed(arm, ((commitAt - position) / speed).roundToLong()); return }
      if (plan.deck.player.playbackState != Player.STATE_READY) return
      val committed = maxOf(plan.atUs, deck.sound.positionUs + COMMIT_MARGIN_US, (position * 1000).toLong() + COMMIT_MARGIN_US)
      plan.committedUs = committed
      deck.sound.setFades(listOf(Fade(loadId, committed, plan.durationUs, incoming = false)))
      SoundCapture.mark("commit:$committed")
    }
    val wait = (plan.committedUs!! / 1000.0 - position) / speed - startLeadMs
    // Come back close to the start and measure again, then start on the millisecond.
    if (wait > 60) main.postDelayed(arm, (wait - 40).toLong())
    else main.postDelayed(start, wait.roundToLong().coerceAtLeast(0))
  }

  private fun startCrossfade(fade: Boolean) {
    val plan = crossfade ?: return
    val outgoing = active ?: return
    val incoming = plan.deck
    crossfade = null
    main.removeCallbacks(arm)
    if (!fade) {
      // Whatever the incoming deck prepared was faded in: it plays from its start at full level instead.
      incoming.sound.setFades(emptyList())
      incoming.player.seekTo(plan.startMs)
    }
    SoundCapture.mark("play:${outgoing.sink.heardNowUs(1.0) ?: -1}")
    plan.playNs = SystemClock.elapsedRealtimeNanos()
    incoming.player.play()
    endFade()
    active = incoming
    updateVisualizerAvailability()
    loadId = plan.id
    failure = null
    lastState = ""
    lastDuration = 0.0
    if (fade) {
      fading = outgoing
      started = plan
      main.postDelayed(fadeEnd, plan.durationUs / 1000 + FADE_TAIL_MS)
    } else {
      retire(outgoing)
      incoming.player.setAudioAttributes(attributes(spoken), true)
    }
    MediaSessionHub.update(this)
    emitAdvanced(incoming.player)
  }

  private val fadeEnd = Runnable { learnStartLead(); endFade() }

  /** A crossfade played through: when its incoming deck's first sample was heard (from its sink's clock)
   * after play() sets the lead for the next one. */
  private fun learnStartLead() {
    val plan = started ?: return
    started = null
    if (active !== plan.deck) return
    val heard = plan.deck.sink.heard ?: return
    if (!heard.playing) return
    val firstHeardNs = heard.atNs - (heard.positionUs - plan.startMs * 1000) * 1000
    val latencyMs = (firstHeardNs - plan.playNs) / 1e6
    if (latencyMs in 0.0..MAX_START_LEAD_MS) startLeadMs = (startLeadMs + latencyMs) / 2
    SoundCapture.mark("lead:${(latencyMs * 1000).toLong()}")
  }

  /** The outgoing deck has faded out (or the fade was cut short): it stops, and the active deck takes the focus. */
  private fun endFade() {
    main.removeCallbacks(fadeEnd)
    started = null
    val outgoing = fading ?: return
    fading = null
    retire(outgoing)
    active?.player?.setAudioAttributes(attributes(spoken), true)
  }

  /** Stops a deck and keeps it for the next crossfade (one spare at most). */
  private fun retire(deck: Deck) {
    deck.player.stop()
    deck.player.clearMediaItems()
    deck.player.setAudioAttributes(attributes(spoken), false)
    deck.sound.setFades(emptyList())
    deck.grant = null
    if (spare == null) spare = deck else deck.player.release()
  }

  /** Abandons a crossfade not started yet. */
  private fun dropCrossfade() {
    val plan = crossfade ?: return
    crossfade = null
    main.removeCallbacks(arm)
    main.removeCallbacks(start)
    if (plan.committedUs != null) active?.sound?.setFades(emptyList())
    retire(plan.deck)
  }

  // SessionOwner

  override val sessionPlayer: Player? get() = active?.player
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
    if (!tick) for (listener in visualizerListeners) listener()
    val player = active?.player ?: return
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
/** How far ahead of a crossfade the outgoing fade is handed to its processor: more than the sink's buffer
 * (the processor runs that far ahead of what is heard). */
private const val COMMIT_LEAD_MS = 2_000L
/** A fade-out committed late starts at least this far ahead of the processor. */
private const val COMMIT_MARGIN_US = 100_000L
/** How long a paused, prepared ExoPlayer takes from play() to its first sample heard, until a crossfade has
 * measured it on this device (82 ms on the API 34 emulator; docs/sound.md). */
private const val DEFAULT_START_LEAD_MS = 80.0
private const val MAX_START_LEAD_MS = 400.0
/** The outgoing deck stops this long after its fade ends. */
private const val FADE_TAIL_MS = 300L
