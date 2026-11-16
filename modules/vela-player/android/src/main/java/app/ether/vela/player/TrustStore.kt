// The device's trusted certificate authorities as one PEM file, for FFmpeg's TLS (mbedTLS reads a CA
// file, not Android's store). Written once per process from AndroidCAStore, so certificates the
// user disabled stay untrusted and ones they installed are trusted, as for the rest of the app.
package app.ether.vela.player

import android.content.Context
import android.util.Base64
import java.io.File
import java.security.KeyStore
import java.security.cert.X509Certificate

internal object TrustStore {
  @Volatile private var bundle: File? = null

  /** The PEM bundle's path. */
  @Synchronized
  fun file(context: Context): File {
    bundle?.let { return it }
    val store = KeyStore.getInstance("AndroidCAStore")
    store.load(null)
    val pem = StringBuilder()
    for (alias in store.aliases()) {
      val certificate = store.getCertificate(alias) as? X509Certificate ?: continue
      pem.append("-----BEGIN CERTIFICATE-----\n")
      pem.append(Base64.encodeToString(certificate.encoded, Base64.DEFAULT))
      pem.append("-----END CERTIFICATE-----\n")
    }
    val target = File(context.noBackupFilesDir, "vela-player-ca.pem")
    val partial = File(target.path + ".partial")
    partial.writeText(pem.toString())
    partial.renameTo(target)
    bundle = target
    return target
  }
}
