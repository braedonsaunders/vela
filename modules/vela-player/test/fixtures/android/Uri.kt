// Minimal platform boundary for running the production HTTP source on a stock JVM.
package android.net
import java.net.URI
class Uri private constructor(private val text: String) {
  private val uri get() = URI(text)
  val scheme get() = uri.scheme
  val host get() = uri.host
  val port get() = uri.port
  val path get() = uri.path
  override fun toString() = text
  companion object { fun parse(text: String) = Uri(text) }
}
