// A trailer preview (the `preview` prop: the server's PreviewGrant plus loop): a plain, short, muted
// source that plays from the start until its grant expires.
package app.ether.vela.player

import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

internal class PreviewSource(val url: String, val expiresAt: Long, val loop: Boolean) {
  /** Milliseconds until the grant expires (zero or less: expired). */
  fun remaining(now: Long = System.currentTimeMillis()): Long = expiresAt - now

  companion object {
    /** A preview, or null when the URL or a valid expiry is missing. */
    fun from(value: Map<String, Any?>): PreviewSource? {
      val url = value.text("url")?.takeIf { it.isNotEmpty() } ?: return null
      val expiresAt = value.text("expiresAt")?.let(::parseTime) ?: return null
      return PreviewSource(url, expiresAt, value["loop"] == true)
    }

    /** An RFC 3339 time in UTC or with an offset, with or without fractional seconds. */
    private fun parseTime(text: String): Long? {
      val normalized = text.replace(Regex("\\.\\d+"), "").replace(Regex("Z$"), "+00:00")
      val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
      format.timeZone = TimeZone.getTimeZone("UTC")
      return try {
        format.parse(normalized)?.time
      } catch (error: ParseException) {
        null
      }
    }
  }
}
