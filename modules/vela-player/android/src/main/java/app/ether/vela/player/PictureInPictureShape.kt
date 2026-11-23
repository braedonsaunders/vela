// The picture-in-picture window's shape for a video: Android takes aspect ratios from 1:2.39 to 2.39:1, so a
// wider (or taller) picture is clamped to that and letterboxed inside the window. Pure.
package app.ether.vela.player

internal object PictureInPictureShape {
  private const val WIDEST = 2.39

  /** Width and height of the window's ratio for a `width`×`height` video, or null before the size is known. */
  fun ratio(width: Int, height: Int): Pair<Int, Int>? = when {
    width <= 0 || height <= 0 -> null
    width.toDouble() / height > WIDEST -> 239 to 100
    height.toDouble() / width > WIDEST -> 100 to 239
    else -> width to height
  }
}
