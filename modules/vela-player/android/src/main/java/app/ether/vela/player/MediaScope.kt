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
      authority(uri).let { it != null && it == authority(origin) } &&
      (prefix == "/" || path == prefix || path.startsWith(prefix.trimEnd('/') + "/"))
  } catch (_: Exception) { false }

  private fun canonicalPath(path: String): String = URI(null, null, path.replace('\\', '/'), null).normalize().path
  private fun port(uri: URI) = if (uri.port != -1) uri.port else if (uri.scheme.equals("https", true)) 443 else 80

  /** host:port as the connection uses them, or null. java.net.URI has no host for a name with '_'
   * (a registry authority); then the raw authority is read strictly: a name, and an optional port of
   * digits in 1..65535. Null never matches, so two such hosts are never taken for one another. */
  private fun authority(uri: URI): String? {
    uri.host?.let { return "${it.lowercase()}:${port(uri)}" }
    val raw = uri.rawAuthority ?: return null
    val parts = raw.split(':')
    val name = parts[0]
    if (parts.size > 2 || name.isEmpty() || !name.all { it.isLetterOrDigit() && it.code < 128 || it == '-' || it == '.' || it == '_' }) return null
    if (parts.size == 1) return "${name.lowercase()}:${port(uri)}"
    val digits = parts[1]
    if (digits.isEmpty() || digits.length > 5 || !digits.all { it in '0'..'9' }) return null
    val port = digits.toInt()
    return if (port in 1..65535) "${name.lowercase()}:$port" else null
  }
}
