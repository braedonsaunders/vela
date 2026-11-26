// The app's one Media3 MediaSession, hosted by VelaAudioService: the media notification, the lock screen,
// Bluetooth and headset buttons, Android TV's Now Playing card, Android Auto and the Assistant. It shows
// whichever player owns it, the audio player (music, audiobooks, podcasts) or the full-screen video
// player (never a preview or a multiview tile), as Apple's SystemMediaControls does. The system's commands
// go to the owner, which runs them through its own command path; the players never take them directly.
package app.ether.vela.player

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.source.ForwardingTimeline
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/** Which commands the system offers: a video's 10-second skips, music's previous and next, spoken word's
 * 15/30-second skips (with previous and next for the headset's double and triple press). */
internal enum class SessionStyle(val back: Double, val forward: Double, val tracks: Boolean) {
  VIDEO(10.0, 10.0, false),
  MUSIC(15.0, 30.0, true),
  SPOKEN(15.0, 30.0, true),
}

/** What the session shows: title, artist or subtitle, album, artwork. */
internal data class SessionInfo(val title: String, val artist: String, val album: String, val artwork: Uri?) {
  fun metadata(spoken: Boolean, video: Boolean): MediaMetadata = MediaMetadata.Builder()
    .setTitle(title.ifEmpty { "Vela" })
    .setDisplayTitle(title.ifEmpty { "Vela" })
    .setArtist(artist.ifEmpty { null })
    .setSubtitle(artist.ifEmpty { null })
    .setAlbumTitle(album.ifEmpty { null })
    .setArtworkUri(artwork)
    .setMediaType(when {
      video -> MediaMetadata.MEDIA_TYPE_VIDEO
      spoken -> MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER
      else -> MediaMetadata.MEDIA_TYPE_MUSIC
    })
    .build()
}

internal interface SessionOwner {
  /** The player whose state (position, playing, duration) the system shows. Main-looper ExoPlayer. */
  val sessionPlayer: Player?
  val sessionIsOnDemandVideo: Boolean get() = false
  val sessionStyle: SessionStyle
  val sessionMetadata: MediaMetadata?
  /** play, pause, next, previous, seek (to `seconds`), skip (by `seconds`). */
  fun sessionCommand(command: String, seconds: Double?)
}

internal object MediaSessionHub {
  private var owner: SessionOwner? = null
  private var session: MediaSession? = null
  private var player: SessionPlayer? = null
  private var controller: ListenableFuture<MediaController>? = null

  /** Makes `owner` the player the system's controls show and reach (the last to claim wins). */
  fun claim(context: Context, owner: SessionOwner) {
    this.owner = owner
    connect(context)
    follow()
  }

  /** Gives the session up, if `owner` holds it; it falls back to the (usually empty) audio player. */
  fun release(owner: SessionOwner) {
    if (this.owner !== owner) return
    this.owner = null
    follow()
  }

  /** The owner's metadata or style changed. */
  fun update(owner: SessionOwner) {
    if (this.owner === owner) follow()
  }

  fun owns(owner: SessionOwner): Boolean = this.owner === owner

  internal fun command(command: String, seconds: Double?) { owner?.sessionCommand(command, seconds) }
  internal val onDemandVideo: Boolean get() = owner?.sessionIsOnDemandVideo == true
  internal val style: SessionStyle get() = owner?.sessionStyle ?: SessionStyle.MUSIC
  internal val metadata: MediaMetadata? get() = owner?.sessionMetadata

  /** The player to show: the owner's, else the audio player (empty unless something is queued). */
  internal fun current(context: Context): Player = owner?.sessionPlayer ?: AudioPlayback.player(context)

  private fun follow() {
    val player = player ?: return
    val session = session ?: return
    player.follow(current(player.context))
    buttons(session)
  }

  /** Binds VelaAudioService, which builds the session (and keeps it while the app runs). */
  private fun connect(context: Context) {
    if (controller != null) return
    val app = context.applicationContext
    controller = MediaController.Builder(app, SessionToken(app, ComponentName(app, VelaAudioService::class.java)))
      .setListener(object : MediaController.Listener {
        override fun onDisconnected(controller: MediaController) { MediaSessionHub.controller = null }
      })
      .buildAsync()
  }

  internal fun attach(session: MediaSession, player: SessionPlayer) {
    this.session = session
    this.player = player
    follow()
  }

  internal fun detach(session: MediaSession) {
    if (this.session !== session) return
    this.session = null
    player = null
    controller = null
  }

