package app.ether.vela.player

import android.net.Uri
import androidx.media3.datasource.DataSpec
import com.sun.net.httpserver.HttpServer
import java.io.IOException
import java.net.InetSocketAddress

private fun plan(selected: String = "original", session: String = "one", fallback: String = "idle", alternate: Boolean = true) = PlaybackPlan.from(mapOf(
  "sessionId" to session, "revision" to 1, "sourceGeneration" to 2, "seekGeneration" to 3,
  "selectedPathId" to selected, "fallback" to mapOf("state" to fallback),
  "paths" to (listOf(mapOf("id" to "original", "kind" to "direct", "transport" to "file", "readiness" to "ready")) +
    if (alternate) listOf(mapOf("id" to "converted", "kind" to "transcode", "transport" to "hls", "readiness" to "on-demand")) else emptyList())
))!!

fun main() {
  val clock = TimeshiftClock(edgeSeconds = 1200.0, edgeAtMs = 1_800_000_000_000, plannedStartSeconds = 1080.0)
  val loadedStart = clock.edgeAtMs - 100_000
  check(clock.windowStartSeconds(loadedStart) == 1100.0)
  check(clock.broadcastSeconds(loadedStart + 42_500.0) == 1142.5)
  check(clock.placement(1142.5, loadedStart, 104.0) == TimeshiftPlacement.Seek(42.5))
  check(clock.placement(1100.0, loadedStart, 104.0) == TimeshiftPlacement.Seek(0.0))
  check(clock.placement(1099.5, loadedStart, 104.0) == TimeshiftPlacement.Evicted)
  check(clock.placement(1200.0, loadedStart, 104.0) == TimeshiftPlacement.Seek(100.0))
  check(clock.placement(1196.0, loadedStart, 90.0) == TimeshiftPlacement.Live)
  check(clock.placement(1085.0, null, 120.0) == TimeshiftPlacement.Seek(5.0))
  val liveClockPlan = mapOf("sessionId" to "clock", "revision" to 1, "sourceGeneration" to 1,
    "seekGeneration" to 1, "selectedPathId" to "live")
  val clockFields = mapOf("timeshift" to mapOf("maxMinutes" to 2), "liveEdgeSeconds" to 1200, "windowStartSeconds" to 1080,
    "edgeAt" to java.time.Instant.ofEpochMilli(clock.edgeAtMs).toString())
  check(PlaybackPlan.from(liveClockPlan + ("live" to clockFields))?.timeshiftClock == clock)
  check(PlaybackPlan.from(liveClockPlan + ("live" to (clockFields + ("mode" to "startOver"))))?.timeshiftClock == null)

  for (preview in listOf(false, true)) for (live in listOf(false, true)) {
    val policy = playbackBuffering(preview, live)
    check(policy.maximumMs >= policy.minimumMs)
    check(policy.minimumMs >= policy.startMs && policy.minimumMs >= policy.resumeMs)
    check(policy.startMs == if (live) 3000 else 500)
    check(policy.resumeMs == if (live) 5000 else 1000)
    check(policy.prioritizeTime == live)
  }
  check(playbackBuffering(true, true).maximumMs == 20000)
  check(playbackBuffering(true, false).maximumMs == 5000)

  // A subtitle downloaded mid-session is a new renderable sidecar: the prepared item is rebuilt with it.
  val sidecar = { id: String, format: String -> mapOf("id" to id, "name" to id, "kind" to "subtitle", "delivery" to mapOf("kind" to "external", "format" to format, "url" to "https://media.example/$id")) }
  val withSidecars = { tracks: List<Map<String, Any?>> -> PlaybackPlan.from(mapOf("sessionId" to "s", "revision" to 2, "sourceGeneration" to 1, "seekGeneration" to 1, "selectedPathId" to "original", "paths" to emptyList<Any>(), "subtitleTracks" to tracks))!! }
  val before = withSidecars(listOf(sidecar("sub-en", "webvtt"), mapOf("id" to "embedded", "name" to "embedded", "streamIndex" to 3)))
  val after = withSidecars(listOf(sidecar("sub-en", "webvtt"), sidecar("found-nl", "webvtt"), sidecar("found-pgs", "pgs")))
  check(after.renderableSidecarIds() - before.renderableSidecarIds() == setOf("found-nl"))
  check((before.renderableSidecarIds() - before.renderableSidecarIds()).isEmpty())

  val livePlan = PlaybackPlan.from(mapOf("sessionId" to "live-window", "revision" to 1, "sourceGeneration" to 1, "seekGeneration" to 1, "selectedPathId" to "live", "channelId" to "channel", "paths" to emptyList<Any>()))!!
  val windowRecovery = PathRecovery()
  check(windowRecovery.liveWindowPosition(livePlan, 60.0, 0) == 6.0)
  check(windowRecovery.liveWindowPosition(livePlan, 60.0, 4999) == null)
  check(windowRecovery.liveWindowPosition(livePlan, 12.0, 5000) == 3.0)
  check(windowRecovery.liveWindowPosition(livePlan, 2.0, 10000) == 0.5)
  check(windowRecovery.liveWindowPosition(livePlan, Double.NaN, 15000) == null)
  check(windowRecovery.liveWindowPosition(livePlan, 0.0, 15000) == null)
  check(windowRecovery.liveWindowPosition(plan(), 60.0, 15000) == null)

  val shifted = PlanPath.from(mapOf("id" to "converted", "kind" to "transcode", "transport" to "hls", "readiness" to "ready", "timelineOriginSeconds" to 74.0))!!
  val timeline = MediaTimeline(shifted.timelineOriginSeconds)
  check(timeline.mediaTime(74.0) == 0.0) // switching audio must not seek a second 74 seconds
  check(timeline.mediaTime(104.0) == 30.0)
  check(timeline.mediaTime(10.0) == 0.0)
  check(timeline.titleTime(30.0) == 104.0)
  check(timeline.titleTime(6369.0) == 6443.0) // preserve the full title's duration
  check(MediaTimeline().mediaTime(104.0) == 104.0)
  check(MediaTimeline().titleTime(104.0) == 104.0)
  check(MediaTimeline(Double.NaN).origin == 0.0)
  check(MediaTimeline(-1.0).origin == 0.0)
  // Issue #62: a seek that restarts the server's encoder keeps the URL and source generation; the item is new.
  fun vod(seek: Int, origin: Double, transport: String = "hls", original: Boolean = false, live: Boolean = false) = PlaybackPlan.from(mapOf(
    "sessionId" to "s", "revision" to 1, "sourceGeneration" to 2, "seekGeneration" to seek, "positionSeconds" to origin + 5,
    "selectedPathId" to "converted", "live" to if (live) mapOf("mode" to "adaptive") else null,
    "paths" to listOf(mapOf("id" to "converted", "kind" to "transcode", "transport" to transport, "readiness" to "ready",
      "original" to original, "url" to "/v1/media/s/index.m3u8", "timelineOriginSeconds" to origin))))!!
  fun key(plan: PlaybackPlan) = plan.sourceKey(plan.selectedPath!!)
  check(key(vod(3, 90.0)) != key(vod(4, 2000.0)))
  check(key(vod(3, 90.0)) == key(vod(3, 90.0)))
  check(key(vod(3, 90.0)) != key(vod(3, 88.0))) // a measured origin in a same-generation plan is a new clock
  check(MediaTimeline.of(vod(4, 2000.0)).mediaTime(2005.0) == 5.0)
  check(key(vod(3, 0.0, "file", original = true)) == key(vod(4, 0.0, "file", original = true)))
  check(key(vod(3, 0.0, "file", original = true)) == "s:converted:2")
  check(key(vod(3, 90.0, live = true)) == key(vod(4, 90.0, live = true)))
  check(MediaTimeline.of(vod(3, 90.0, live = true)).origin == 0.0)
  check(MediaTimeline.of(vod(3, 90.0, "file", original = true)).origin == 0.0)
  val sdrDecoder = VideoDecoderFacts("avc", "h264", "video/avc", 1920, 1080, 60.0, listOf(8 to 4096), emptySet())
  val hdrDecoder = VideoDecoderFacts("hevc", "hevc", "video/hevc", 3840, 2160, 30.0, listOf(2 to 16384), setOf("hdr10", "hlg"))
  check(playableHdr(listOf("hdr10", "hlg", "dv"), listOf(sdrDecoder)).isEmpty())
  check(playableHdr(emptyList(), listOf(hdrDecoder)).isEmpty())
  check(playableHdr(listOf("hdr10"), listOf(hdrDecoder.copy(hardware = false))).isEmpty())
  check(sdrDecoder.copy(hardware = false).snapshot["hardware"] == false)
  check(playableHdr(listOf("hdr10", "dv", "hlg"), listOf(hdrDecoder)) == listOf("hdr10", "hlg"))
  check(maximumVideoSize(listOf(sdrDecoder, hdrDecoder)) == (3840 to 2160))
  check(maximumVideoSize(emptyList()) == null)
  check((hdrDecoder.snapshot["profiles"] as List<*>).isNotEmpty())
  check(missingSupportedVideo(true, false, false, true))
  check(missingSupportedVideo(true, true, false, false))
  check(!missingSupportedVideo(false, false, false, true))
  check(!missingSupportedVideo(true, true, true, true))
  check(!missingSupportedVideo(true, false, false, false))
  check(originalLostResponse(409, "original_lost"))
  check(!originalLostResponse(409, "other"))
  check(!originalLostResponse(410, "original_lost"))
  check(originalEndedEarly(120.0, 300.0))
  check(!originalEndedEarly(299.5, 300.0))
  check(!originalEndedEarly(120.0, null))
  check(PlanPath.from(mapOf("id" to "file", "kind" to "direct", "transport" to "file", "readiness" to "ready", "originalVideo" to mapOf("codec" to "ffv1")))!!.expectsVideo)
  listOf(503, 429, 2000, 2001, 2002).forEach { check(transientMediaFailure(it)) }
  listOf(3001, 4005, 403).forEach { check(!transientMediaFailure(it)) }
  check(mediaFailureMessage(503).contains("temporarily unavailable"))
  check(!mediaFailureMessage(4005).contains("4005"))
  fun delivered(codec: String, format: String? = null) = PlanTrack.from(mapOf("id" to "captions", "name" to "Captions", "codec" to codec,
    "delivery" to mapOf("kind" to "external", "url" to "/captions", "format" to format)))!!
  check(localSubtitleSelection(false, delivered("srt", "webvtt"), false))
  check(localSubtitleSelection(false, null, true))
  check(localSubtitleSelection(true, null, false))
  check(!localSubtitleSelection(false, delivered("vobsub"), false))
  check(!localSubtitleSelection(false, null, false))
  check(!delivered("vobsub").canRenderExternal)
  check(!delivered("hdmv_pgs_subtitle").canRenderExternal)
  check(delivered("vobsub", "webvtt").canRenderExternal)
  check(delivered("srt", "webvtt").externalFormat == "webvtt")
  check(delivered("srt").externalFormat == "srt")
  check((delivered("srt", "webvtt").snapshot["delivery"] as Map<*, *>)["format"] == "webvtt")
  val external = PlanTrack.from(mapOf("id" to "captions:en", "name" to "English", "delivery" to mapOf("kind" to "external")))!!
  check(external.matchesExternalFormat("captions:en"))
  check(external.matchesExternalFormat("1:captions:en"))
  check(external.matchesExternalFormat("12:captions:en"))
  check(!external.matchesExternalFormat("0:captions:en"))
  check(!external.matchesExternalFormat("1:other"))
  check(!external.matchesExternalFormat(null))
  check(!PlanTrack.from(mapOf("id" to "captions:en", "name" to "Embedded"))!!.matchesExternalFormat("1:captions:en"))
  val recovery = PathRecovery()
  check(recovery.next(plan(), 123.0) == mapOf("kind" to "switch", "pathId" to "converted", "atSeconds" to 123.0))
  check(recovery.next(plan(selected = "converted", fallback = "unsupported"), 123.0) == null)
  check(recovery.next(plan(session = "two"), -2.0)?.get("atSeconds") == 0.0)
  val lazy = PathRecovery()
  check(lazy.next(plan(alternate = false), 5.0)?.get("kind") == "prepare-fallback")
  check(lazy.next(plan(alternate = false), 5.0) == null)
  check(lazy.awaitsFallback(plan(fallback = "preparing")))
  check(lazy.next(plan(fallback = "ready"), 5.0)?.get("pathId") == "converted")

  val scope = MediaScope("http://example.com", "/media")
  check(scope.contains("http://example.com:80/media/file"))
  check(MediaScope("http://example.com", "/media%20folder").contains("http://example.com/media%20folder/file"))
  check(MediaScope("http://example.com", "/media folder").contains("http://example.com/media%20folder/file"))
  check(!scope.contains("http://example.com/media/%252e%252e/private"))
  check(!scope.contains("http://example.com/media/%25%32%65%25%32%65/private"))
  check(!scope.contains("http://example.com/media/%00/private"))
  check(runCatching { MediaScope("http://example.com", "/media?scope") }.isFailure)
  listOf("http://evil.com/media/file", "http://example.com/medial/file", "https://example.com/media/file",
    "http://example.com/media/%2e%2e/private", "http://user@example.com/media/file").forEach { check(!scope.contains(it)) }

  val seen = mutableListOf<Pair<String, String?>>()
  val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
  val origin = "http://127.0.0.1:${server.address.port}"
  val outside = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
  outside.createContext("/") { request ->
    synchronized(seen) { seen += "other-origin" to request.requestHeaders.getFirst("Authorization") }
    request.responseHeaders.add("Location", origin + "/media/file")
    request.sendResponseHeaders(302, -1)
    request.close()
  }
  outside.start()
  server.createContext("/") { request ->
    synchronized(seen) { seen += request.requestURI.path to request.requestHeaders.getFirst("Authorization") }
    val next = when(request.requestURI.path) {
      "/media/cross-origin" -> "http://127.0.0.1:${outside.address.port}/redirect"
      "/media/start" -> "/media/file"
      "/media/escape" -> "/outside"
      "/outside" -> "/media/file"
      "/media/loop" -> "/media/loop"
      else -> null
    }
    if (request.requestURI.path == "/media/refused") {
      request.sendResponseHeaders(403, -1)
    } else if (request.requestURI.path == "/media/original-lost") {
      request.responseHeaders.add("X-Ether-Playback-Error", "original_lost")
      request.sendResponseHeaders(409, -1)
    } else if (request.requestURI.path == "/media/truncated") {
      request.sendResponseHeaders(200, 10)
      request.responseBody.write("01234".toByteArray())
      // HttpServer can buffer headers and body until a successful close.
      request.responseBody.flush()
    } else if (request.requestURI.path == "/media/range") {
      val bytes = "3456".toByteArray()
      request.responseHeaders.add("Content-Range", "bytes 3-6/10")
      request.sendResponseHeaders(206, bytes.size.toLong())
      request.responseBody.write(bytes)
    } else if (request.requestURI.path == "/media/bad-range") {
      request.responseHeaders.add("Content-Range", "bytes 0-3/10")
      request.sendResponseHeaders(206, 4)
      request.responseBody.write("0123".toByteArray())
    } else if (next != null) {
      request.responseHeaders.add("Location", next)
      request.sendResponseHeaders(302, -1)
    } else {
      val bytes = "0123456789".toByteArray()
      request.sendResponseHeaders(200, bytes.size.toLong())
      request.responseBody.write(bytes)
    }
    request.close()
  }
  server.start()
  try {
    val grant = MediaAccess.from(mapOf("origin" to origin, "pathPrefix" to "/media", "headers" to mapOf("Authorization" to "fixture")))
    fun read(path: String, position: Long = 0, length: Long = -1): String {
      val source = ScopedMediaDataSource(grant)
      try {
        source.open(DataSpec(Uri.parse(origin + path), position, length))
        val bytes = ByteArray(20)
        val count = source.read(bytes, 0, bytes.size)
        return String(bytes, 0, count)
      } finally { source.close() }
    }
    val capturedFactory = ScopedMediaDataSource.Factory(grant)
    MediaAccessStore.current = MediaAccess.from(mapOf("origin" to origin, "pathPrefix" to "/outside", "headers" to mapOf("Authorization" to "replacement")))
    val captured = capturedFactory.createDataSource()
    try {
      captured.open(DataSpec(Uri.parse(origin + "/media/file")))
      check(seen.last().second == "fixture")
    } finally { captured.close() }
    check(read("/media/start") == "0123456789")
    check(seen.takeLast(2).all { it.second == "fixture" })
    check(read("/media/escape") == "0123456789")
    check(seen.takeLast(3).map { it.second } == listOf("fixture", null, null))
    check(read("/media/cross-origin") == "0123456789")
    check(seen.takeLast(3).map { it.second } == listOf("fixture", null, null))
    check(read("/media/file", 3, 4) == "3456")
    check(read("/media/range", 3, 4) == "3456")
    check(runCatching { read("/media/bad-range", 3, 4) }.exceptionOrNull()?.message == "Media request failed")
    check((runCatching { read("/media/refused") }.exceptionOrNull() as MediaHttpFailure).status == 403)
    check((runCatching { read("/media/original-lost") }.exceptionOrNull() as MediaHttpFailure).originalLost)
    for (original in listOf(true, false)) {
      val source = ScopedMediaDataSource(grant, isOriginal = { original })
      try {
        check(source.open(DataSpec(Uri.parse(origin + "/media/truncated"))) == 10L)
        val bytes = ByteArray(20)
        var delivered = 0
        val failure = runCatching {
          while (true) {
            val count = source.read(bytes, 0, bytes.size)
            if (count < 0) break
            delivered += count
          }
        }.exceptionOrNull()
        check(delivered == 5) { "Truncation fixture delivered $delivered of 10 bytes" }
        check(failure is IOException && (failure is OriginalLostFailure) == original) {
          "Unexpected truncation failure for original=$original: $failure"
        }
      } finally { source.close() }
    }
    val beforeLoop = seen.size
    check(runCatching { read("/media/loop") }.isFailure)
    check(seen.size - beforeLoop == 9)
    check(read("/outside") == "0123456789")
    check(seen.takeLast(2).all { it.second == null })
  } finally { server.stop(0); outside.stop(0) }
  println("Android recovery and scoped HTTP passed")
}
