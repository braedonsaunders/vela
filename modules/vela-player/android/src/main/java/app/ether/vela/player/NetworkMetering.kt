// Whether the device's network is metered (mobile data, a metered Wi-Fi or hotspot), for the
// app's streaming quality cap. A TV on Ethernet or unmetered Wi-Fi reports unmetered.
package app.ether.vela.player

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

object NetworkMetering {
  @Volatile private var meteredValue = false
  private var registered = false
  /** Hears every change, once the app listens. */
  @Volatile var changed: ((Boolean) -> Unit)? = null

  @Synchronized
  fun metered(context: Context?): Boolean {
    val connectivity = context?.getSystemService(ConnectivityManager::class.java) ?: return false
    if (!registered) {
      registered = true
      meteredValue = metered(connectivity.getNetworkCapabilities(connectivity.activeNetwork))
      try {
        connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
          override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = update(metered(capabilities))
          override fun onLost(network: Network) = update(false)
        })
      } catch (_: SecurityException) {
        // Without the network-state permission: the path as it stood, never updated.
      }
    }
    return meteredValue
  }

  private fun update(next: Boolean) {
    if (next == meteredValue) return
    meteredValue = next
    changed?.invoke(next)
  }

  private fun metered(capabilities: NetworkCapabilities?): Boolean =
    capabilities != null && !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
}
