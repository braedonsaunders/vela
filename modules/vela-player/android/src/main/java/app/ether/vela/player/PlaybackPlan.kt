// The parts of a Vela v0 playback plan (packages/protocol/types.ts, PlaybackPlan) the player reads, from
// the `plan` prop (React Native passes JSON numbers as Double).
package app.ether.vela.player

internal class PlaybackPlan(
  val sessionId: String,
  val revision: Int,
  val sourceGeneration: Int,
  val seekGeneration: Int,
  val positionSeconds: Double,
  val paths: List<PlanPath>,
  val selectedPathId: String,
  val audioTracks: List<PlanTrack>,
  val subtitleTracks: List<PlanTrack>,
  val selectedAudioTrackId: String?,
  val selectedSubtitleTrackId: String?,
  val chapters: List<PlanChapter>,
  val fallbackState: String? = null,
  val live: Boolean = false,
) {
  val selectedPath: PlanPath?
    get() = paths.firstOrNull { it.id == selectedPathId }

  fun audioTrack(id: String?): PlanTrack? = audioTracks.firstOrNull { it.id == id }

  fun subtitleTrack(id: String?): PlanTrack? = subtitleTracks.firstOrNull { it.id == id }

  companion object {
    /** A plan, or null when a required field is missing. */
    fun from(value: Map<String, Any?>): PlaybackPlan? {
      return PlaybackPlan(
        live = value.text("channelId") != null || value.map("live") != null,
        sessionId = value.text("sessionId") ?: return null,
        revision = value.int("revision") ?: return null,
        sourceGeneration = value.int("sourceGeneration") ?: return null,
        seekGeneration = value.int("seekGeneration") ?: return null,
        positionSeconds = value.number("positionSeconds") ?: 0.0,
        paths = value.objects("paths").mapNotNull(PlanPath::from),
        selectedPathId = value.text("selectedPathId") ?: return null,
        audioTracks = value.objects("audioTracks").mapNotNull(PlanTrack::from),
        subtitleTracks = value.objects("subtitleTracks").mapNotNull(PlanTrack::from),
        selectedAudioTrackId = value.text("selectedAudioTrackId"),
        selectedSubtitleTrackId = value.text("selectedSubtitleTrackId"),
        fallbackState = value.map("fallback")?.text("state"),
        chapters = value.objects("chapters").mapNotNull(PlanChapter::from),
      )
    }
  }
}

internal class PlanPath(
  val id: String,
  val sourceId: String?,
  val timelineId: String?,
  val kind: String,
  val transport: String,
  val readiness: String,
  val url: String?,
  val original: Boolean,
  /** The original's verified frame rate (OriginalVideo), for display matching before the first frame. */
  val originalFrameRate: Double?,
  val expectsVideo: Boolean = false,
  val timelineOriginSeconds: Double = 0.0,
) {
  /** An original file the server serves by byte range: the native engine's input. */
  val isOriginalFile: Boolean
    get() = original && transport == "file"

  companion object {
    fun from(value: Map<String, Any?>): PlanPath? {
      return PlanPath(
        sourceId = value.text("sourceId"),
        timelineId = value.text("timelineId"),
        id = value.text("id") ?: return null,
        kind = value.text("kind") ?: return null,
        transport = value.text("transport") ?: return null,
        readiness = value.text("readiness") ?: return null,
        url = value.text("url"),
        original = value["original"] == true,
        originalFrameRate = value.map("originalVideo")?.number("frameRate"),
        expectsVideo = value.map("originalVideo") != null,
        timelineOriginSeconds = value.number("timelineOriginSeconds")?.takeIf { it.isFinite() && it >= 0 } ?: 0.0,
      )
    }
  }
}

/** HLS prepared after a seek starts its local clock at zero, while the UI uses title time. */
internal class MediaTimeline(origin: Double = 0.0) {
  val origin = origin.takeIf { it.isFinite() && it >= 0 } ?: 0.0
  fun mediaTime(titleSeconds: Double) = (titleSeconds - origin).coerceAtLeast(0.0)
  fun titleTime(mediaSeconds: Double) = origin + mediaSeconds.coerceAtLeast(0.0)
}

