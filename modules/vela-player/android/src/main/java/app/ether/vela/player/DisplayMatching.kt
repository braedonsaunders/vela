// Display mode matching on Android and Android TV: the video's frame rate goes to the Surface
// (Surface.setFrameRate, which follows the user's "match content frame rate" setting) and the window
// asks for the display mode of the same resolution whose refresh rate is a whole multiple of it.
// Cleared when playback stops. HDR output is not switched here: mpv renders to an SDR EGL surface.
package app.ether.vela.player

import android.app.Activity
import android.os.Build
import android.view.Display
import android.view.Surface
import kotlin.math.abs
import kotlin.math.roundToInt

/** What display matching needs to know of a video. */
internal class VideoFacts(val frameRate: Double)

internal object DisplayMatching {
  /** Facts from the server's verified frame rate for an original, or from the decoded video. */
  fun facts(frameRate: Double?): VideoFacts? = frameRate?.takeIf { it > 0 }?.let(::VideoFacts)

  /** Asks for the display mode and frame rate that suit `facts`; null clears the request. */
  fun prefer(facts: VideoFacts?, surface: Surface?, activity: Activity?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && surface != null && surface.isValid) {
      val rate = facts?.frameRate?.toFloat() ?: 0f
      surface.setFrameRate(rate, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE, Surface.CHANGE_FRAME_RATE_ALWAYS)
    }
    val window = activity?.window ?: return
    val display = window.decorView.display ?: return
    val mode = facts?.let { mode(display, it) }
    val attributes = window.attributes
    val wanted = mode?.modeId ?: 0
    if (attributes.preferredDisplayModeId != wanted) {
      attributes.preferredDisplayModeId = wanted
      window.attributes = attributes
    }
  }

  /** The current mode's size with a refresh rate that is a whole multiple of the video's, if any. */
  private fun mode(display: Display, facts: VideoFacts): Display.Mode? {
    val current = display.mode
    val candidates = display.supportedModes.filter {
      it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight
    }
    return candidates
      .filter { multiple(it.refreshRate.toDouble(), facts.frameRate) }
      .minByOrNull { it.refreshRate }
  }

  private fun multiple(refreshRate: Double, frameRate: Double): Boolean {
    if (frameRate <= 0) {
      return false
    }
    val ratio = refreshRate / frameRate
    return ratio >= 1 && abs(ratio - ratio.roundToInt()) < 0.01
  }

  /** The window asked for a display mode the display has not reached yet. */
  fun switching(activity: Activity?): Boolean {
    val window = activity?.window ?: return false
    val wanted = window.attributes.preferredDisplayModeId
    val display = window.decorView.display ?: return false
    return wanted != 0 && display.mode.modeId != wanted
  }

  /** The display's current mode, for the console. */
  fun describe(activity: Activity?): String {
    val display = activity?.window?.decorView?.display ?: return "unknown"
    val mode = display.mode
    return "${mode.physicalWidth}x${mode.physicalHeight}@${"%.3f".format(mode.refreshRate)}"
  }
}
