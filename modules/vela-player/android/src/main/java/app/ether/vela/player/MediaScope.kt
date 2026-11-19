package app.ether.vela.player

import java.net.URI

/** JVM-only grant boundary. Decode then normalize so encoded traversal cannot widen a grant. */
internal class MediaScope(origin: String, prefix: String) {
  private val origin = URI(origin)
  private val prefix = try {
    val uri = URI(prefix.replace(" ", "%20"))
    require(uri.rawAuthority == null && uri.rawQuery == null && uri.rawFragment == null)
    canonicalPath(uri.path ?: "/")
  } catch (_: Exception) { throw IllegalArgumentException("Invalid media scope") }
  fun contains(url: String): Boolean = try {
    val uri = URI(url)
    val decoded = uri.path ?: "/"
    val path = canonicalPath(decoded)
    // A second server-side decode must not turn a literal percent sequence into traversal.
    !Regex("%(?:25)*(?:2e|2f|5c)", RegexOption.IGNORE_CASE).containsMatchIn(decoded) &&
      decoded.none { it.code < 32 || it.code == 127 } && uri.rawUserInfo == null && uri.scheme.equals(origin.scheme, true) &&
      uri.host.equals(origin.host, true) && port(uri) == port(origin) &&
      (prefix == "/" || path == prefix || path.startsWith(prefix.trimEnd('/') + "/"))
  } catch (_: Exception) { false }

  private fun canonicalPath(path: String): String = URI(null, null, path.replace('\\', '/'), null).normalize().path
  private fun port(uri: URI) = if (uri.port != -1) uri.port else if (uri.scheme.equals("https", true)) 443 else 80
}
