// Draws libass frames over the video, refreshed on every display frame while a full-screen player is shown.
// Frames render at most 1920 pixels wide and are scaled to the video rectangle.
package app.ether.vela.player

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.view.Choreographer
import android.view.View

internal class AssOverlay(context: Context) : View(context), Choreographer.FrameCallback {
  /** Renders into the bitmap: -1 no ASS track, 0 unchanged, 1 drawn, 2 blank (PlaybackEngine.renderAss). */
  var source: ((Bitmap, Boolean) -> Int)? = null
  private var bitmap: Bitmap? = null
  private var showing = false
  private var running = false
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val target = Rect()

  fun start() {
    if (running) return
    running = true
    Choreographer.getInstance().postFrameCallback(this)
  }

  fun stop() {
    running = false
    Choreographer.getInstance().removeFrameCallback(this)
    if (showing) { showing = false; invalidate() }
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (!running) return
    val draw = source
    if (draw != null && width > 0 && height > 0) {
      val scale = minOf(1f, MAX_WIDTH / width)
      val w = (width * scale).toInt().coerceAtLeast(1)
      val h = (height * scale).toInt().coerceAtLeast(1)
      var force = false
      if (bitmap?.let { it.width != w || it.height != h } != false) {
        bitmap?.recycle()
        bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        force = true
      }
      when (draw(bitmap!!, force)) {
        1 -> { showing = true; invalidate() }
        -1, 2 -> if (showing) { showing = false; invalidate() }
      }
    } else if (showing) { showing = false; invalidate() }
    Choreographer.getInstance().postFrameCallback(this)
  }

  override fun onDraw(canvas: Canvas) {
    val frame = bitmap ?: return
    if (!showing) return
    target.set(0, 0, width, height)
    canvas.drawBitmap(frame, null, target, paint)
  }

  override fun onDetachedFromWindow() {
    stop()
    bitmap?.recycle()
    bitmap = null
    super.onDetachedFromWindow()
  }

  private companion object {
    const val MAX_WIDTH = 1920f
  }
}
