package app.ether.vela.player

import android.net.Uri
import androidx.media3.datasource.DataSpec
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress

private fun plan(selected: String = "original", session: String = "one", fallback: String = "idle", alternate: Boolean = true) = PlaybackPlan.from(mapOf(
  "sessionId" to session, "revision" to 1, "sourceGeneration" to 2, "seekGeneration" to 3,
  "selectedPathId" to selected, "fallback" to mapOf("state" to fallback),
  "paths" to (listOf(mapOf("id" to "original", "kind" to "direct", "transport" to "file", "readiness" to "ready")) +
    if (alternate) listOf(mapOf("id" to "converted", "kind" to "transcode", "transport" to "hls", "readiness" to "on-demand")) else emptyList())
))!!

fun main() {
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
    val beforeLoop = seen.size
    check(runCatching { read("/media/loop") }.isFailure)
    check(seen.size - beforeLoop == 9)
    check(read("/outside") == "0123456789")
    check(seen.takeLast(2).all { it.second == null })
  } finally { server.stop(0); outside.stop(0) }
  println("Android recovery and scoped HTTP passed")
}
