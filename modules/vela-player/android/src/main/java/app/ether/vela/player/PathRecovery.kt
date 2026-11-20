package app.ether.vela.player

/** Recovery selects only server-advertised paths, once per path and session. */
internal class PathRecovery {
  private var session = ""
  private val refused = mutableSetOf<String>()
  private val requested = mutableSetOf<String>()
  private var prepared = false
  private var liveRecoveryAt = Long.MIN_VALUE

  fun next(plan: PlaybackPlan, position: Double): Map<String, Any?>? {
    adopt(plan)
    refused.add(plan.selectedPathId)
    val candidates = plan.paths.filter {
      it.id !in refused && it.id !in requested && it.readiness in listOf("ready", "on-demand")
    }
    val path = candidates.firstOrNull { it.kind == "transcode" } ?: candidates.firstOrNull()
    if (path != null) {
      requested.add(path.id)
      return mapOf("kind" to "switch", "pathId" to path.id, "atSeconds" to position.coerceAtLeast(0.0))
    }
    if (!prepared && plan.fallbackState == "idle") {
      prepared = true
      return mapOf("kind" to "prepare-fallback", "maxBitrate" to 20_000_000)
    }
    return null
  }

  private fun adopt(plan: PlaybackPlan) {
    if (session != plan.sessionId) {
      session = plan.sessionId
      refused.clear()
      requested.clear()
      prepared = false
      liveRecoveryAt = Long.MIN_VALUE
    }
  }

  /** Expired segments cannot be replayed. Resume near the oldest available point,
   * never the live edge, and bound repeated failures while a playlist refreshes. */
  fun liveWindowPosition(plan: PlaybackPlan, windowSeconds: Double, nowMs: Long): Double? {
    adopt(plan)
    if (!plan.live || !windowSeconds.isFinite() || windowSeconds <= 0.0) return null
    if (liveRecoveryAt != Long.MIN_VALUE && nowMs - liveRecoveryAt < 5000) return null
    liveRecoveryAt = nowMs
    return minOf(6.0, windowSeconds / 4.0)
  }

  fun awaitsFallback(plan: PlaybackPlan) = session == plan.sessionId && prepared && plan.selectedPathId in refused
}
