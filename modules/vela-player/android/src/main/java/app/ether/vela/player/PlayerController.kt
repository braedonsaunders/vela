// Playback for one VelaPlayerView: the plan's selected ready path on libmpv, the contract's commands,
// and the state reports. The same behaviour as the Apple view (ios/VelaPlayerView.swift):
//   - `plan`: the selected ready path plays (an original file or the server's HLS). A newer plan of
//     the same source moves the clock only when its seek generation changed.
//   - `command`: { id, type, ... } (client/player/model.ts Command); each id is consumed once.
// On an original file (direct play) seeks and the file's own tracks change here; anything the server
// must apply (a seek on its HLS, a track the file does not carry, a path switch) is a session command,
// and the view moves when the answering plan arrives. A refused media request asks for a fresh plan.
// Before an original's first frame, the display is asked for its frame rate (mpv waits, paused).
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
  /** The Surface mpv draws into, when it exists. */
  val surface: Surface?
  /** Display mode matching for the window the view is in. */
  fun preferDisplay(facts: VideoFacts?)
  /** The window asked for a display mode the display has not reached yet. */
  fun displaySwitching(): Boolean
  fun describeDisplay(): String
  fun keepScreenOn(on: Boolean)
}

internal class PlayerController(
  private val context: Context,
  private val host: PlayerHost,
  private val report: PlayerReport,
) {
  private val main = Handler(Looper.getMainLooper())
  private var mpv: MpvClient? = null
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
      field = value
      report.ambient = value
      // Props arrive in any order: a view that became ambient after it started goes quiet.
      mpv?.set("mute", value || report.muted)
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
    report.adopt(next, newSession = previous?.sessionId != next.sessionId)
    val path = next.selectedPath ?: return
    val source = "${next.sessionId}:${path.id}:${next.sourceGeneration}"
    if (source == activeSource) {
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
    mpv?.set("pause", true)
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
    mpv?.attach(surface)
    if (!ambient) {
      host.preferDisplay(displayFacts)
    }
  }

  fun surfaceChanged(width: Int, height: Int) {
    mpv?.resize(width, height)
  }

  fun surfaceDestroyed() {
    mpv?.attach(null)
  }

  /** The app went to the background: playback pauses (the viewer resumes it). */
  fun enterBackground() {
    if (!ambient && mpv != null) {
      wantsPlay = false
      mpv?.set("pause", true)
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
    report.backend = if (path.isOriginalFile) "mpv-original" else "mpv-hls"
    val client = try {
      MpvClient(
        mapOf(
          "pause" to "yes",
          "mute" to if (ambient) "yes" else "no",
          "tls-ca-file" to TrustStore.file(context).path,
        ),
      )
    } catch (error: Exception) {
      state.failure = error.message ?: "The player could not start"
      state.failureKind = "decoder"
      report.publish(state, null, force = true)
      return
    }
    mpv = client
    client.onProperty = { name, value -> propertyChanged(name, value) }
    client.onEvent = { event -> event(event) }
    for ((name, format) in PlayerState.observed) {
      client.observe(name, format)
    }
    host.surface?.let { client.attach(it) }
    val subtitle = plan.subtitleTrack(report.subtitleTrackId)
    val options = mutableListOf("start=${plan.positionSeconds}")
    if (path.isOriginalFile) {
      // Source stream indexes are FFmpeg's; mpv selects by its own ids, mapped once loaded (applyTracks).
      options += if (subtitle == null || subtitle.isExternal) "sid=no" else "sid=auto"
    }
    displayFacts = if (path.isOriginalFile) DisplayMatching.facts(path.originalFrameRate) else null
    if (!ambient) {
      host.preferDisplay(displayFacts)
    }
    report.publish(state, null, force = true)
    // A credentialed URL's redirects are resolved first; mpv loads where they end.
    MediaRedirects.resolve(url) { media ->
      if (activeSource == source && mpv === client) {
        load(client, media, options)
      }
    }
  }

  /** Loads the resolved URL with its headers; with headers attached, no redirect is followed. */
  private fun load(client: MpvClient, media: ResolvedMedia, options: List<String>) {
    client.setRequestHeaders(media.headerFields)
    // Never the URL or the headers: only what kind of request this is.
    val access = if (media.headerFields.isEmpty()) "no media headers, redirects followed" else "media headers, no redirects"
    Log.i(MpvClient.LOG_TAG, "load ${report.backend} from ${MediaAccess.originOf(media.url)} ($access)")
    client.command("loadfile", media.url.toString(), "replace", "-1", options.joinToString(","))
  }

  private fun stop() {
    awaitSeek(null)
    val client = mpv ?: return
    mpv = null
    client.destroy()
    host.keepScreenOn(false)
    if (!ambient) {
      host.preferDisplay(null)
    }
  }

  // mpv

  private fun propertyChanged(name: String, value: Any?) {
    state.update(name, value)
    when (name) {
      "track-list" -> applyTracks()
      "video-params" -> videoChanged()
      "pause", "paused-for-cache" -> host.keepScreenOn(!ambient && state.phase == PlayerState.Phase.PLAYING)
      "time-pos" -> {
        val target = pendingSeek
        if (target != null && abs(state.position - target) < 2 && !state.seeking) {
          pendingSeek = null
        }
      }
    }
    report.publish(state, pendingSeek)
  }

  private fun videoChanged() {
    if (displayFacts == null && !ambient) {
      // A path without verified facts (the server's HLS) matches once the video is decoded.
      displayFacts = DisplayMatching.facts(state.frameRate)
      host.preferDisplay(displayFacts)
    }
    if (state.videoParams.isNotEmpty()) {
      logOutput()
    }
  }

  private fun event(event: MpvClient.Event) {
    when (event) {
      MpvClient.Event.FileLoaded -> {
        state.loaded = true
        applyTracks()
        resumeAfterDisplaySwitch(0)
      }
      is MpvClient.Event.EndFile -> {
        if (event.reason == MpvEvent.END_REASON_ERROR) {
          state.failure = "The media could not be played (${MpvNative.errorString(event.error)})"
          state.failureKind = if (event.error == MpvEvent.ERROR_LOADING_FAILED) "network" else "source"
        }
      }
      MpvClient.Event.SeekDone -> {
        pendingSeek = null
        if (!loggedOutput) {
          loggedOutput = true
          logOutput()
        }
      }
      is MpvClient.Event.Refused -> askForFreshPlan("media request refused (${event.status})")
    }
    report.publish(state, pendingSeek, force = true)
  }

  /** Asks once per source for a fresh plan: the grant behind the media URL has expired or was revoked. */
  private fun askForFreshPlan(reason: String) {
    if (plan == null || refreshAsked == activeSource) {
      return
    }
    refreshAsked = activeSource
    Log.i(MpvClient.LOG_TAG, "session refresh: $reason")
    report.sessionRefresh()
  }

  /** Unpauses once the display has finished switching modes (it blanks meanwhile), at most 6 s. */
  private fun resumeAfterDisplaySwitch(waited: Long) {
    if (!ambient && host.displaySwitching() && waited < 6000) {
      main.postDelayed({ resumeAfterDisplaySwitch(waited + 100) }, 100)
      return
    }
    mpv?.set("pause", !wantsPlay)
  }

  /** What the video is and what the display is, for the console. */
  private fun logOutput() {
    val input = state.videoParams
    val video = "${input["w"]}x${input["h"]} ${input["gamma"]}/${input["primaries"]}"
    val codec = state.videoCodec ?: "?"
    Log.i(MpvClient.LOG_TAG, "video $video $codec range ${state.dynamicRange}; display ${host.describeDisplay()}")
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
      mpv?.set("aid", audioId.toString())
    }
    val subtitle = plan.subtitleTrack(report.subtitleTrackId)
    val subtitleIndex = if (subtitle?.isExternal == false) subtitle.streamIndex else null
    val subtitleId = subtitleIndex?.let { state.trackId("sub", it) }
    if (subtitleId != null) {
      if (state.subtitleId != subtitleId) {
        mpv?.set("sid", subtitleId.toString())
      }
    } else if (subtitle == null || subtitle.isExternal) {
      mpv?.set("sid", "no")
    }
  }

  /** The plan moved the clock (a new seek generation). A seek mpv already made locally needs no second one;
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
    mpv?.command("seek", target.toString(), "absolute+keyframes")
  }

  // Commands

  /** Performs a command; a refusal's reason, or null when done. */
  private fun perform(command: Map<String, Any?>): String? {
    when (val type = command.text("type") ?: "") {
      "play" -> {
        wantsPlay = true
        mpv?.set("pause", false)
      }
      "pause" -> {
        wantsPlay = false
        mpv?.set("pause", true)
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
        mpv?.set("volume", report.volume * 100)
      }
      "mute" -> {
        report.muted = command["muted"] as? Boolean ?: !report.muted
        mpv?.set("mute", report.muted)
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
    val track = plan?.audioTrack(id ?: return "No such audio track") ?: return "No such audio track"
    val mpvId = track.streamIndex?.takeIf { playsOriginal }?.let { state.trackId("audio", it) }
    if (mpvId == null) {
      report.sessionCommand(mapOf("kind" to "tracks", "audioTrackId" to id))
      return null
    }
    report.audioTrackId = id
    report.audioClientOnly = true
    mpv?.set("aid", mpvId.toString())
    return null
  }

  private fun selectSubtitle(id: String?): String? {
    if (id == null) {
      if (!playsOriginal) {
        report.sessionCommand(mapOf("kind" to "tracks", "subtitleTrackId" to null))
        return null
      }
      report.subtitleTrackId = null
      report.subtitleClientOnly = true
      mpv?.set("sid", "no")
      return null
    }
    val track = plan?.subtitleTrack(id) ?: return "No such subtitle track"
    val external = track.externalUrl?.let(MediaAccessStore::resolve)
    if (external != null) {
      report.subtitleTrackId = id
      report.subtitleClientOnly = true
      mpv?.command("sub-add", external.toString(), "select")
      return null
    }
    val mpvId = track.streamIndex?.takeIf { playsOriginal }?.let { state.trackId("sub", it) }
    if (mpvId == null) {
      report.sessionCommand(mapOf("kind" to "tracks", "subtitleTrackId" to id))
      return null
    }
    report.subtitleTrackId = id
    report.subtitleClientOnly = true
    mpv?.set("sid", mpvId.toString())
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
