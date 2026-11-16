// A server's media access (VelaPlayer.setMediaAccess): request headers scoped to one origin and path
// prefix, as modules/vela-player/web/engine/media-auth.ts applies them. Held in native memory only; never logged or
// reported.
package app.ether.vela.player

import android.net.Uri

internal class MediaAccess private constructor(
  val origin: String,
  private val pathPrefix: String,
  private val fields: Map<String, String>,
) {
  /** The headers for `uri`, only when it is inside the authorized origin and path. */
  fun headers(uri: Uri): Map<String, String> {
    return if (contains(uri)) fields else emptyMap()
  }

  /** Whether `uri` is inside the origin and path prefix. */
  fun contains(uri: Uri): Boolean {
    if (originOf(uri) != origin) {
      return false
    }
    val path = uri.path ?: return false
    val directory = if (pathPrefix.endsWith("/")) pathPrefix else "$pathPrefix/"
    return pathPrefix == "/" || path == pathPrefix || path.startsWith(directory)
  }

  companion object {
    private val allowedHeader = Regex(
      "^(accept|authorization|x-plex-token|x-emby-token|x-emby-authorization|x-plex-product" +
        "|x-plex-version|x-plex-client-identifier|x-plex-platform|x-plex-device-name)$",
      RegexOption.IGNORE_CASE,
    )

    /** Validates what JavaScript handed over: an origin, a path prefix and at most 8 allowed headers. */
    fun from(value: Map<String, Any?>): MediaAccess {
      val origin = value["origin"] as? String
      val prefix = value["pathPrefix"] as? String
      val headers = value["headers"] as? Map<*, *>
      if (origin == null || prefix == null || !prefix.startsWith("/") || headers == null || headers.size > 8) {
        throw MpvError("Invalid media access")
      }
      val fields = headers.entries.associate { (name, text) ->
        if (name !is String || text !is String || !allowedHeader.matches(name)) {
          throw MpvError("Invalid media access")
        }
        name to text
      }
      if (originOf(Uri.parse(origin)) != origin) {
        throw MpvError("Invalid media access")
      }
      return MediaAccess(origin, prefix, fields)
    }

    /** scheme://host[:port], as the web's URL.origin writes it. */
    fun originOf(uri: Uri): String? {
      val scheme = uri.scheme ?: return null
      val host = uri.host ?: return null
      val port = if (uri.port == -1) "" else ":${uri.port}"
      return "$scheme://$host$port"
    }
  }
}

/** The one media access the trusted playback controller set, for every player view. Its origin also
 * resolves a plan's relative URLs (Ether's broker paths need no headers: `headers` may be empty). */
internal object MediaAccessStore {
  @Volatile var current: MediaAccess? = null

  /** An absolute URL, or one relative to the media access origin. */
  fun resolve(text: String): Uri? {
    val uri = Uri.parse(text)
    if (uri.scheme != null) {
      return uri
    }
    val origin = current?.origin ?: return null
    return Uri.parse(origin + if (text.startsWith("/")) text else "/$text")
  }

  /** mpv's http-header-fields for `uri`: the headers only inside the origin and path (none for Ether's
   * broker URLs, which carry their own grant). */
  fun headerFields(uri: Uri): List<String> {
    val headers = current?.headers(uri) ?: emptyMap()
    return headers.map { (name, value) -> "$name: $value" }
  }
}
