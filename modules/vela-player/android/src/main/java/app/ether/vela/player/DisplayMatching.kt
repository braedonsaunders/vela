// Full-screen TV Surface frame-rate hints, subject to the system match-content preference.
package app.ether.vela.player

import android.app.Activity
import android.os.Build
import android.view.Surface

/** What display matching needs to know of a video. */
internal class VideoFacts(val frameRate: Double)

internal object DisplayMatching {
  /** Facts from the server's verified frame rate for an original, or from the decoded video. */
  fun facts(frameRate: Double?): VideoFacts? = frameRate?.takeIf { it > 0 }?.let(::VideoFacts)

  /** Asks for the display mode and frame rate that suit `facts`; null clears the request. */
  fun prefer(facts: VideoFacts?, surface: Surface?, activity: Activity?) {
    val tv = activity?.resources?.configuration?.uiMode?.and(android.content.res.Configuration.UI_MODE_TYPE_MASK) == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
    if (!tv || surface == null || !surface.isValid) return
    val rate = facts?.frameRate?.toFloat() ?: 0f
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      surface.setFrameRate(rate, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE, Surface.CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      surface.setFrameRate(rate, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE)
    }
  }

  /** The display's current mode, for the console. */
  fun describe(activity: Activity?): String {
    val display = activity?.window?.decorView?.display ?: return "unknown"
    val mode = display.mode
    return "${mode.physicalWidth}x${mode.physicalHeight}@${"%.3f".format(mode.refreshRate)}"
  }
}
