package app.ether.vela.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

internal interface PlayerHost {
  /** The Surface engine draws into, when it exists. */
  val surface: Surface?
  fun videoSize(width: Int, height: Int)
  fun subtitles(cues: androidx.media3.common.text.CueGroup)
  /** Display mode matching for the window the view is in. */
  fun preferDisplay(facts: VideoFacts?)
  fun describeDisplay(): String
  /** The display mode and frame-rate match state for the info card. */
  fun displayOutput(frameRate: Double?): Map<String, Any>
  fun keepScreenOn(on: Boolean)
  /** Draws text subtitles in the viewer's appearance, and keeps it for the next title. */
  fun subtitleLook(look: SubtitleLook, persist: Boolean)
  /** Picture-in-picture (phones and tablets): whether this full-screen view's video plays, null when it shows
   * none (stopped, a preview or a tile). */
  fun pictureInPicture(playing: Boolean?)
  /** Opens the picture-in-picture window: null when it opened, else why not. */
  fun enterPictureInPicture(): String?
  val pictureInPictureSupported: Boolean
}

internal class PlayerController(
  private val context: Context,
  private val host: PlayerHost,
  private val report: PlayerReport,
) : SessionOwner {
  private val main = Handler(Looper.getMainLooper())
  private val preferences = context.getSharedPreferences("vela.player", Context.MODE_PRIVATE)
  /** The viewer's delivery choices, kept per device (OutputPreferences). */
  private var output = OutputPreferences.from { preferences.getString("output.$it", null) }
  /** The viewer's playback speed for this view, applied to every engine it starts (live plays at 1×). */
  private var speed = 1.0
  init {
    report.display = { if (ownsDisplay) host.displayOutput(it) else emptyMap() }
    report.output = output
    report.television = context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK ==
      android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
    report.pictureInPicture = { ownsDisplay && engine != null && state.loaded && host.pictureInPictureSupported }
  }
  private var engine: PlaybackEngine? = null
  private val recovery = PathRecovery()
  private var recovering = false
  private var readRetryStarted = 0L
  private var readRetryAttempt = 0
  private var readRetryPosition = 0.0
  private var readRetry: Runnable? = null
  private var state = PlayerState()
  private var plan: PlaybackPlan? = null
  private var activeSource = ""
  private var startedLiveSession = ""
  private var lastCommand = -1
  private var pendingSeek: Double? = null
  /** A seek the server applies (its HLS, an extra): sent as a session command, made when its plan arrives. */
  private var awaitedSeek: Double? = null
  /** A start-over plan's position, checked once its live window is known: live HLS may join at the edge. */
  private var pendingLiveStart: Double? = null
  private var wantsPlay = true
  private var displayFacts: VideoFacts? = null
  private var loggedOutput = false
  private var refreshAsked = ""
  /** A muted preview: no display matching, no screen-on, no observations. */
  var ambient = false
    set(value) {
      if (value && !field && engine != null) host.preferDisplay(null)
      if (value) MediaSessionHub.release(this)
      field = value
      report.ambient = value
      // Props arrive in any order: a view that became ambient after it started goes quiet.
      engine?.volume(if (value || report.muted) 0f else report.volume.toFloat())
    }

  /** One tile of a multiview grid: muted until a mute command, never the display's mode. */
  var tile: Int? = null
    set(value) {
      if (value != null && field == null && !muteCommanded) report.muted = true
      if (value != null) MediaSessionHub.release(this)
      field = value
    }
  private var muteCommanded = false
  /** Whether this view may set the display's mode: full watch only, never a preview or a tile. */
  private val ownsDisplay: Boolean get() = !ambient && tile == null

  // The system's media session (notification, lock screen, Bluetooth, Assistant): full watch only.

  private var info: SessionInfo? = null

  /** The title, subtitle and artwork the system shows (the contract's `metadata` prop). */
  fun setMetadata(value: Map<String, Any?>?) {
    info = value?.let { map ->
      SessionInfo(map.text("title") ?: "", map.text("subtitle") ?: "", "", map.text("artworkUrl")?.let(MediaAccessStore::resolve))
    }
    MediaSessionHub.update(this)
  }

  override val sessionPlayer: androidx.media3.common.Player? get() = engine?.sessionPlayer
  override val sessionIsOnDemandVideo: Boolean get() = plan?.live == false
  override val sessionStyle: SessionStyle get() = SessionStyle.VIDEO
  override val sessionMetadata: androidx.media3.common.MediaMetadata? get() = (info ?: SessionInfo("", "", "", null)).metadata(spoken = false, video = true)

  /** A system command, through the same paths as the `command` prop. */
  override fun sessionCommand(command: String, seconds: Double?) {
    when (command) {
      "play" -> perform(mapOf("type" to "play"))
      "pause" -> perform(mapOf("type" to "pause"))
      "skip" -> seconds?.let { perform(mapOf("type" to "seekBy", "seconds" to it)) }
      "seek" -> seconds?.let { perform(mapOf("type" to "seek", "seconds" to (engine?.titleSeconds(it) ?: it))) }
      else -> return
    }
    report.publish(state, pendingSeek, force = true)
  }

  /** Direct play: the playing source is an original file, so seeks and its tracks are the view's own. */
  private val playsOriginal: Boolean
    get() = plan?.selectedPath?.isOriginalFile == true

  // Props

  fun setPlan(value: Map<String, Any?>?) {
    val next = value?.let(PlaybackPlan::from) ?: return
    val previous = plan
    if (previous != null && previous.sessionId == next.sessionId) {
      val stale = next.revision <= previous.revision ||
        next.sourceGeneration < previous.sourceGeneration ||
        next.seekGeneration < previous.seekGeneration
      if (stale) {
        return
      }
    }
    plan = next
    if (previous?.sessionId != next.sessionId) recovering = false
    report.adopt(next, newSession = previous?.sessionId != next.sessionId)
    if (recovering && recovery.awaitsFallback(next)) {
      val command = recovery.next(next, state.position)
      if (command != null) report.sessionCommand(command)
      if (command != null || next.fallbackState in listOf("idle", "preparing")) return
      recovering = false
      state.failure = "No playable server path is available"
      state.failureKind = "source"
      report.publish(state, null, force = true)
      return
    }
    val path = next.selectedPath ?: return
    val source = next.sourceKey(path)
    val sameFile = previous?.sessionId == next.sessionId && path.isOriginalFile &&
      previous?.selectedPath?.isOriginalFile == true &&
      (previous?.selectedPath?.url == path.url || (path.sourceId != null && previous?.selectedPath?.sourceId == path.sourceId && previous?.selectedPath?.timelineId == path.timelineId)) && previous?.selectedPath?.id == path.id
    val tracksChanged = previous?.selectedAudioTrackId != next.selectedAudioTrackId || previous?.selectedSubtitleTrackId != next.selectedSubtitleTrackId
    if (source == activeSource || (sameFile && tracksChanged && previous?.seekGeneration == next.seekGeneration)) {
      activeSource = source
      if (previous != null && next.seekGeneration != previous.seekGeneration) {
        seekConfirmed(next.positionSeconds)
      }
      // A subtitle the server just added (searched for and downloaded): Media3 takes a sidecar only
      // when the item is prepared, so the same media is prepared again where it plays, with it.
      val client = engine
      val reload = path.url?.let(MediaAccessStore::resolve)
      if (previous != null && !next.live && client != null && reload != null && path.readiness == "ready" &&
        (next.renderableSidecarIds() - previous.renderableSidecarIds()).isNotEmpty()) {
        client.load(reload, next, state.position)
        client.play(wantsPlay)
        report.publish(state, pendingSeek, force = true)
        return
      }
      applyTracks()
      return
    }
    val url = path.url?.let(MediaAccessStore::resolve)
    if (path.readiness != "ready" || url == null) {
      // Preparing or on demand: the chrome shows loading until a ready path arrives.
      report.publish(state, pendingSeek, force = true)
      return
    }
    // An initial live join uses the manifest's safe start offset rather than zero
    // (the oldest segment). Later recovery/reloads must keep explicit positions. A start-over
    // plan's playlist begins at the programme's start, where it is joined (its plan position).
    val firstJoin = next.live && startedLiveSession != next.sessionId
    val initialLiveJoin = firstJoin && !next.startOver && next.seekGeneration == 0 && next.positionSeconds <= 0.0
    if (next.live) startedLiveSession = next.sessionId
    start(next, path, url, source, if (initialLiveJoin) null else next.positionSeconds)
    if (firstJoin && next.startOver) pendingLiveStart = next.positionSeconds
  }

  fun setServerError(failure: Map<String, Any?>?) {
    val message = failure?.text("message") ?: return
    state.failure = message
    state.failureKind = failure.text("kind") ?: "source"
    engine?.play(false)
    report.publish(state, null, force = true)
  }

  /** Performs a command once; the result is the command event's payload. */
  fun setCommand(command: Map<String, Any?>?): Map<String, Any?>? {
    val id = command?.int("id") ?: return null
    if (id <= lastCommand) {
      return null
    }
    lastCommand = id
    val failure = perform(command)
    val result = mutableMapOf<String, Any?>("id" to id, "ok" to (failure == null))
    if (failure != null) {
      result["failure"] = mapOf("kind" to "action", "message" to failure, "recoverable" to true)
    }
    report.publish(state, pendingSeek, force = true)
    return result
  }

  // Surface

  fun surfaceCreated(surface: Surface) {
    engine?.attach(surface)
    if (ownsDisplay) {
      host.preferDisplay(displayFacts)
    }
  }

  fun surfaceChanged(width: Int, height: Int) {
    // Surface geometry is owned by SurfaceView.
  }

  fun surfaceDestroyed() {
    engine?.attach(null)
  }

  /** The app went to the background: playback pauses (the viewer resumes it). */
  fun enterBackground() {
    if (!ambient && engine != null) {
      wantsPlay = false
      engine?.play(false)
    }
  }

  fun release() {
    stop()
    report.publish(state, null, force = true)
  }

  /** Forget the previous plan when a preview takes over this view. */
  fun releaseForPreview() {
    release()
    plan = null
    activeSource = ""
  }

  // Playback

  private fun start(plan: PlaybackPlan, path: PlanPath, url: Uri, source: String, position: Double?) {
    if (activeSource != source) { readRetryStarted = 0L; readRetryAttempt = 0 }
    stop()
    activeSource = source
    state = PlayerState()
    pendingSeek = null
    pendingLiveStart = null
    awaitSeek(null)
    loggedOutput = false
    report.pathId = path.id
    report.backend = if (path.isOriginalFile) "media3-original" else "media3-${path.transport}"
    val client = Media3Engine(context, ambient, plan.live, tile != null, output)
    engine = client
    state = client.state
    client.subtitleOffset(report.subtitleLook.offsetSeconds)
    if (!plan.live && speed != 1.0) client.speed(speed)
    if (ownsDisplay) report.routePassthrough = runCatching { AudioRoute.probe(context).passthrough.isNotEmpty() }.getOrDefault(false)
    recovering = false
    client.onSubtitleCues = { host.subtitles(it) }
    client.onChange = change@{
      if (engine === client && !recovering) {
        if (readRetryStarted != 0L && state.position > readRetryPosition + 10) { readRetryStarted = 0L; readRetryAttempt = 0 }
        applyTracks()
        videoChanged()
        host.keepScreenOn(!ambient && state.phase == PlayerState.Phase.PLAYING)
        if (ownsDisplay) host.pictureInPicture(!state.paused && state.failure == null)
        pendingSeek?.let { if (abs(state.position - it) < 2) pendingSeek = null }
        // A live window slides under a seek; once playback settles again the seek has landed.
        if (this.plan?.live == true && state.loaded && !state.pausedForCache) pendingSeek = null
        startOverPlacement()
        val plannedDuration = plan.durationSeconds
        if (path.isOriginalFile && state.phase == PlayerState.Phase.ENDED && originalEndedEarly(state.position, plannedDuration)) {
          askForFreshPlan("original ended before its planned duration", true)
          return@change
        }
        report.publish(state, pendingSeek)
      }
    }
    client.onFailure = { code, unauthorized, originalLost ->
      // A rejected track and the decoder may both fail before the switch plan arrives.
      // The abandoned engine must not spend another path or race that in-flight command.
      if (engine === client && !recovering && readRetry == null) {
        if (originalLost) askForFreshPlan("original lost", true)
        else if (unauthorized) askForFreshPlan("media grant refused")
        else if (transientMediaFailure(code)) {
          val now = android.os.SystemClock.elapsedRealtime()
          if (readRetryStarted == 0L) readRetryStarted = now
          val wait = listOf(1000L, 2000L, 4000L, 8000L, 15000L, 15000L, 15000L).getOrNull(readRetryAttempt++)
          if (wait != null && now - readRetryStarted + wait <= 60000L) {
            val position = state.position
            readRetryPosition = position
            state.failure = null
            state.loaded = false
            state.reconnecting = true
            report.publish(state, null, force = true)
            readRetry = Runnable {
              readRetry = null
              if (engine === client) {
                client.load(url, this.plan ?: plan, position)
                client.play(wantsPlay)
              }
            }.also { main.postDelayed(it, wait) }
          } else recover(code)
        } else recover(code)
      }
    }
    host.surface?.let { client.attach(it) }
    displayFacts = if (path.isOriginalFile) DisplayMatching.facts(path.originalFrameRate) else null
    if (path.isOriginalFile) client.state.format.declaredFrameRate = path.originalFrameRate
    if (ownsDisplay) host.preferDisplay(displayFacts)
    client.volume(if (ambient || report.muted) 0f else report.volume.toFloat())
    client.load(url, plan, position)
    client.play(wantsPlay)
    if (ownsDisplay) MediaSessionHub.claim(context, this)
    report.publish(state, null, force = true)
  }

  private fun recover(code: Int) {
    val current = plan ?: return
    if (code == androidx.media3.common.PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
      val window = engine?.liveWindowSeconds ?: Double.NaN
      val position = recovery.liveWindowPosition(current, window, android.os.SystemClock.elapsedRealtime())
      val path = current.selectedPath
      val url = path?.url?.let(MediaAccessStore::resolve)
      if (position != null && path != null && url != null) {
        Log.w("vela-media3", "expired live window: resume at oldest + ${position}s of ${window}s, speed 1.0")
        start(current, path, url, activeSource, position)
        return
      }
    }
    val command = recovery.next(current, state.position)
    if (command != null) {
      recovering = true
      engine?.play(false)
      state.loaded = false
      host.keepScreenOn(false)
      report.sessionCommand(command)
    } else {
      state.failure = mediaFailureMessage(code)
      state.failureKind = "decoder"
    }
    report.publish(state, pendingSeek, force = true)
  }

  private fun stop() {
    readRetry?.let { main.removeCallbacks(it) }
    readRetry = null
    awaitSeek(null)
    val client = engine ?: return
    // The session leaves the player before it is released.
    MediaSessionHub.release(this)
    engine = null
    client.release()
    host.keepScreenOn(false)
    host.pictureInPicture(null)
    host.subtitles(androidx.media3.common.text.CueGroup.EMPTY_TIME_ZERO)
    if (ownsDisplay) {
      host.preferDisplay(null)
    }
  }

  private fun videoChanged() {
    val width = (state.videoParams["w"] as? Long)?.toInt() ?: 0
    val height = (state.videoParams["h"] as? Long)?.toInt() ?: 0
    if (width > 0 && height > 0) host.videoSize(width, height)
    if (displayFacts == null && ownsDisplay) {
      // A path without verified facts (the server's HLS) matches once the video is decoded.
      displayFacts = DisplayMatching.facts(state.frameRate)
      host.preferDisplay(displayFacts)
    }
    if (state.videoParams.isNotEmpty() && !loggedOutput) {
      loggedOutput = true
      logOutput()
    }
  }

  /** Asks once per source for a fresh plan: the grant behind the media URL has expired or was revoked. */
  private fun askForFreshPlan(reason: String, originalLost: Boolean = false) {
    if (plan == null || refreshAsked == activeSource) {
      return
    }
    refreshAsked = activeSource
    activeSource = ""
    engine?.play(false)
    host.keepScreenOn(false)
    Log.i("vela-media3", "session refresh: $reason")
    report.sessionRefresh(originalLost, state.position)
  }

  /** What the video is and what the display is, for the console. */
  private fun logOutput() {
    val input = state.videoParams
    val video = "${input["w"]}x${input["h"]} ${input["gamma"]}/${input["primaries"]}"
    val codec = state.videoCodec ?: "?"
    Log.i("vela-media3", "video $video $codec range ${state.dynamicRange}; display ${host.describeDisplay()}")
  }

  /** Selects the plan's chosen audio and subtitle streams by their source stream index. */
  private fun applyTracks() {
    val plan = plan ?: return
    val path = plan.selectedPath ?: return
    val subtitle = plan.subtitleTrack(report.subtitleTrackId)
    if (state.tracks.isEmpty() || !localSubtitleSelection(path.isOriginalFile, subtitle, report.subtitleClientOnly)) return
    val audioIndex = plan.audioTrack(report.audioTrackId)?.streamIndex
    val audioId = audioIndex?.let { state.trackId("audio", it) }
    if (path.isOriginalFile && audioId != null && state.audioId != audioId) {
      engine?.select("audio", audioId)
    }
    val subtitleId = subtitle?.let { localSubtitleId(it.id) }
    if (subtitleId != null) {
      if (state.subtitleId != subtitleId) {
        engine?.select("sub", subtitleId)
      }
    } else if (subtitle == null && report.subtitleTrackId?.startsWith("mpv-sub-") != true) {
      engine?.select("sub", null)
    }
  }

  /** The plan moved the clock (a new seek generation). A seek engine already made locally needs no second one;
   * a seek the server applied is made now, at the plan's position. */
  private fun seekConfirmed(position: Double) {
    val awaited = awaitedSeek
    awaitSeek(null)
    val target = pendingSeek
    if (awaited == null && target != null && abs(target - position) < 1.5) {
      return
    }
    seek(position)
  }

  /** While the server applies a seek, observations wait: one sent meanwhile carries the seek generation the
   * server is leaving, and is refused as stale. A seek the server never answers is dropped after 10 s. */
  private fun awaitSeek(target: Double?) {
    awaitedSeek = target
    report.awaitingSeek = target != null
    main.removeCallbacks(seekUnanswered)
    if (target != null) {
      main.postDelayed(seekUnanswered, SEEK_ANSWER_MS)
    }
  }

  private val seekUnanswered = Runnable {
    awaitSeek(null)
    pendingSeek = null
    report.publish(state, null, force = true)
  }

  private fun seek(seconds: Double) {
    val target = if (plan?.live == true) {
      // A live stream has no duration; it seeks inside the window its playlist retains.
      LiveTimeline.clamp(seconds, state.live ?: return) ?: return
    } else {
      val end = (state.duration ?: Double.MAX_VALUE) - 1
      max(0.0, min(seconds, end))
    }
    pendingSeek = target
    engine?.seek(target)
  }

  /** Start over, once the window is known: Media3 honours the plan position given at load, so this only
   * moves playback that joined the edge instead. */
  private fun startOverPlacement() {
    val target = pendingLiveStart ?: return
    if (state.live == null || !state.loaded) return
    pendingLiveStart = null
    if (pendingSeek == null && abs(state.position - target) > 5) seek(target)
  }

  // Commands

  /** Performs a command; a refusal's reason, or null when done. */
  private fun perform(command: Map<String, Any?>): String? {
    when (val type = command.text("type") ?: "") {
      "play" -> {
        wantsPlay = true
        // A long pause on live: the window may have slid past the position. Resume a little inside its
        // start, never at the edge. A window that expired under the pause and failed the player
        // (BehindLiveWindowException) already restarted near its start in recover(), still paused.
        val window = state.live
        if (plan?.live == true && pendingSeek == null && window != null) {
          LiveTimeline.resumeTarget(window, state.windowPosition)?.let { seek(it) }
        }
        engine?.play(true)
      }
      "pause" -> {
        wantsPlay = false
        engine?.play(false)
      }
      "seek" -> return requestSeek(command.number("seconds") ?: return "seek needs seconds")
      "seekBy" -> {
        val seconds = command.number("seconds") ?: return "seekBy needs seconds"
        return requestSeek((pendingSeek ?: state.position) + seconds)
      }
      "catchUp" -> return catchUp()
      "quality", "switchPath" -> return switchPath(command.text("renditionId") ?: command.text("pathId"))
      "volume" -> {
        val value = command.number("value") ?: return "volume needs a value"
        report.volume = max(0.0, min(1.0, value))
        engine?.volume(if (ambient || report.muted) 0f else report.volume.toFloat())
      }
      "mute" -> {
        muteCommanded = true
        report.muted = command["muted"] as? Boolean ?: !report.muted
        engine?.volume(if (ambient || report.muted) 0f else report.volume.toFloat())
      }
      "audio" -> return selectAudio(command.text("trackId"))
      "subtitle" -> return selectSubtitle(command.text("trackId"))
      "subtitleStyle" -> {
        val value = command.text("value") ?: ""
        val look = report.subtitleLook.updated(value)
          ?: return if (value.startsWith("subtitleOffset=")) "Invalid subtitle time offset" else "Invalid subtitle appearance preference"
        report.subtitleLook = look
        engine?.subtitleOffset(look.offsetSeconds)
        host.subtitleLook(look, persist = true)
      }
      "speed" -> {
        val value = command.number("value")
        PlaybackSpeed.refusal(value, plan?.live == true, state.format.passthrough)?.let { return it }
        speed = value!!
        engine?.speed(speed)
      }
      "outputPreference" -> return outputPreference(command.text("value") ?: "")
      "pip" -> {
        if (!ownsDisplay || engine == null) return "Picture-in-picture is unavailable"
        return host.enterPictureInPicture()
      }
      "retry" -> retry()
      else -> return "$type is not available in this player yet"
    }
    return null
  }

  /** A seek: local on an original file and inside a live window; on the server's HLS, a session command
   * whose plan moves the clock. */
  private fun requestSeek(seconds: Double): String? {
    if (plan?.live == true) {
      val window = state.live ?: return "The live window is not known yet"
      LiveTimeline.clamp(seconds, window) ?: return "seek needs a finite position"
      seek(seconds)
      return null
    }
    val end = (state.duration ?: Double.MAX_VALUE) - 1
    val target = max(0.0, min(seconds, end))
    if (playsOriginal) {
      seek(target)
      return null
    }
    pendingSeek = target
    awaitSeek(target)
    report.sessionCommand(mapOf("kind" to "seek", "positionSeconds" to target))
    return null
  }

  /** Back to live: the edge less the latency target, on the device. Playing or paused stays as it was. */
  private fun catchUp(): String? {
    if (plan?.live != true) return "Only a live stream can catch up to live"
    val window = state.live ?: return "The live window is not known yet"
    val target = LiveTimeline.catchUpTarget(window, pendingSeek ?: state.position) ?: return "No newer live media to catch up to"
    seek(target)
    return null
  }

  /** Another of the plan's paths: the server switches it and answers with a plan. */
  private fun switchPath(value: String?): String? {
    val pathId = value.orEmpty().removePrefix("path:")
    if (pathId.isEmpty()) {
      return "Automatic quality is the server's choice on this player"
    }
    if (pathId != report.pathId) {
      report.sessionCommand(mapOf("kind" to "switch", "pathId" to pathId, "atSeconds" to state.position))
    }
    return null
  }

  private fun selectAudio(id: String?): String? {
    if (id == report.audioTrackId) return null
    val track = plan?.audioTrack(id ?: return "No such audio track") ?: return "No such audio track"
    val engineId = track.streamIndex?.takeIf { playsOriginal }?.let { state.trackId("audio", it) }
    if (engineId == null) {
      report.sessionCommand(mapOf("kind" to "tracks", "audioTrackId" to id))
      return null
    }
    report.audioTrackId = id
    report.audioClientOnly = true
    engine?.select("audio", engineId)
    return null
  }

  private fun localSubtitleId(id: String): Long? =
    state.tracks.firstOrNull { it["type"] == "sub" && it["plan-id"] == id }?.get("id") as? Long

  private fun selectSubtitle(id: String?): String? {
    if (id == report.subtitleTrackId) return null
    val local = id?.takeIf { it.startsWith("mpv-sub-") }?.removePrefix("mpv-sub-")?.toLongOrNull()
    if (local != null && playsOriginal && state.tracks.any { it["type"] == "sub" && it["id"] == local }) {
      report.subtitleTrackId = id
      report.subtitleClientOnly = true
      engine?.select("sub", local)
      report.publish(state, pendingSeek, force = true)
      return null
    }
    if (id == null) {
      if (!localSubtitleSelection(playsOriginal, plan?.subtitleTrack(report.subtitleTrackId), report.subtitleClientOnly)) {
        report.sessionCommand(mapOf("kind" to "tracks", "subtitleTrackId" to null))
        return null
      }
      report.subtitleTrackId = null
      report.subtitleClientOnly = true
      engine?.select("sub", null)
      return null
    }
    val track = plan?.subtitleTrack(id) ?: return "No such subtitle track"
    val external = track.externalUrl?.let(MediaAccessStore::resolve)
    if (external != null && !track.canRenderExternal) {
      // Raw bitmap sidecars need timing/palette metadata absent from a single URL.
      // Ask the server to deliver a supported subtitle or prepare its burn-in path.
      report.sessionCommand(mapOf("kind" to "tracks", "subtitleTrackId" to id))
      return null
    }
    if (external != null) {
      val localId = localSubtitleId(id)
      report.subtitleTrackId = id
      report.subtitleClientOnly = true
      // A sidecar the plan just added is still being prepared: applyTracks selects it when it appears.
      if (localId != null) engine?.select("sub", localId)
      else report.publish(state, pendingSeek, force = true)
      return null
    }
    val engineId = if (playsOriginal) localSubtitleId(id) else null
    if (engineId == null) {
      report.sessionCommand(mapOf("kind" to "tracks", "subtitleTrackId" to id))
      return null
    }
    report.subtitleTrackId = id
    report.subtitleClientOnly = true
    engine?.select("sub", engineId)
    return null
  }

  /** A delivery choice: kept for the device, and the playing title reloads where it is to take it. */
  private fun outputPreference(value: String): String? {
    val next = output.updated(value) ?: return "Unknown output preference"
    if (next == output) return null
    output = next
    report.output = next
    preferences.edit().apply { next.values.forEach { (name, choice) -> putString("output.$name", choice) } }.apply()
    val plan = plan ?: return null
    val path = plan.selectedPath ?: return null
    val url = path.url?.let(MediaAccessStore::resolve) ?: return null
    if (engine != null && ownsDisplay && state.failure == null) start(plan, path, url, activeSource, pendingSeek ?: state.position)
    return null
  }

  /** The picture-in-picture window's play/pause action, through the command paths. */
  fun pictureInPictureControl(control: String) {
    if (control != "play" && control != "pause") return
    perform(mapOf("type" to control))
    report.publish(state, pendingSeek, force = true)
  }

  /** The selected ASS/SSA track drawn by libass at the playing position (PlaybackEngine.renderAss). */
  fun renderAss(bitmap: android.graphics.Bitmap, force: Boolean): Int = engine?.renderAss(bitmap, force) ?: -1

  /** Replays the plan as if it had just arrived. */
  private fun retry() {
    val plan = plan ?: return
    val path = plan.selectedPath ?: return
    val url = path.url?.let(MediaAccessStore::resolve) ?: return
    activeSource = ""
    state.failure = null
    start(plan, path, url, plan.sourceKey(path), state.position)
  }

  private companion object {
    const val SEEK_ANSWER_MS = 10_000L
  }
}
