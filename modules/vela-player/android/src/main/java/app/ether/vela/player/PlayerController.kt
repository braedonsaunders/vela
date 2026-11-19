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
  fun keepScreenOn(on: Boolean)
}

internal class PlayerController(
  private val context: Context,
  private val host: PlayerHost,
  private val report: PlayerReport,
) {
  private val main = Handler(Looper.getMainLooper())
  private var engine: PlaybackEngine? = null
  private val recovery = PathRecovery()
  private var recovering = false
  private var state = PlayerState()
  private var plan: PlaybackPlan? = null
  private var activeSource = ""
  private var lastCommand = -1
  private var pendingSeek: Double? = null
  /** A seek the server applies (its HLS, an extra): sent as a session command, made when its plan arrives. */
  private var awaitedSeek: Double? = null
  private var wantsPlay = true
  private var displayFacts: VideoFacts? = null
  private var loggedOutput = false
  private var refreshAsked = ""
  /** A muted preview: no display matching, no screen-on, no observations. */
  var ambient = false
    set(value) {
      if (value && !field && engine != null) host.preferDisplay(null)
      field = value
      report.ambient = value
      // Props arrive in any order: a view that became ambient after it started goes quiet.
      engine?.volume(if (value || report.muted) 0f else report.volume.toFloat())
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
    val source = "${next.sessionId}:${path.id}:${next.sourceGeneration}"
    val sameFile = previous?.sessionId == next.sessionId && path.isOriginalFile &&
      previous?.selectedPath?.isOriginalFile == true &&
      (previous?.selectedPath?.url == path.url || (path.sourceId != null && previous?.selectedPath?.sourceId == path.sourceId && previous?.selectedPath?.timelineId == path.timelineId)) && previous?.selectedPath?.id == path.id
    val tracksChanged = previous?.selectedAudioTrackId != next.selectedAudioTrackId || previous?.selectedSubtitleTrackId != next.selectedSubtitleTrackId
    if (source == activeSource || (sameFile && tracksChanged && previous?.seekGeneration == next.seekGeneration)) {
      activeSource = source
      if (previous != null && next.seekGeneration != previous.seekGeneration) {
        seekConfirmed(next.positionSeconds)
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
    start(next, path, url, source)
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
    if (!ambient) {
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

  private fun start(plan: PlaybackPlan, path: PlanPath, url: Uri, source: String) {
    stop()
    activeSource = source
    state = PlayerState()
    pendingSeek = null
    awaitSeek(null)
    loggedOutput = false
    report.pathId = path.id
    report.backend = if (path.isOriginalFile) "media3-original" else "media3-${path.transport}"
    val client = Media3Engine(context, ambient)
    engine = client
    state = client.state
    recovering = false
    client.onSubtitleCues = { host.subtitles(it) }
    client.onChange = {
      if (engine === client && !recovering) {
        applyTracks()
        videoChanged()
        host.keepScreenOn(!ambient && state.phase == PlayerState.Phase.PLAYING)
        pendingSeek?.let { if (abs(state.position - it) < 2) pendingSeek = null }
        report.publish(state, pendingSeek)
      }
    }
    client.onFailure = { code, unauthorized ->
      // A rejected track and the decoder may both fail before the switch plan arrives.
      // The abandoned engine must not spend another path or race that in-flight command.
      if (engine === client && !recovering) {
        if (unauthorized) askForFreshPlan("media grant refused")
        else if (transientMediaFailure(code)) {
          state.failure = mediaFailureMessage(code)
          state.failureKind = "network"
          host.keepScreenOn(false)
          report.publish(state, null, force = true)
        } else recover(code)
      }
    }
    host.surface?.let { client.attach(it) }
    displayFacts = if (path.isOriginalFile) DisplayMatching.facts(path.originalFrameRate) else null
    if (!ambient) host.preferDisplay(displayFacts)
    client.volume(if (ambient || report.muted) 0f else report.volume.toFloat())
    client.load(url, plan, plan.positionSeconds)
    client.play(wantsPlay)
    report.publish(state, null, force = true)
  }

  private fun recover(code: Int) {
    val current = plan ?: return
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
    awaitSeek(null)
    val client = engine ?: return
    engine = null
    client.release()
    host.keepScreenOn(false)
    host.subtitles(androidx.media3.common.text.CueGroup.EMPTY_TIME_ZERO)
    if (!ambient) {
      host.preferDisplay(null)
    }
  }

  private fun videoChanged() {
    val width = (state.videoParams["w"] as? Long)?.toInt() ?: 0
    val height = (state.videoParams["h"] as? Long)?.toInt() ?: 0
    if (width > 0 && height > 0) host.videoSize(width, height)
    if (displayFacts == null && !ambient) {
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
  private fun askForFreshPlan(reason: String) {
    if (plan == null || refreshAsked == activeSource) {
      return
    }
    refreshAsked = activeSource
    activeSource = ""
    engine?.play(false)
    host.keepScreenOn(false)
    Log.i("vela-media3", "session refresh: $reason")
    report.sessionRefresh()
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
    if (!path.isOriginalFile || state.tracks.isEmpty()) {
      return
    }
    val audioIndex = plan.audioTrack(report.audioTrackId)?.streamIndex
    val audioId = audioIndex?.let { state.trackId("audio", it) }
    if (audioId != null && state.audioId != audioId) {
      engine?.select("audio", audioId)
    }
    val subtitle = plan.subtitleTrack(report.subtitleTrackId)
    val subtitleIndex = if (subtitle?.isExternal == false) subtitle.streamIndex else null
    val subtitleId = subtitleIndex?.let { state.trackId("sub", it) }
    if (subtitleId != null) {
      if (state.subtitleId != subtitleId) {
        engine?.select("sub", subtitleId)
      }
    } else if (subtitle?.isExternal == true) {
      val localId = state.tracks.firstOrNull { it["plan-id"] == subtitle.id }?.get("id") as? Long
      if (localId != null && state.subtitleId != localId) engine?.select("sub", localId)
    } else if ((subtitle == null && report.subtitleTrackId?.startsWith("mpv-sub-") != true) || subtitle?.isExternal == true) {
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
    val end = (state.duration ?: Double.MAX_VALUE) - 1
    val target = max(0.0, min(seconds, end))
    pendingSeek = target
    engine?.seek(target)
  }

  // Commands

  /** Performs a command; a refusal's reason, or null when done. */
  private fun perform(command: Map<String, Any?>): String? {
    when (val type = command.text("type") ?: "") {
      "play" -> {
        wantsPlay = true
        engine?.play(true)
      }
      "pause" -> {
        wantsPlay = false
        engine?.play(false)
      }
      "seek" -> requestSeek(command.number("seconds") ?: return "seek needs seconds")
      "seekBy" -> {
        val seconds = command.number("seconds") ?: return "seekBy needs seconds"
        requestSeek((pendingSeek ?: state.position) + seconds)
      }
      "quality", "switchPath" -> return switchPath(command.text("renditionId") ?: command.text("pathId"))
      "volume" -> {
        val value = command.number("value") ?: return "volume needs a value"
        report.volume = max(0.0, min(1.0, value))
        engine?.volume(if (ambient || report.muted) 0f else report.volume.toFloat())
      }
      "mute" -> {
        report.muted = command["muted"] as? Boolean ?: !report.muted
        engine?.volume(if (ambient || report.muted) 0f else report.volume.toFloat())
      }
      "audio" -> return selectAudio(command.text("trackId"))
      "subtitle" -> return selectSubtitle(command.text("trackId"))
      "retry" -> retry()
      else -> return "$type is not available in this player yet"
    }
    return null
  }

  /** A seek: local on an original file; on the server's HLS, a session command whose plan moves the clock. */
  private fun requestSeek(seconds: Double) {
    val end = (state.duration ?: Double.MAX_VALUE) - 1
    val target = max(0.0, min(seconds, end))
    if (playsOriginal) {
      seek(target)
      return
    }
    pendingSeek = target
    awaitSeek(target)
    report.sessionCommand(mapOf("kind" to "seek", "positionSeconds" to target))
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
      if (!playsOriginal) {
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
      val localId = state.tracks.firstOrNull { it["plan-id"] == id }?.get("id") as? Long
      if (localId == null) return "The external subtitle is not available yet"
      report.subtitleTrackId = id
      report.subtitleClientOnly = true
      engine?.select("sub", localId)
      return null
    }
    val engineId = track.streamIndex?.takeIf { playsOriginal }?.let { state.trackId("sub", it) }
    if (engineId == null) {
      report.sessionCommand(mapOf("kind" to "tracks", "subtitleTrackId" to id))
      return null
    }
    report.subtitleTrackId = id
    report.subtitleClientOnly = true
    engine?.select("sub", engineId)
    return null
  }

  /** Replays the plan as if it had just arrived. */
  private fun retry() {
    val plan = plan ?: return
    val path = plan.selectedPath ?: return
    val url = path.url?.let(MediaAccessStore::resolve) ?: return
    activeSource = ""
    state.failure = null
    start(plan, path, url, "${plan.sessionId}:${path.id}:${plan.sourceGeneration}")
  }

  private companion object {
    const val SEEK_ANSWER_MS = 10_000L
  }
}
