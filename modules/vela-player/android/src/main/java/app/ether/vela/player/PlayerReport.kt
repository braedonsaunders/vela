// The contract's events in modules/vela-player/web/engine/model.ts shapes: snapshots (at most four a second, and on
// every state change), observations (at most one a second), errors, session commands and session
// refreshes. The same shapes as the Apple implementation (ios/PlayerReport.swift).
package app.ether.vela.player

import android.os.SystemClock
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

internal class PlayerReport(
  private val emitSnapshot: (Map<String, Any?>) -> Unit,
  private val emitObservation: (Map<String, Any?>) -> Unit,
  private val emitError: (Map<String, Any?>) -> Unit,
  private val emitSessionCommand: (Map<String, Any?>) -> Unit,
  private val emitSessionRefresh: (Map<String, Any?>) -> Unit,
) {
  var pathId = ""
  var audioTrackId: String? = null
  var subtitleTrackId: String? = null
  var audioClientOnly = false
  var subtitleClientOnly = false
  var backend: String? = null
  var volume = 1.0
  var muted = false
  /** A muted preview reports its state but sends the server no observations. */
  var ambient = false
  /** The server is applying a seek: observations wait for the plan that answers it. */
  var awaitingSeek = false

  private var plan: PlaybackPlan? = null
  private var previewing = false
  private var sequence = 0
  private var lastSnapshot = 0L
  private var lastPhase = ""
  private var lastObservation = 0L
  private var endedReported = ""
  private var failureReported = ""
  private val isoTime = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }

  /** Asks the playback controller to apply a session command (packages/protocol SessionCommand) for the
   * current generations; it answers with a newer plan. */
  fun sessionCommand(fields: Map<String, Any?>) {
    val plan = plan ?: return
    val command = fields + mapOf(
      "sourceGeneration" to plan.sourceGeneration,
      "seekGeneration" to plan.seekGeneration,
      "idempotencyKey" to UUID.randomUUID().toString(),
    )
    emitSessionCommand(mapOf("sessionId" to plan.sessionId, "command" to command))
  }

  /** Asks for a fresh plan: the grant behind the media URL has expired or was revoked. */
  fun sessionRefresh() {
    val plan = plan ?: return
    emitSessionRefresh(mapOf("sessionId" to plan.sessionId))
  }

  /** A preview plays: snapshots and errors without a session, and no observations. */
  fun adoptPreview() {
    plan = null
    previewing = true
    pathId = ""
    backend = "media3-preview"
    audioTrackId = null
    subtitleTrackId = null
  }

  /** A newer plan: the server's track choices, unless the viewer made their own on the device. */
  fun adopt(plan: PlaybackPlan, newSession: Boolean) {
    this.plan = plan
    previewing = false
    if (newSession) {
      audioClientOnly = false
      subtitleClientOnly = false
      sequence = 0
    }
    if (!audioClientOnly) {
      audioTrackId = plan.selectedAudioTrackId
    }
    if (!subtitleClientOnly) {
      subtitleTrackId = plan.selectedSubtitleTrackId
    }
  }

  /** Reports the state: a snapshot when due or when the phase changed, an observation when due. */
  fun publish(state: PlayerState, seekTarget: Double?, force: Boolean = false) {
    val plan = plan
    if (plan == null && !previewing) {
      return
    }
    val phase = phase(state, seekTarget)
    val now = SystemClock.elapsedRealtime()
    if (force || phase != lastPhase || now - lastSnapshot >= 250) {
      lastSnapshot = now
      lastPhase = phase
      emitSnapshot(snapshot(plan, state, phase, seekTarget))
    }
    val failure = state.failure
    if (failure != null) {
      val key = "${plan?.let(::generation) ?: "preview"}:$failure"
      if (key != failureReported) {
        failureReported = key
        emitError(mapOf("kind" to state.failureKind, "message" to failure, "recoverable" to false))
        plan?.let { observe(it, state, force = true) }
        return
      }
    }
    plan?.let { observe(it, state, force = false) }
  }

  /** The snapshot's state; a preview reports only loading, playing, paused, ended or failed. */
  private fun phase(state: PlayerState, seekTarget: Double?): String {
    val phase = state.phase
    if (ambient && phase == PlayerState.Phase.PLAYING && !state.hasFrame) return "loading"
    if (phase == PlayerState.Phase.LOADING && seekTarget != null && !previewing) {
      return "buffering"
    }
    if (phase == PlayerState.Phase.BUFFERING && previewing) {
      return "loading"
    }
    return phase.wire
  }

  // Snapshot

  private fun snapshot(plan: PlaybackPlan?, state: PlayerState, phase: String, seekTarget: Double?): Map<String, Any?> {
    val waiting = phase == "loading" || phase == "buffering"
    return mapOf(
      "sessionId" to (plan?.sessionId ?: ""),
      "sourceGeneration" to (plan?.sourceGeneration ?: 0),
      "seekGeneration" to (plan?.seekGeneration ?: 0),
      "state" to phase,
      "capabilities" to mapOf("pip" to false, "fullscreen" to false, "audioSwitch" to !previewing),
      "qualityIds" to emptyList<String>(),
      "renditions" to emptyList<Any>(),
      "audioTracks" to plan?.audioTracks.orEmpty().map { it.snapshot },
      "subtitleTracks" to (plan?.subtitleTracks.orEmpty().map { it.snapshot } + state.tracks.mapNotNull { track ->
        val id = track["id"] as? Long
        val index = (track["ff-index"] as? Long)?.toInt()
        if (plan?.selectedPath?.isOriginalFile != true || track["type"] != "sub" || track["external"] == true || id == null ||
          (index != null && plan?.subtitleTracks.orEmpty().any { it.streamIndex == index })) null
        else mapOf("id" to "mpv-sub-$id", "label" to (track["title"] ?: track["lang"] ?: "Subtitle $id"), "language" to (track["lang"] ?: "und"), "codec" to (track["codec"] ?: ""))
      }),
      "audioTrackIds" to plan?.audioTracks.orEmpty().map { it.id },
      "chapters" to plan?.chapters.orEmpty().map { it.snapshot },
      "throughputHistory" to listOfNotNull(throughput(state)),
      "speed" to 1,
      "speeds" to listOf(1),
      "subtitleStyleAvailable" to false,
      "subtitleClientOnly" to subtitleClientOnly,
      "audioClientOnly" to audioClientOnly,
      "diagnostics" to mapOf("implementation" to "vela-media3", "metadataDiscrepancies" to emptyList<String>()),
      "waiting" to waiting,
      "volume" to volume,
      "muted" to muted,
      "position" to (seekTarget ?: state.position),
      "playable" to playable(state).map { mapOf("start" to it.first, "end" to it.second) },
      "sourceId" to pathId.ifEmpty { null },
      "strategy" to plan?.paths?.firstOrNull { it.id == pathId }?.kind,
      "backend" to backend,
      "renditionId" to null,
      "lockedQuality" to null,
      "video" to video(state),
      "currentBitrateBps" to null,
      "requiredBandwidthBps" to null,
      "bufferAheadSeconds" to state.cacheAhead,
      "pendingSubtitleTrackId" to null,
      "subtitleError" to null,
      "subtitleStyle" to null,
      "live" to null,
      "seekTarget" to seekTarget,
      "preparation" to preparation(state, phase),
      "duration" to state.duration,
      "throughputBps" to throughput(state),
      "droppedFrames" to state.droppedFrames,
      "totalFrames" to null,
      "audioTrackId" to (audioTrackId ?: plan?.audioTracks?.firstOrNull { track -> state.audioId != null && track.streamIndex?.let { state.trackId("audio", it) } == state.audioId }?.id),
      "pendingAudioTrackId" to null,
      "subtitleTrackId" to subtitleTrackId,
      "failure" to state.failure?.let { mapOf("kind" to state.failureKind, "message" to it, "recoverable" to false) },
    )
  }

  private fun preparation(state: PlayerState, phase: String): String? {
    if (phase != "loading") {
      return null
    }
    return if (state.tracks.isEmpty()) "media-metadata" else "initial-buffer"
  }

  private fun video(state: PlayerState): Map<String, Any?>? {
    val width = state.videoParams["w"] as? Long ?: return null
    val height = state.videoParams["h"] as? Long ?: return null
    return mapOf(
      "width" to width,
      "height" to height,
      "codec" to (state.videoCodec ?: ""),
      "dynamicRange" to state.dynamicRange,
    )
  }

  private fun throughput(state: PlayerState): Double? = state.cacheSpeed?.let { it * 8.0 }

  private fun playable(state: PlayerState): List<Pair<Double, Double>> {
    val ahead = state.cacheAhead ?: return emptyList()
    return listOf(state.position to state.position + ahead)
  }

  // Observation

  private fun observe(plan: PlaybackPlan, state: PlayerState, force: Boolean) {
    if (ambient || pathId.isEmpty() || (awaitingSeek && !force)) {
      return
    }
    val ended = state.phase == PlayerState.Phase.ENDED
    val generation = generation(plan)
    if (ended && endedReported == generation) {
      return
    }
    val now = SystemClock.elapsedRealtime()
    val due = now - lastObservation >= 1000 && state.phase != PlayerState.Phase.LOADING
    if (!force && !ended && !due) {
      return
    }
    lastObservation = now
    if (ended) {
      endedReported = generation
    }
    sequence += 1
    val observation = mutableMapOf<String, Any?>(
      "idempotencyKey" to "$generation:$sequence",
      "sourceGeneration" to plan.sourceGeneration,
      "seekGeneration" to plan.seekGeneration,
      "sequence" to sequence,
      "observedAt" to isoTime.format(Date()),
      "positionSeconds" to state.position,
      "state" to observedState(state.phase),
      "playableRanges" to playable(state).map { mapOf("startSeconds" to it.first, "endSeconds" to it.second) },
      "selectedPathId" to pathId,
    )
    throughput(state)?.let { observation["throughputBps"] = it }
    state.droppedFrames?.let { observation["droppedFrames"] = it }
    if (!audioClientOnly) {
      audioTrackId?.let { observation["audioTrackId"] = it }
    }
    if (!subtitleClientOnly) {
      observation["subtitleTrackId"] = subtitleTrackId
    }
    state.failure?.let { observation["error"] = mapOf("class" to errorClass(state.failureKind), "message" to it) }
    emitObservation(mapOf("sessionId" to plan.sessionId, "observation" to observation))
  }

  private fun generation(plan: PlaybackPlan) = "${plan.sessionId}:${plan.sourceGeneration}:${plan.seekGeneration}"

  private fun observedState(phase: PlayerState.Phase): String = when (phase) {
    PlayerState.Phase.PLAYING -> "playing"
    PlayerState.Phase.PAUSED -> "paused"
    PlayerState.Phase.ENDED -> "ended"
    else -> "buffering"
  }

  private fun errorClass(kind: String): String = when (kind) {
    "decoder" -> "decoder"
    "network" -> "transient"
    else -> "source"
  }
}
