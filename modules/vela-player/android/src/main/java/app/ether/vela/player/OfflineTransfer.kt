// One offline download's bytes (docs/downloads.md, "Android"): the original streamed into
// `<title>/media.<ext>.part`, resumed with Range + If-Range, renamed to `media.<ext>` when whole, then its poster
// and text sidecars. Plain java.net/java.io so the JVM probe runs it against a local server.
//
// Credentials (the request's headers) live in memory only and go only to the request URL's exact origin.
// Redirects are followed by hand within that origin; any other origin fails the transfer without a request.
// Nothing here writes a URL or a header to disk, a log, an error or an event.
package app.ether.vela.player

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal class DownloadSidecarRequest(val trackId: String, val format: String, val url: String)

/** startTransfer/resumeTransfer's request (NativeDownloadTransferRequest), validated. */
internal class DownloadRequest(
  val serverId: String,
  val viewerId: String,
  val titleId: String,
  val url: String,
  val headers: Map<String, String>,
  val container: String,
  val mimeType: String,
  val byteLength: Long?,
  val etag: String?,
  val wifiOnly: Boolean,
  val posterUrl: String?,
  val sidecars: List<DownloadSidecarRequest>,
) {
  val key get() = "$serverId/$viewerId/$titleId"

  /** Whether `other` asks for the same file in the same place (fresh headers do not make a new file). */
  fun sameFile(other: DownloadRequest) = key == other.key && container == other.container &&
    byteLength == other.byteLength && DownloadRules.sameTag(etag, other.etag)

  companion object {
    fun from(value: Map<String, Any?>): DownloadRequest {
      fun text(name: String) = value[name] as? String
      val serverId = text("serverId")
      val viewerId = text("viewerId")
      val titleId = text("titleId")
      val url = text("url")
      if (serverId == null || viewerId == null || titleId == null || url == null ||
        !listOf(serverId, viewerId, titleId).all(DownloadRules::safeComponent) || !DownloadRules.webUrl(url)) {
        throw IllegalArgumentException("Invalid download transfer request")
      }
      val rawHeaders = value["headers"] as? Map<*, *> ?: emptyMap<String, String>()
      if (rawHeaders.size > 24) throw IllegalArgumentException("Invalid download transfer request")
      val headers = rawHeaders.entries.associate { (name, text) ->
        if (name !is String || text !is String || !DownloadRules.headerName(name) || text.any { it == '\r' || it == '\n' || it == '\u0000' }) {
          throw IllegalArgumentException("Invalid download transfer request")
        }
        name to text
      }
      val sidecars = (value["sidecars"] as? List<*>).orEmpty().mapNotNull { item ->
        val map = item as? Map<*, *> ?: return@mapNotNull null
        val trackId = map["trackId"] as? String ?: return@mapNotNull null
        val sidecarUrl = map["url"] as? String ?: return@mapNotNull null
        if (!DownloadRules.safeComponent(trackId) || !DownloadRules.webUrl(sidecarUrl)) return@mapNotNull null
        DownloadSidecarRequest(trackId, DownloadRules.extension(map["format"] as? String, "srt"), sidecarUrl)
      }
      return DownloadRequest(
        serverId = serverId, viewerId = viewerId, titleId = titleId, url = url, headers = headers,
        container = DownloadRules.extension(text("container"), "mp4"),
        mimeType = text("mimeType") ?: "video/mp4",
        byteLength = (value["byteLength"] as? Number)?.toLong()?.takeIf { it > 0 },
        etag = text("etag")?.takeIf { it.isNotBlank() },
        wifiOnly = value["wifiOnly"] as? Boolean ?: true,
        posterUrl = text("posterUrl")?.takeIf(DownloadRules::webUrl),
        sidecars = sidecars,
      )
    }
  }
}

