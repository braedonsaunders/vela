// Content frame-rate matching for full-screen video, within the viewer's system preference.
//
// HDMI refresh changes are never seamless, so Surface.setFrameRate with CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS
// (and its Android 11 default) never switches a TV. On a TV Vela therefore asks for an exact display mode
// (WindowManager.LayoutParams.preferredDisplayModeId, honoured since Android 6), unless the viewer chose
// "Never" or "Seamless only" in Android 12+'s Match content frame rate setting, and also gives the surface
// a CHANGE_FRAME_RATE_ALWAYS hint, which the system applies within that same setting. Phones and tablets
// get a seamless-only hint (variable-refresh panels), never a mode switch.
package app.ether.vela.player

import android.app.Activity
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display
import android.view.Surface

/** What display matching needs to know of a video. */
internal class VideoFacts(val frameRate: Double)

internal object DisplayMatching {
  /** Facts from the server's verified frame rate for an original, or from the decoded video. */
  fun facts(frameRate: Double?): VideoFacts? = frameRate?.takeIf { it > 0 }?.let(::VideoFacts)

  /** Asks for the display mode and frame rate that suit `facts`; null clears the request. */
  fun prefer(facts: VideoFacts?, surface: Surface?, activity: Activity?) {
    activity ?: return
    val tv = isTv(activity)
    val rate = facts?.frameRate?.let(DisplayModes::exactRate)
    val display = activity.window?.decorView?.display
    if (tv && display != null) {
      val preference = preference(activity)
      val switches = preference == MatchPreference.ALWAYS || preference == MatchPreference.UNKNOWN
      val wanted = if (rate != null && switches) DisplayModes.pick(modes(display), current(display), rate) else null
      val attributes = activity.window.attributes
      val id = wanted?.id ?: 0
      if (attributes.preferredDisplayModeId != id) {
        attributes.preferredDisplayModeId = id
        activity.window.attributes = attributes
      }
    }
    if (surface == null || !surface.isValid) return
    val hint = rate?.toFloat() ?: 0f
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val strategy = if (tv && rate != null) Surface.CHANGE_FRAME_RATE_ALWAYS else Surface.CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS
      surface.setFrameRate(hint, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE, strategy)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      surface.setFrameRate(hint, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE)
    }
  }

  /** The display mode and how matching resolved, for the info card's videoOut. */
  fun output(activity: Activity?, frameRate: Double?): Map<String, Any> {
    val display = activity?.window?.decorView?.display ?: return emptyMap()
    val current = current(display)
    val out = mutableMapOf<String, Any>("width" to current.width, "height" to current.height, "refreshRate" to current.refreshRate)
    if (frameRate != null && frameRate > 0) {
      val preference = if (isTv(activity)) preference(activity) else MatchPreference.SEAMLESS_ONLY
      out["frameRateMatch"] = DisplayModes.matchState(modes(display), current, frameRate, preference)
    }
    return out
  }

  /** The display's current mode, for the console. */
  fun describe(activity: Activity?): String {
    val display = activity?.window?.decorView?.display ?: return "unknown"
    val mode = display.mode
    return "${mode.physicalWidth}x${mode.physicalHeight}@${"%.3f".format(mode.refreshRate)}"
  }

  private fun isTv(activity: Activity) =
    activity.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION

  private fun preference(activity: Activity): MatchPreference {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return MatchPreference.UNKNOWN
    return when (activity.getSystemService(DisplayManager::class.java)?.matchContentFrameRateUserPreference) {
      DisplayManager.MATCH_CONTENT_FRAMERATE_NEVER -> MatchPreference.NEVER
      DisplayManager.MATCH_CONTENT_FRAMERATE_SEAMLESSS_ONLY -> MatchPreference.SEAMLESS_ONLY
      DisplayManager.MATCH_CONTENT_FRAMERATE_ALWAYS -> MatchPreference.ALWAYS
      else -> MatchPreference.UNKNOWN
    }
  }

  private fun facts(mode: Display.Mode) =
    DisplayModeFacts(mode.modeId, mode.physicalWidth, mode.physicalHeight, mode.refreshRate.toDouble())

  private fun current(display: Display) = facts(display.mode)

  private fun modes(display: Display) = display.supportedModes.map(::facts)
}