internal class PlanTrack(
  val id: String,
  val name: String,
  val language: String?,
  val codec: String?,
  val channels: Int?,
  val streamIndex: Int?,
  val forced: Boolean?,
  val hearingImpaired: Boolean?,
  val url: String?,
  val deliveryKind: String?,
  val deliveryUrl: String?,
  val deliveryFormat: String? = null,
) {
  val isExternal: Boolean
    get() = deliveryKind == "external"

  val externalUrl: String?
    get() = if (isExternal) deliveryUrl ?: url else null

  // The source codec may be bitmap/SRT while the server delivers converted WebVTT.
  val externalFormat: String?
    get() = deliveryFormat ?: codec

  val canRenderExternal: Boolean
    get() = isExternal && externalFormat?.lowercase() !in listOf("vobsub", "dvd_subtitle", "pgs", "hdmv_pgs_subtitle")

  /** MergingMediaPeriod prefixes each source's Format.id with its child index. External
   * subtitle sources start at 1; source 0 is the original file and must not match by suffix. */
  fun matchesExternalFormat(formatId: String?): Boolean {
    if (!isExternal || formatId == null) return false
    if (formatId == id) return true
    val child = formatId.substringBefore(':').toIntOrNull() ?: return false
    return child > 0 && formatId.substringAfter(':') == id
  }

  /** The model.ts Track a snapshot carries. */
  val snapshot: Map<String, Any?>
    get() {
      val out = mutableMapOf<String, Any?>("id" to id, "label" to name)
      language?.let { out["language"] = it }
      codec?.let { out["codec"] = it }
      channels?.let { out["channels"] = it }
      streamIndex?.let { out["streamIndex"] = it }
      forced?.let { out["forced"] = it }
      hearingImpaired?.let { out["hearingImpaired"] = it }
      deliveryKind?.let { kind ->
        out["delivery"] = buildMap { put("kind", kind); deliveryUrl?.let { put("url", it) }; deliveryFormat?.let { put("format", it) } }
      }
      return out
    }

  companion object {
    fun from(value: Map<String, Any?>): PlanTrack? {
      val delivery = value.map("delivery")
      return PlanTrack(
        id = value.text("id") ?: return null,
        name = value.text("name") ?: return null,
        language = value.text("language"),
        codec = value.text("codec"),
        channels = value.int("channels"),
        streamIndex = value.int("streamIndex"),
        forced = value["forced"] as? Boolean,
        hearingImpaired = value["hearingImpaired"] as? Boolean,
        url = value.text("url"),
        deliveryKind = delivery?.text("kind"),
        deliveryUrl = delivery?.text("url"),
        deliveryFormat = delivery?.text("format"),
      )
    }
  }
}

internal class PlanChapter(val id: String, val name: String, val startSeconds: Double, val endSeconds: Double?) {
  val snapshot: Map<String, Any?>
    get() = buildMap {
      put("id", id)
      put("name", name)
      put("startSeconds", startSeconds)
      endSeconds?.let { put("endSeconds", it) }
    }

  companion object {
    fun from(value: Map<String, Any?>): PlanChapter? {
      return PlanChapter(
        id = value.text("id") ?: return null,
        name = value.text("name") ?: return null,
        startSeconds = value.number("startSeconds") ?: return null,
        endSeconds = value.number("endSeconds"),
      )
    }
  }
}

// Reading JSON-shaped maps.

internal fun Map<String, Any?>.text(key: String): String? = this[key] as? String

internal fun Map<String, Any?>.number(key: String): Double? = (this[key] as? Number)?.toDouble()

internal fun Map<String, Any?>.int(key: String): Int? = (this[key] as? Number)?.toInt()

@Suppress("UNCHECKED_CAST")
internal fun Map<String, Any?>.map(key: String): Map<String, Any?>? = this[key] as? Map<String, Any?>

@Suppress("UNCHECKED_CAST")
internal fun Map<String, Any?>.objects(key: String): List<Map<String, Any?>> =
  (this[key] as? List<*>)?.mapNotNull { it as? Map<String, Any?> } ?: emptyList()