/** How a transfer attempt ended. */
internal sealed class TransferOutcome {
  class Completed(val bytes: Long, val etag: String?, val lastModified: String?, val mediaPath: String,
    val posterPath: String?, val sidecarPaths: Map<String, String>) : TransferOutcome()
  class Failed(val code: String, val message: String, val bytesWritten: Long, val neededBytes: Long? = null) : TransferOutcome()
  /** A transient failure (connection, timeout, 5xx, a short body): try again after a backoff. */
  class Retry(val bytesWritten: Long, val progressed: Boolean) : TransferOutcome()
  /** Paused, removed or stopped for the network: the caller decides what it reports. */
  class Cancelled(val bytesWritten: Long) : TransferOutcome()
}

/** Pure rules shared by the transfer and the engine. */
internal object DownloadRules {
  /** One path component: never empty, `.`, `..`, a separator, a NUL, a control character or a drive letter. */
  fun safeComponent(value: String) = value.isNotEmpty() && value != "." && value != ".." && value.length <= 200 &&
    !value.contains('/') && !value.contains('\\') && value.none { it.code < 32 || it.code == 127 } &&
    !Regex("^[A-Za-z]:$").matches(value)

  /** A file extension: lower-case ASCII letters and digits, at most 12. */
  fun extension(value: String?, fallback: String): String {
    val cleaned = value.orEmpty().lowercase().filter { it in 'a'..'z' || it in '0'..'9' }.take(12)
    return cleaned.ifEmpty { fallback }
  }

  fun webUrl(value: String) = try {
    val url = URL(value)
    url.protocol in listOf("http", "https") && url.userInfo == null && !url.host.isNullOrEmpty()
  } catch (_: Exception) { false }

  fun headerName(name: String) = name.isNotEmpty() && name.length <= 64 &&
    name.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '-' || it == '_' }

  /** scheme://host:port with the scheme's default port written out, so two spellings of one origin agree. */
  fun origin(url: URL): String {
    val port = if (url.port != -1) url.port else url.defaultPort
    return "${url.protocol.lowercase()}://${url.host.lowercase()}:$port"
  }

  /** 2 s, 4 s, 8 s … up to 60 s between attempts after transient failures. */
  fun backoffMs(attempt: Int): Long = minOf(60_000L, 2_000L shl minOf(attempt, 5))

  /** An entity tag without its weak marker or quotes, for comparison only. */
  fun bareTag(tag: String?): String? = tag?.trim()?.removePrefix("W/")?.trim('"')?.takeIf { it.isNotEmpty() }
  fun sameTag(a: String?, b: String?) = bareTag(a) == bareTag(b)

  /** `bytes <start>-<end>/<total>`: start and total (null when `*`). */
  fun contentRange(header: String?): Pair<Long, Long?>? {
    val match = Regex("^bytes (\\d+)-(\\d+)/(\\d+|\\*)$").matchEntire(header?.trim() ?: return null) ?: return null
    return match.groupValues[1].toLong() to match.groupValues[3].toLongOrNull()
  }

  /** A refused or failed answer's code and message (iOS's classifyHTTPError). */
  fun httpFailure(status: Int): Pair<String, String> = when (status) {
    401, 403 -> "forbidden" to "Downloads are not allowed for this title or account"
    429 -> "rate_limited" to "Download limit reached; please try again later"
    else -> "network" to "Server answered with HTTP $status"
  }

  /** A status worth trying again: the server or a proxy is briefly unavailable. */
  fun transient(status: Int) = status == 408 || status in 500..599

  fun noSpace(error: Throwable?): Boolean {
    var cause = error
    while (cause != null) {
      val text = cause.message.orEmpty()
      if (text.contains("ENOSPC") || text.contains("No space left", ignoreCase = true)) return true
      cause = cause.cause.takeIf { it !== cause }
    }
    return false
  }
}

