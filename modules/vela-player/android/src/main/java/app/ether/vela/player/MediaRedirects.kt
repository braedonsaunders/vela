// Media credentials never follow a redirect out of their scope (packages/player-api MediaAccess), as on
// Apple (ios/MediaRedirects.swift). When a URL carries headers, its redirects are resolved here first, one
// hop at a time: a hop inside the authorized origin and path keeps the headers, a hop outside drops them for
// good. mpv then loads the final URL refusing any redirect while headers are attached (MpvClient), so a
// later redirect (on a seek or a reconnect) fails instead of being followed with the headers.
package app.ether.vela.player

import android.net.Uri
import android.os.Handler
import android.os.Looper
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** The URL mpv loads and mpv's http-header-fields for it: none once a redirect left the scope. */
internal class ResolvedMedia(val url: Uri, val headerFields: List<String>)

internal object MediaRedirects {
  private const val MAXIMUM_HOPS = 8
  private const val TIMEOUT_MS = 10_000

  private val worker = Executors.newSingleThreadExecutor { Thread(it, "vela-media-redirects") }
  private val main = Handler(Looper.getMainLooper())

  /** Resolves `url` off the main thread and answers on it. Without headers there is nothing to protect:
   * mpv follows redirects itself. */
  fun resolve(url: Uri, done: (ResolvedMedia) -> Unit) {
    val fields = MediaAccessStore.headerFields(url)
    if (fields.isEmpty()) {
      done(ResolvedMedia(url, fields))
      return
    }
    worker.execute {
      val media = follow(url, fields)
      main.post { done(media) }
    }
  }

  private fun follow(url: Uri, initial: List<String>): ResolvedMedia {
    var current = url
    var fields = initial
    var hops = 0
    while (hops < MAXIMUM_HOPS) {
      hops += 1
      val next = redirectTarget(current, fields) ?: break
      current = next
      // Out of scope once means out of scope: a later hop back does not regain the credentials.
      if (MediaAccessStore.headerFields(next).isEmpty()) {
        fields = emptyList()
        break
      }
    }
    return ResolvedMedia(current, fields)
  }

  /** The Location of a redirect answer for the first byte, or null when the URL answers itself. */
  private fun redirectTarget(url: Uri, fields: List<String>): Uri? {
    val connection = try {
      URL(url.toString()).openConnection() as? HttpURLConnection ?: return null
    } catch (error: Exception) {
      return null
    }
    try {
      connection.instanceFollowRedirects = false
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      connection.setRequestProperty("Range", "bytes=0-0")
      for (field in fields) {
        val name = field.substringBefore(':')
        connection.setRequestProperty(name, field.substringAfter(':').trim())
      }
      if (connection.responseCode !in 300..399) {
        return null
      }
      val location = connection.getHeaderField("Location") ?: return null
      return Uri.parse(URL(URL(url.toString()), location).toString())
    } catch (error: Exception) {
      return null
    } finally {
      connection.disconnect()
    }
  }
}
