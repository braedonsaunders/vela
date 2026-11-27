// Runs the production offline transfer (OfflineTransfer.kt) on a stock JVM against local servers:
// Range + If-Range resume, restart on a changed file, refusals, same-origin redirects, poster and sidecars.
package app.ether.vela.player

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.io.IOException
import java.net.InetSocketAddress

private class Seen(val path: String, val authorization: String?, val range: String?, val ifRange: String?)

fun main() {
  rules()
  val seen = mutableListOf<Seen>()
  val otherSeen = mutableListOf<Seen>()
  var body = ByteArray(1000) { (it % 251).toByte() }
  var etag = "\"v1\""
  var cutAt = -1
  val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
  val other = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
  val origin = "http://127.0.0.1:${server.address.port}"
  val otherOrigin = "http://127.0.0.1:${other.address.port}"
  fun record(list: MutableList<Seen>, request: HttpExchange) = synchronized(list) {
    list += Seen(request.requestURI.path, request.requestHeaders.getFirst("Authorization"),
      request.requestHeaders.getFirst("Range"), request.requestHeaders.getFirst("If-Range"))
  }
  other.createContext("/") { request ->
    record(otherSeen, request)
    val bytes = "1\n00:00:01,000 --> 00:00:02,000\nOther\n".toByteArray()
    request.sendResponseHeaders(200, bytes.size.toLong())
    request.responseBody.write(bytes)
    request.close()
  }
  server.createContext("/") { request ->
    record(seen, request)
    val path = request.requestURI.path
    fun status(code: Int) { request.sendResponseHeaders(code, -1); request.close() }
    fun redirect(to: String) { request.responseHeaders.add("Location", to); status(302) }
    when (path) {
      "/media/refused" -> status(403)
      "/media/unauthorized" -> status(401)
      "/media/limited" -> status(429)
      "/media/unavailable" -> status(503)
      "/media/missing" -> status(404)
      "/media/redirect" -> redirect("/media/file")
      "/media/away" -> redirect("$otherOrigin/media/file")
      "/media/loop" -> redirect("/media/loop")
      "/poster" -> {
        val bytes = byteArrayOf(1, 2, 3)
        request.responseHeaders.add("Content-Type", "image/png")
        request.sendResponseHeaders(200, bytes.size.toLong())
        request.responseBody.write(bytes)
        request.close()
      }
      "/subs/en" -> {
        val bytes = "1\n00:00:01,000 --> 00:00:02,000\nHello\n".toByteArray()
        request.sendResponseHeaders(200, bytes.size.toLong())
        request.responseBody.write(bytes)
        request.close()
      }
      "/subs/away" -> redirect("$otherOrigin/subs/x")
      else -> {
        val range = request.requestHeaders.getFirst("Range")?.let { Regex("bytes=(\\d+)-").matchEntire(it)?.groupValues?.get(1)?.toInt() }
        val ifRange = request.requestHeaders.getFirst("If-Range")
        request.responseHeaders.add("ETag", etag)
        request.responseHeaders.add("Last-Modified", "Wed, 01 Jan 2025 00:00:00 GMT")
        val from = if (range != null && (ifRange == null || ifRange == etag)) range else 0
        val bytes = body.copyOfRange(from, body.size)
        if (from > 0) request.responseHeaders.add("Content-Range", "bytes $from-${body.size - 1}/${body.size}")
        request.sendResponseHeaders(if (from > 0) 206 else 200, bytes.size.toLong())
        if (cutAt in 1 until bytes.size) {
          // A connection that drops part-way: the client sees a short body.
          request.responseBody.write(bytes, 0, cutAt)
          request.responseBody.flush()
          cutAt = -1
          request.close()
          return@createContext
        }
        request.responseBody.write(bytes)
        request.close()
      }
    }
  }
  server.start()
  other.start()
  val scratch = java.nio.file.Files.createTempDirectory("vela-offline-transfer").toFile()
  try {
    fun request(url: String, etag: String? = null, byteLength: Long? = null, poster: String? = null,
      sidecars: List<Map<String, String>> = emptyList(), title: String = "title") = DownloadRequest.from(mapOf(
      "serverId" to "server", "viewerId" to "viewer", "titleId" to title, "url" to url,
      "headers" to mapOf("Authorization" to "secret-token"), "container" to "mkv", "mimeType" to "video/x-matroska",
      "etag" to etag, "byteLength" to byteLength?.toDouble(), "wifiOnly" to false, "posterUrl" to poster, "sidecars" to sidecars))
    fun dir(title: String = "title") = File(scratch, "server/viewer/$title")
    fun run(request: DownloadRequest, title: String = "title") = OfflineTransfer(request, dir(title)) { _, _ -> }.run()

    // A whole download with its poster and sidecars; credentials only at the original's origin.
    val done = run(request("$origin/media/file", poster = "$origin/poster", sidecars = listOf(
      mapOf("trackId" to "en", "format" to "SRT", "url" to "$origin/subs/en"),
      mapOf("trackId" to "other", "format" to "srt", "url" to "$otherOrigin/subs/other"),
      mapOf("trackId" to "away", "format" to "srt", "url" to "$origin/subs/away"),
      mapOf("trackId" to "../escape", "format" to "srt", "url" to "$origin/subs/en"))))
    check(done is TransferOutcome.Completed) { "$done" }
    done as TransferOutcome.Completed
    check(done.mediaPath == "server/viewer/title/media.mkv" && done.bytes == 1000L && done.etag == "\"v1\"")
    check(done.posterPath == "server/viewer/title/poster.png")
    check(done.sidecarPaths == mapOf("en" to "server/viewer/title/sidecars/en.srt", "other" to "server/viewer/title/sidecars/other.srt"))
    check(File(dir(), "media.mkv").readBytes().contentEquals(body))
    check(!File(dir(), "media.mkv.part").exists() && !File(dir(), "media.mkv.part.json").exists())
    check(File(dir(), "sidecars/en.srt").readText().contains("Hello"))
    check(seen.filter { it.path in listOf("/media/file", "/poster", "/subs/en", "/subs/away") }.all { it.authorization == "secret-token" })
    check(otherSeen.single().authorization == null && otherSeen.single().path == "/subs/other") // the redirect away is never followed
    check(scratch.walkTopDown().none { it.isFile && it.readBytes().toString(Charsets.ISO_8859_1).contains("secret-token") })
    check(scratch.walkTopDown().none { it.isFile && it.readBytes().toString(Charsets.ISO_8859_1).contains("127.0.0.1") })

    // A dropped connection keeps the partial file; the next attempt resumes it with Range and If-Range.
    seen.clear()
    cutAt = 400
    val cut = run(request("$origin/media/file"), "resume")
    check(cut is TransferOutcome.Retry && cut.bytesWritten == 400L && cut.progressed) { "$cut" }
    check(File(dir("resume"), "media.mkv.part").length() == 400L)
    val resumed = run(request("$origin/media/file"), "resume")
    check(resumed is TransferOutcome.Completed) { "$resumed" }
    check(seen.last().range == "bytes=400-" && seen.last().ifRange == "\"v1\"")
    check(File(dir("resume"), "media.mkv").readBytes().contentEquals(body))

    // The file changed between attempts: If-Range answers 200 and the download restarts from zero.
    cutAt = 300
    check(run(request("$origin/media/file"), "changed") is TransferOutcome.Retry)
    body = ByteArray(1000) { (it % 13).toByte() }
    etag = "\"v2\""
    val restarted = run(request("$origin/media/file"), "changed")
    check(restarted is TransferOutcome.Completed && restarted.etag == "\"v2\"") { "$restarted" }
    check(File(dir("changed"), "media.mkv").readBytes().contentEquals(body))
    // A new identity asked for (another ETag) never resumes the old partial file.
    cutAt = 250
    check(run(request("$origin/media/file"), "identity") is TransferOutcome.Retry)
    etag = "\"v3\""
    seen.clear()
    check(run(request("$origin/media/file", etag = "\"v3\""), "identity") is TransferOutcome.Completed)
    check(seen.last().range == null)
    // What the server sends is not what was resolved: corrupt, nothing kept.
    val corrupt = run(request("$origin/media/file", etag = "\"other\""), "corrupt")
    check(corrupt is TransferOutcome.Failed && corrupt.code == "corrupt") { "$corrupt" }
    check(!File(dir("corrupt"), "media.mkv.part").exists())
    val size = run(request("$origin/media/file", byteLength = 999), "size")
    check(size is TransferOutcome.Failed && size.code == "corrupt")

    // Refusals, limits and transient failures.
    fun failure(path: String) = run(request("$origin$path"), "fail")
    check((failure("/media/refused") as TransferOutcome.Failed).code == "forbidden")
    check((failure("/media/unauthorized") as TransferOutcome.Failed).code == "forbidden")
    check((failure("/media/limited") as TransferOutcome.Failed).code == "rate_limited")
    check((failure("/media/missing") as TransferOutcome.Failed).let { it.code == "network" && !it.message.contains("127.0.0.1") })
    check(failure("/media/unavailable") is TransferOutcome.Retry)
    check(failure("/media/loop") is TransferOutcome.Retry)
    check(run(request("http://127.0.0.1:1/media/file"), "fail") is TransferOutcome.Retry)

    // Redirects: within the exact origin with credentials, never to another origin.
    seen.clear()
    check(run(request("$origin/media/redirect"), "redirect") is TransferOutcome.Completed)
    check(seen.map { it.path } == listOf("/media/redirect", "/media/file") && seen.all { it.authorization == "secret-token" })
    otherSeen.clear()
    val away = run(request("$origin/media/away"), "away")
    check(away is TransferOutcome.Failed && away.code == "network" && !away.message.contains("127.0.0.1")) { "$away" }
    check(otherSeen.isEmpty())
    check(!File(dir("away"), "media.mkv").exists())

    // A cancelled transfer stops and keeps what it wrote.
    lateinit var transfer: OfflineTransfer
    transfer = OfflineTransfer(request("$origin/media/file"), dir("cancel")) { _, _ -> transfer.cancel() }
    check(transfer.run() is TransferOutcome.Cancelled)
    check(!File(dir("cancel"), "media.mkv").exists())
  } finally {
    server.stop(0)
    other.stop(0)
    scratch.deleteRecursively()
  }
  println("Android offline transfer passed")
}