  /** The notification's skip buttons for video and spoken word; music keeps previous and next. */
  private fun buttons(session: MediaSession) {
    val style = style
    session.setMediaButtonPreferences(when (style) {
      SessionStyle.MUSIC -> emptyList()
      SessionStyle.VIDEO -> listOf(
        CommandButton.Builder(CommandButton.ICON_SKIP_BACK_10).setDisplayName("Back 10 seconds")
          .setPlayerCommand(Player.COMMAND_SEEK_BACK).setSlots(CommandButton.SLOT_BACK).build(),
        CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_10).setDisplayName("Forward 10 seconds")
          .setPlayerCommand(Player.COMMAND_SEEK_FORWARD).setSlots(CommandButton.SLOT_FORWARD).build(),
      )
      SessionStyle.SPOKEN -> listOf(
        CommandButton.Builder(CommandButton.ICON_SKIP_BACK_15).setDisplayName("Back 15 seconds")
          .setPlayerCommand(Player.COMMAND_SEEK_BACK).setSlots(CommandButton.SLOT_BACK).build(),
        CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_30).setDisplayName("Forward 30 seconds")
          .setPlayerCommand(Player.COMMAND_SEEK_FORWARD).setSlots(CommandButton.SLOT_FORWARD).build(),
      )
    })
  }
}

/**
 * The player the session sees: the owner's player for state, with the owner's metadata, and every command
 * the system sends handed to the owner instead of the player.
 */
internal class SessionPlayer(val context: Context, player: Player) : ForwardingSimpleBasePlayer(player) {
  private var sourceTimeline: Timeline? = null
  private var onDemandTimeline: Timeline? = null

  private fun sessionTimeline(timeline: Timeline): Timeline {
    if (!MediaSessionHub.onDemandVideo) return timeline
    if (sourceTimeline !== timeline) {
      sourceTimeline = timeline
      onDemandTimeline = object : ForwardingTimeline(timeline) {
        override fun getWindow(index: Int, window: Timeline.Window, projectionUs: Long): Timeline.Window =
          super.getWindow(index, window, projectionUs).apply { liveConfiguration = null }
      }
    }
    return checkNotNull(onDemandTimeline)
  }

  fun follow(next: Player) {
    if (next.applicationLooper != applicationLooper) return
    setPlayer(next)
    invalidateState()
  }

  override fun getState(): State {
    val state = super.getState()
    if (state.timeline.isEmpty) return state
    val style = MediaSessionHub.style
    val commands = state.availableCommands.buildUpon()
      .addAll(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD, Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
    if (style.tracks) commands.addAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
    else commands.removeAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
    val builder = state.buildUpon()
      .setAvailableCommands(commands.build())
      .setSeekBackIncrementMs((style.back * 1000).toLong())
      .setSeekForwardIncrementMs((style.forward * 1000).toLong())
    // An in-progress VOD remux can start with an open HLS playlist. ExoPlayer calls that live,
    // so Media3's platform bridge publishes an unknown position and zero speed on every event.
    // Keep the source timeline and position suppliers intact for playback. Only the session
    // sees an on-demand window, so Media3 can publish position and elapsed-realtime on seeks,
    // discontinuities and playback rate/state changes.
    MediaSessionHub.metadata?.let { builder.setPlaylist(sessionTimeline(state.timeline), state.currentTracks, it) }
    return builder.build()
  }

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    MediaSessionHub.command(if (playWhenReady) "play" else "pause", null)
    return Futures.immediateVoidFuture()
  }

  // Play on an idle or finished item is the owner's to restart (JavaScript asks the server for a session).
  override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleStop(): ListenableFuture<*> {
    MediaSessionHub.command("pause", null)
    return Futures.immediateVoidFuture()
  }

  // The players belong to their owners; the session never releases them.
  override fun handleRelease(): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
    val style = MediaSessionHub.style
    when (seekCommand) {
      Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> if (style.tracks) MediaSessionHub.command("next", null)
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> if (style.tracks) MediaSessionHub.command("previous", null)
      Player.COMMAND_SEEK_BACK -> MediaSessionHub.command("skip", -style.back)
      Player.COMMAND_SEEK_FORWARD -> MediaSessionHub.command("skip", style.forward)
      Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_MEDIA_ITEM ->
        if (positionMs != C.TIME_UNSET) MediaSessionHub.command("seek", positionMs.coerceAtLeast(0) / 1000.0)
    }
    return Futures.immediateVoidFuture()
  }
}

/**
 * Hosts the session as a foreground service of type mediaPlayback while something plays, so audio keeps
 * playing in the background and with the screen off; Media3 posts the media notification and keeps the
 * service in the foreground for ten minutes after a pause, so the next track can start from the background.
 */
class VelaAudioService : MediaSessionService() {
  private var session: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    // An emptied player (the queue stopped, a video took over) takes its notification with it.
    setShowNotificationForIdlePlayer(SHOW_NOTIFICATION_FOR_IDLE_PLAYER_NEVER)
    val player = SessionPlayer(this, MediaSessionHub.current(this))
    val builder = MediaSession.Builder(this, player).setId("vela")
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
      builder.setSessionActivity(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    val session = builder.build()
    this.session = session
    MediaSessionHub.attach(session, player)
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  override fun onDestroy() {
    session?.let {
      MediaSessionHub.detach(it)
      it.player.release()
      it.release()
    }
    session = null
    super.onDestroy()
  }
}
