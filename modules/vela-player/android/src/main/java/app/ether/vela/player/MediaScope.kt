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

/** The one local allowance (docs/downloads.md, "Local file routes"): a `file:` URL whose canonical path
 * (symlinks resolved) is a regular file inside the canonical downloads root. It never carries credentials,
 * and every http(s) rule above is untouched. Encoded separators and NULs are refused before decoding;
 * `..`, `.`, empty segments, backslashes, control characters and drive letters after it. */
internal class LocalMediaScope(root: java.io.File) {
  private val root: java.io.File = root.canonicalFile

  fun file(url: String): java.io.File? = try {
    val uri = URI(url)
    val raw = uri.rawPath
    if (!uri.scheme.equals("file", true) || uri.isOpaque || uri.rawAuthority != null || uri.rawUserInfo != null ||
      uri.rawQuery != null || uri.rawFragment != null || raw == null || encodedSeparator.containsMatchIn(raw)) null
    else {
      val path = uri.path
      val segments = path.split('/')
      if (segments.first().isNotEmpty() || segments.drop(1).any(::refused)) null
      else java.io.File(path).canonicalFile.takeIf { it.path.startsWith(root.path + java.io.File.separator) && it.isFile }
    }
  } catch (_: Exception) { null }

  private fun refused(segment: String) = segment.isEmpty() || segment == "." || segment == ".." || segment.contains('\\') ||
    segment.any { it.code < 32 || it.code == 127 } || Regex("^[A-Za-z]:$").matches(segment)

  private companion object {
    val encodedSeparator = Regex("%(?:2f|5c|00)", RegexOption.IGNORE_CASE)
  }
}

/** The downloads root's local scope, set when the downloads engine starts (OfflineDownloads). */
internal object LocalMedia {
  @Volatile var scope: LocalMediaScope? = null
}