private fun rules() {
  check((0..7).map(DownloadRules::backoffMs) == listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L, 60_000L))
  check(DownloadRules.httpFailure(401).first == "forbidden" && DownloadRules.httpFailure(403).first == "forbidden")
  check(DownloadRules.httpFailure(429).first == "rate_limited" && DownloadRules.httpFailure(404).first == "network")
  check(DownloadRules.transient(503) && DownloadRules.transient(408) && !DownloadRules.transient(404))
  check(DownloadRules.noSpace(IOException("write failed: ENOSPC (No space left on device)")))
  check(DownloadRules.noSpace(IOException("outer", IOException("No space left on device"))))
  check(!DownloadRules.noSpace(IOException("Connection reset")))
  check(DownloadRules.contentRange("bytes 400-999/1000") == 400L to 1000L)
  check(DownloadRules.contentRange("bytes 0-1/*") == 0L to null)
  check(DownloadRules.contentRange("bytes=1-2/3") == null)
  check(DownloadRules.sameTag("W/\"a\"", "\"a\"") && !DownloadRules.sameTag("\"a\"", "\"b\""))
  check(DownloadRules.extension("MKV", "mp4") == "mkv" && DownloadRules.extension("../x", "mp4") == "x" && DownloadRules.extension("", "srt") == "srt")
  listOf("", ".", "..", "a/b", "a\\b", "a\u0000", "c:", "x".repeat(201)).forEach { check(!DownloadRules.safeComponent(it)) { it } }
  listOf("12345", "title-1", "ab:cd", "%2e%2e").forEach { check(DownloadRules.safeComponent(it)) { it } }
  val base = mapOf("serverId" to "s", "viewerId" to "v", "titleId" to "t", "url" to "https://example.com/a", "headers" to emptyMap<String, String>())
  check(DownloadRequest.from(base).let { it.key == "s/v/t" && it.container == "mp4" && it.wifiOnly })
  listOf(base + ("titleId" to ".."), base + ("serverId" to "a/b"), base + ("url" to "file:///etc/passwd"),
    base + ("url" to "https://user:pass@example.com/a"), base + ("headers" to mapOf("X-Plex-Token" to "a\r\nInjected: 1")),
    base + ("headers" to mapOf("Bad Header" to "x"))).forEach { input ->
    check(runCatching { DownloadRequest.from(input) }.isFailure) { "$input" }
  }
  val sidecars = DownloadRequest.from(base + ("sidecars" to listOf(mapOf("trackId" to "../x", "url" to "https://example.com/s"),
    mapOf("trackId" to "en", "url" to "javascript:alert(1)"), mapOf("trackId" to "fr", "format" to "VTT", "url" to "https://example.com/fr")))).sidecars
  check(sidecars.map { it.trackId to it.format } == listOf("fr" to "vtt"))
  check(DownloadRequest.from(base + ("posterUrl" to "file:///etc/passwd")).posterUrl == null)
}