/** Runs one attempt of one transfer. `cancel()` from another thread stops it at the next read. */
internal class OfflineTransfer(
  private val request: DownloadRequest,
  private val titleDirectory: File,
  private val progress: (bytesWritten: Long, byteLength: Long?) -> Unit,
) {
  @Volatile private var cancelled = false
  @Volatile private var connection: HttpURLConnection? = null
  private val relative = "${request.serverId}/${request.viewerId}/${request.titleId}"
  private val part = File(titleDirectory, "media.${request.container}.part")
  /** The pinned identity of the partial file (validator and total size), never a URL or a header. */
  private val pin = File(titleDirectory, "media.${request.container}.part.json")

  fun cancel() {
    cancelled = true
    try { connection?.disconnect() } catch (_: Exception) { }
  }

  fun partBytes(): Long = part.length()

  private class Pin(val etag: String?, val lastModified: String?, val total: Long?) {
    fun encode(): ByteArray {
      val properties = java.util.Properties()
      etag?.let { properties.setProperty("etag", it) }
      lastModified?.let { properties.setProperty("lastModified", it) }
      total?.let { properties.setProperty("total", it.toString()) }
      return java.io.ByteArrayOutputStream().also { properties.store(it, null) }.toByteArray()
    }
  }

  private fun readPin(): Pin? = try {
    val properties = java.util.Properties().apply { pin.inputStream().use { load(it) } }
    Pin(properties.getProperty("etag"), properties.getProperty("lastModified"),
      properties.getProperty("total")?.toLongOrNull()?.takeIf { it > 0 })
  } catch (_: Exception) { null }

  private fun writePin(value: Pin) = AtomicFiles.write(pin, value.encode())

  private fun reset() {
    part.delete()
    pin.delete()
  }

  fun run(): TransferOutcome {
    try {
      if (!titleDirectory.isDirectory && !titleDirectory.mkdirs()) throw IOException("No title directory")
    } catch (error: Exception) {
      return TransferOutcome.Failed(if (DownloadRules.noSpace(error)) "no_space" else "unknown", "Could not save the downloaded file to disk", 0)
    }
    var pinned = readPin()
    var existing = if (part.isFile) part.length() else 0L
    // Restart from zero when the partial file cannot be tied to what is asked for now.
    if (existing > 0 && (pinned == null ||
        (request.etag != null && pinned.etag != null && !DownloadRules.sameTag(request.etag, pinned.etag)) ||
        (request.byteLength != null && pinned.total != null && request.byteLength != pinned.total) ||
        (pinned.total != null && existing > pinned.total))) {
      reset()
      pinned = null
      existing = 0
    }
    if (existing == 0L) reset()
    val start = existing
    val response = try {
      open(request.url, start, pinned)
    } catch (error: RedirectRefused) {
      return TransferOutcome.Failed("network", "The server sent the download to another address", start)
    } catch (error: Exception) {
      return if (cancelled) TransferOutcome.Cancelled(start) else TransferOutcome.Retry(start, false)
    }
    try {
      val status = response.responseCode
      val responseTag = response.getHeaderField("ETag")
      val lastModified = response.getHeaderField("Last-Modified")
      val offset: Long
      val total: Long?
      when {
        status == 206 && start > 0 -> {
          val range = DownloadRules.contentRange(response.getHeaderField("Content-Range"))
          val changed = range == null || range.first != start ||
            (responseTag != null && pinned?.etag != null && !DownloadRules.sameTag(responseTag, pinned.etag)) ||
            (range.second != null && pinned?.total != null && range.second != pinned.total)
          if (changed) {
            // A different file or a range we did not ask for: start over on the next attempt.
            reset()
            return TransferOutcome.Retry(0, false)
          }
          offset = start
          total = range!!.second ?: pinned?.total
        }
        status == 200 -> {
          // A full answer (the file changed, or the server ignores ranges): restart from zero.
          offset = 0
          total = response.getHeaderField("Content-Length")?.toLongOrNull()?.takeIf { it >= 0 }
          reset()
          if (cancelled) return TransferOutcome.Cancelled(0)
          writePin(Pin(responseTag, lastModified, total))
        }
        status == 416 && start > 0 -> {
          if (pinned?.total == start) return finish(start, pinned.etag, pinned.lastModified)
          reset()
          return TransferOutcome.Retry(0, false)
        }
        DownloadRules.transient(status) -> return TransferOutcome.Retry(start, false)
        else -> {
          val (code, message) = DownloadRules.httpFailure(status)
          return TransferOutcome.Failed(code, message, start)
        }
      }
      if (request.etag != null && responseTag != null && !DownloadRules.sameTag(request.etag, responseTag)) {
        reset()
        return TransferOutcome.Failed("corrupt", "The original file changed. Retry to get a fresh download.", 0)
      }
      if (request.byteLength != null && total != null && total != request.byteLength) {
        reset()
        return TransferOutcome.Failed("corrupt", "The server returned a different file. Retry the download.", 0)
      }
      val expected = total ?: request.byteLength
      var written = offset
      try {
        FileOutputStream(part, offset > 0).use { output ->
          val input: InputStream = response.inputStream
          val buffer = ByteArray(256 * 1024)
          var lastReport = 0L
          progress(written, expected)
          while (true) {
            if (cancelled) return TransferOutcome.Cancelled(written)
            val count = try { input.read(buffer) } catch (error: IOException) {
              return if (cancelled) TransferOutcome.Cancelled(written) else TransferOutcome.Retry(written, written > offset)
            }
            if (count < 0) break
            try { output.write(buffer, 0, count) } catch (error: IOException) {
              if (DownloadRules.noSpace(error)) {
                return TransferOutcome.Failed("no_space", "Not enough free storage space to finish downloading", written,
                  expected?.let { it - written }?.takeIf { it > 0 })
              }
              return TransferOutcome.Failed("unknown", "Could not save the downloaded file to disk", written)
            }
            written += count
            if (expected != null && written > expected) {
              reset()
              return TransferOutcome.Failed("corrupt", "The downloaded file was larger than expected. Retry the download.", 0)
            }
            val now = System.nanoTime()
            if (now - lastReport > 500_000_000L) {
              lastReport = now
              progress(written, expected)
            }
          }
          try { output.fd.sync() } catch (_: IOException) { }
        }
      } catch (error: IOException) {
        if (DownloadRules.noSpace(error)) {
          return TransferOutcome.Failed("no_space", "Not enough free storage space to finish downloading", written,
            expected?.let { it - written }?.takeIf { it > 0 })
        }
        return if (cancelled) TransferOutcome.Cancelled(written) else TransferOutcome.Retry(written, written > offset)
      }
      if (cancelled) return TransferOutcome.Cancelled(written)
      if (expected != null && written < expected) return TransferOutcome.Retry(written, written > offset)
      return finish(written, responseTag ?: pinned?.etag, lastModified ?: pinned?.lastModified)
    } finally {
      response.disconnect()
      connection = null
    }
  }

  /** The whole original is in the partial file: rename it into place, then fetch the poster and sidecars. */
  private fun finish(bytes: Long, etag: String?, lastModified: String?): TransferOutcome {
    if (bytes <= 0) return TransferOutcome.Failed("corrupt", "The downloaded file was empty", 0)
    val media = File(titleDirectory, "media.${request.container}")
    try {
      Files.move(part.toPath(), media.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } catch (error: Exception) {
      return TransferOutcome.Failed(if (DownloadRules.noSpace(error)) "no_space" else "unknown", "Could not finalize the downloaded file", bytes)
    }
    pin.delete()
    val posterPath = request.posterUrl?.let { fetchPoster(it) }
    val sidecarPaths = linkedMapOf<String, String>()
    for (sidecar in request.sidecars) {
      if (cancelled) break
      val data = auxiliary(sidecar.url, 20L * 1024 * 1024)?.first ?: continue
      val name = "${sidecar.trackId}.${sidecar.format}"
      val target = File(File(titleDirectory, "sidecars"), name)
      try {
        AtomicFiles.write(target, data)
        sidecarPaths[sidecar.trackId] = "$relative/sidecars/$name"
      } catch (_: Exception) { }
    }
    return TransferOutcome.Completed(bytes, etag ?: request.etag, lastModified, "$relative/${media.name}", posterPath, sidecarPaths)
  }

  private fun fetchPoster(url: String): String? {
    val (data, type) = auxiliary(url, 20L * 1024 * 1024) ?: return null
    val mime = type.orEmpty().lowercase()
    val ext = when {
      "svg" in mime -> "svg"
      "png" in mime -> "png"
      "webp" in mime -> "webp"
      "avif" in mime -> "avif"
      else -> "jpg"
    }
    // One poster per title: an earlier poster of another type is replaced.
    titleDirectory.listFiles { file -> file.name.startsWith("poster.") }?.forEach { if (it.name != "poster.$ext") it.delete() }
    return try {
      AtomicFiles.write(File(titleDirectory, "poster.$ext"), data)
      "$relative/poster.$ext"
    } catch (_: Exception) { null }
  }

  /** A poster or sidecar: the request's headers only at the original's exact origin, the same redirect rule,
   * a size limit, and nothing on any failure. */
  private fun auxiliary(url: String, limit: Long): Pair<ByteArray, String?>? = try {
    val response = open(url, 0, null, timeoutMs = 20_000)
    try {
      if (response.responseCode !in 200..299) null
      else {
        val bytes = response.inputStream.use { input ->
          val out = java.io.ByteArrayOutputStream()
          val buffer = ByteArray(64 * 1024)
          while (true) {
            if (cancelled) throw IOException("Cancelled")
            val count = input.read(buffer)
            if (count < 0) break
            out.write(buffer, 0, count)
            if (out.size() > limit) throw IOException("Too large")
          }
          out.toByteArray()
        }
        if (bytes.isEmpty()) null else bytes to response.contentType
      }
    } finally { response.disconnect() }
  } catch (_: Exception) { null }

  private class RedirectRefused : IOException("Redirect refused")

  /** GET `url`, following redirects by hand within its exact origin. Headers attach only when that origin is
   * the original's (so a poster on another host gets none). A redirect elsewhere is refused unanswered. */
  private fun open(url: String, from: Long, pinned: Pin?, timeoutMs: Int = 30_000): HttpURLConnection {
    var target = URL(url)
    val origin = DownloadRules.origin(target)
    val credentials = origin == DownloadRules.origin(URL(request.url))
    for (hop in 0..5) {
      if (target.protocol !in listOf("http", "https") || target.userInfo != null || DownloadRules.origin(target) != origin) {
        throw RedirectRefused()
      }
      if (cancelled) throw IOException("Cancelled")
      val conn = target.openConnection() as HttpURLConnection
      connection = conn
      conn.instanceFollowRedirects = false
      conn.useCaches = false
      conn.connectTimeout = 15_000
      conn.readTimeout = timeoutMs
      conn.setRequestProperty("Accept-Encoding", "identity")
      if (credentials) request.headers.forEach { (name, value) -> conn.setRequestProperty(name, value) }
      if (from > 0) {
        conn.setRequestProperty("Range", "bytes=$from-")
        // If-Range takes a strong validator: an ETag that isn't weak, else the date.
        val validator = pinned?.etag?.takeIf { !it.trim().startsWith("W/") } ?: pinned?.lastModified
        if (validator != null) conn.setRequestProperty("If-Range", validator)
      }
      val status = conn.responseCode
      if (status in listOf(301, 302, 303, 307, 308)) {
        val location = conn.getHeaderField("Location")
        conn.disconnect()
        connection = null
        target = URL(target, location ?: throw IOException("Redirect without a location"))
        continue
      }
      return conn
    }
    throw IOException("Too many redirects")
  }
}

/** Write a temporary file, fsync it, then rename it over the target, so a reader sees the old or new file whole. */
internal object AtomicFiles {
  fun write(target: File, data: ByteArray) {
    target.parentFile?.let { if (!it.isDirectory) it.mkdirs() }
    val temp = File(target.parentFile, ".${target.name}.${Thread.currentThread().id}.tmp")
    try {
      FileOutputStream(temp).use { output ->
        output.write(data)
        output.fd.sync()
      }
      Files.move(temp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
      temp.delete()
    }
  }
}
