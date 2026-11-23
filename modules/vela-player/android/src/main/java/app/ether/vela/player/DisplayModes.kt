// Display mode choice for frame-rate matching: pure policy over the display's modes, no Android types.
package app.ether.vela.player

import kotlin.math.abs
import kotlin.math.roundToInt

/** One of the display's modes as Android reports it (Display.Mode). */
internal data class DisplayModeFacts(val id: Int, val width: Int, val height: Int, val refreshRate: Double)

/** The viewer's system setting for content frame-rate matching (Android 12+), or UNKNOWN before it. */
internal enum class MatchPreference { NEVER, SEAMLESS_ONLY, ALWAYS, UNKNOWN }

internal object DisplayModes {
  /** Broadcast and film rates. 23.976 is 24000/1001, not 23.976 exactly. */
  private val standardRates = doubleArrayOf(
    24000.0 / 1001, 24.0, 25.0, 30000.0 / 1001, 30.0, 48000.0 / 1001, 48.0, 50.0,
    60000.0 / 1001, 60.0, 100.0, 120000.0 / 1001, 120.0,
  )

  /** A container's rounded rate (23.98, 29.97) as the exact rate it stands for; others unchanged. */
  fun exactRate(fps: Double): Double =
    standardRates.minByOrNull { abs(it - fps) }?.takeIf { abs(it - fps) < 0.02 } ?: fps

  /**
   * How many refreshes show each frame when the refresh rate is an exact multiple of the frame rate,
   * or null. 24 Hz is not a cadence for 23.976 fps: it drops a frame every 42 seconds.
   */
  fun cadence(refreshRate: Double, fps: Double): Int? {
    if (fps <= 0 || refreshRate <= 0) return null
    val rate = exactRate(fps)
    val repeats = (refreshRate / rate).roundToInt()
    if (repeats < 1) return null
    return repeats.takeIf { abs(refreshRate - repeats * rate) <= 0.01 * repeats }
  }

  /**
   * The mode to ask for: the current mode when it already shows every frame evenly (a switch would only
   * blank the screen), else the same-resolution mode with the fewest repeats per frame. Null keeps the
   * current mode: nothing fits.
   */
  fun pick(modes: List<DisplayModeFacts>, current: DisplayModeFacts, fps: Double): DisplayModeFacts? {
    if (cadence(current.refreshRate, fps) != null) return current
    return modes
      .filter { it.width == current.width && it.height == current.height }
      .mapNotNull { mode -> cadence(mode.refreshRate, fps)?.let { mode to it } }
      .minByOrNull { it.second }?.first
  }

  /** How matching resolved for the info card, once the display has settled. */
  fun matchState(modes: List<DisplayModeFacts>, current: DisplayModeFacts, fps: Double, preference: MatchPreference): String = when {
    cadence(current.refreshRate, fps) != null -> "matched"
    preference == MatchPreference.NEVER -> "off"
    pick(modes, current, fps) == null -> "unsupported"
    else -> "unmatched"
  }
}
