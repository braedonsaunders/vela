package app.ether.vela.player

/** Recovery selects only server-advertised paths, once per path and session. */
internal class PathRecovery {
  private var session = ""
  private val refused = mutableSetOf<String>()
  private val requested = mutableSetOf<String>()
  private var prepared = false

  fun next(plan: PlaybackPlan, position: Double): Map<String, Any?>? {
    if (session != plan.sessionId) {
      session = plan.sessionId
      refused.clear()
      requested.clear()
      prepared = false
    }
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

  fun awaitsFallback(plan: PlaybackPlan) = session == plan.sessionId && prepared && plan.selectedPathId in refused
}
