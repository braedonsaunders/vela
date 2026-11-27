package app.ether.vela.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.ProtocolException
import java.net.URL
import java.util.concurrent.atomic.AtomicLong

/** Each player captures one immutable grant. Manifests, segments, seeks and subtitles all use it.
 * `received` counts the media bytes read, as they arrive (the snapshot's loadProgress).
 * A `file:` URL opens only inside the downloads root (LocalMediaScope), never with the grant's headers. */
internal class ScopedMediaDataSource(private val grant: MediaAccess?, private val received: AtomicLong? = null,
  private val isOriginal: (Uri) -> Boolean = { false }) : BaseDataSource(true) {
  private var connection: HttpURLConnection? = null
  private var local: RandomAccessFile? = null
  private var localUri: Uri? = null
  private var input: InputStream? = null
  private var remaining = C.LENGTH_UNSET.toLong()
  private var opened = false
  private var original = false

  override fun open(dataSpec: DataSpec): Long {
    transferInitializing(dataSpec)
    original = isOriginal(dataSpec.uri)
    if (dataSpec.uri.scheme.equals("file", true)) return openLocal(dataSpec)
    var url = URL(dataSpec.uri.toString())
    var authorized = grant?.contains(dataSpec.uri) == true
    try {
      for (hop in 0..8) {
        if (url.protocol !in listOf("http", "https") || url.userInfo != null) throw IOException("Invalid media scheme")
        val conn = (url.openConnection() as HttpURLConnection).also { connection = it }
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 15_000
        conn.readTimeout = 15_000
        conn.setRequestProperty("Accept-Encoding", "identity")
        // DataSpec headers are deliberately ignored: credentials enter only through the grant.
        if (authorized) grant?.headers(Uri.parse(url.toString()))?.forEach { (key, value) -> conn.setRequestProperty(key, value) }
        if (dataSpec.position != 0L || dataSpec.length != C.LENGTH_UNSET.toLong()) {
          val end = if (dataSpec.length == C.LENGTH_UNSET.toLong()) "" else (dataSpec.position + dataSpec.length - 1).toString()
          conn.setRequestProperty("Range", "bytes=${dataSpec.position}-$end")
        }
        val status = conn.responseCode
        if (status in listOf(301, 302, 303, 307, 308)) {
          val location = conn.getHeaderField("Location") ?: throw IOException("Media redirect missing location")
          val next = URL(url, location)
          authorized = authorized && grant?.contains(Uri.parse(next.toString())) == true
          conn.disconnect()
          connection = null
          url = next
          continue
        }
        if (status !in 200..299) throw MediaHttpFailure(status,
          originalLostResponse(status, conn.getHeaderField("X-Ether-Playback-Error")))
        if (status == 206) {
          val range = conn.getHeaderField("Content-Range")?.let { Regex("bytes (\\d+)-(\\d+)/(?:\\d+|\\*)").matchEntire(it) }
          if (range == null || range.groupValues[1].toLongOrNull() != dataSpec.position) throw IOException("Invalid media range response")
        }
        input = conn.inputStream
        if (status == 200 && dataSpec.position > 0) {
          var skip = dataSpec.position
          val buffer = ByteArray(8192)
          while (skip > 0) {
            val count = input!!.read(buffer, 0, minOf(skip, buffer.size.toLong()).toInt())
            if (count < 0) throw EOFException("Media range exceeds source")
            skip -= count
          }
        }
        val length = conn.getHeaderField("Content-Length")?.toLongOrNull() ?: C.LENGTH_UNSET.toLong()
        remaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length
          else if (length >= 0) (length - if (status == 200) dataSpec.position else 0).coerceAtLeast(0) else length
        opened = true
        transferStarted(dataSpec)
        return remaining
      }
      throw IOException("Too many media redirects")
    } catch (error: Exception) {
      close()
      // Never propagate URLConnection messages: they may contain a signed URL.
      throw if (error is MediaHttpFailure) error else IOException("Media request failed")
    }
  }

  /** A downloaded file: the local scope resolves it, and no request header or grant is involved. */
  private fun openLocal(dataSpec: DataSpec): Long {
    val target = LocalMedia.scope?.file(dataSpec.uri.toString()) ?: throw IOException("Media request failed")
    try {
      val file = RandomAccessFile(target, "r").also { local = it }
      val size = file.length()
      if (dataSpec.position > size) throw EOFException("Media range exceeds source")
      file.seek(dataSpec.position)
      val available = size - dataSpec.position
      remaining = if (dataSpec.length == C.LENGTH_UNSET.toLong()) available else minOf(dataSpec.length, available)
      localUri = dataSpec.uri
      opened = true
      transferStarted(dataSpec)
      return remaining
    } catch (_: Exception) {
      close()
      throw IOException("Media request failed")
    }
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    if (length == 0) return 0
    if (remaining == 0L) return C.RESULT_END_OF_INPUT
    local?.let { file ->
      val count = try { file.read(buffer, offset, minOf(length.toLong(), remaining).toInt()) }
        catch (_: IOException) { throw IOException("Media read failed") }
      if (count < 0) throw EOFException("Incomplete media file")
      remaining -= count
      received?.addAndGet(count.toLong())
      bytesTransferred(count)
      return count
    }
    val count = try {
      input!!.read(buffer, offset, if (remaining < 0) length else minOf(length.toLong(), remaining).toInt())
    } catch (error: IOException) {
      // Some HTTP stacks throw on short fixed-length bodies instead of returning EOF.
      val prematureEof = error is EOFException || error.message == "Premature EOF" ||
        (error is ProtocolException && error.message == "unexpected end of stream")
      if (original && remaining > 0 && prematureEof) throw OriginalLostFailure()
      throw IOException("Media read failed")
    }
    if (count < 0) {
      if (remaining > 0 && original) throw OriginalLostFailure()
      if (remaining > 0) throw EOFException("Incomplete media response")
      return C.RESULT_END_OF_INPUT
    }
    if (remaining >= 0) remaining -= count
    received?.addAndGet(count.toLong())
    bytesTransferred(count)
    return count
  }

  override fun getUri(): Uri? = localUri ?: connection?.url?.toString()?.let(Uri::parse)
  override fun getResponseHeaders(): Map<String, List<String>> = connection?.headerFields?.filterKeys { it != null }.orEmpty()
  override fun close() {
    try { input?.close() } catch (_: IOException) { }
    input = null
    try { local?.close() } catch (_: IOException) { }
    local = null
    localUri = null
    connection?.disconnect()
    connection = null
    if (opened) { opened = false; transferEnded() }
  }

  class Factory(private val grant: MediaAccess?, private val received: AtomicLong? = null,
    private val isOriginal: (Uri) -> Boolean = { false }) : DataSource.Factory {
    override fun createDataSource(): DataSource = ScopedMediaDataSource(grant, received, isOriginal)
  }
}

internal class MediaHttpFailure(val status: Int, val originalLost: Boolean = false) : IOException("Media request refused ($status)")
internal class OriginalLostFailure : EOFException("Incomplete original media response")
