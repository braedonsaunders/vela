// Styled ASS/SSA subtitles through libass: positioning, fonts, outlines, karaoke and animated tags that
// Media3's SsaParser drops. Events arrive raw from the extractor tap (SampleTap) with their absolute times;
// the view's overlay asks for a frame at the player's position. Media3's cues stay the fallback.
package app.ether.vela.player

import android.graphics.Bitmap
import java.io.File
import java.util.Locale

/** libass (ISC) through JNI. Absent library means Media3's own SSA cues. */
internal object AssNative {
  val available: Boolean by lazy { runCatching { System.loadLibrary("vela_ass"); true }.getOrDefault(false) }

  // Public members of an internal object: JNI binds by the unmangled name.
  @JvmStatic external fun create(fontPath: String, family: String): Long
  @JvmStatic external fun addFont(handle: Long, name: String, data: ByteArray)
  @JvmStatic external fun reloadFonts(handle: Long)
  @JvmStatic external fun newTrack(handle: Long, header: ByteArray): Long
  @JvmStatic external fun addEvent(track: Long, chunk: ByteArray, startMs: Long, durationMs: Long)
  @JvmStatic external fun freeTrack(track: Long)
  @JvmStatic external fun render(handle: Long, track: Long, timeMs: Long, bitmap: Bitmap, storageWidth: Int, storageHeight: Int, force: Boolean): Int
  @JvmStatic external fun destroy(handle: Long)
}

/** One engine's libass renderer and its tracks, keyed by Media3 format id. Thread-safe: the loading thread
 * adds tracks and events while the main thread renders. */
internal class AssSubtitles private constructor(private val handle: Long) {
  private val tracks = mutableMapOf<String, Long>()
  private var released = false

  /** Called once, when the first ASS track appears (the engine then reads the file's attached fonts). */
  var onFirstTrack: () -> Unit = {}

  @Synchronized fun track(id: String, header: ByteArray) {
    if (released || id in tracks) return
    AssNative.newTrack(handle, header).takeIf { it != 0L }?.let { tracks[id] = it }
    if (tracks.size == 1) onFirstTrack()
  }

  /** Fonts attached to the media file, which scripts name by family. */
  @Synchronized fun addFonts(fonts: List<MatroskaAttachment>) {
    if (released || fonts.isEmpty()) return
    fonts.forEach { AssNative.addFont(handle, it.name, it.data) }
    AssNative.reloadFonts(handle)
  }

  @Synchronized fun event(id: String, timeUs: Long, sample: ByteArray) {
    if (released) return
    val track = tracks[id] ?: return
    val (duration, chunk) = AssSample.parse(sample) ?: return
    AssNative.addEvent(track, chunk, timeUs / 1000, duration)
  }

  @Synchronized fun has(id: String) = !released && id in tracks

  /** -1: no such track; 0: unchanged; 1: drawn; 2: nothing to show at this time. */
  @Synchronized fun render(id: String, timeMs: Long, bitmap: Bitmap, videoWidth: Int, videoHeight: Int, force: Boolean): Int {
    if (released) return -1
    val track = tracks[id] ?: return -1
    return AssNative.render(handle, track, timeMs, bitmap, videoWidth, videoHeight, force)
  }

  @Synchronized fun release() {
    if (released) return
    released = true
    tracks.values.forEach(AssNative::freeTrack)
    tracks.clear()
    AssNative.destroy(handle)
  }

  companion object {
    /** A renderer whose fallback font covers the viewer's script: Noto Sans CJK for Chinese, Japanese and
     * Korean, Roboto otherwise. Android has no font provider for libass, so every family falls back to it. */
    fun create(): AssSubtitles? {
      if (!AssNative.available) return null
      val cjk = Locale.getDefault().language in setOf("zh", "ja", "ko")
      val candidates = (if (cjk) listOf("/system/fonts/NotoSansCJK-Regular.ttc" to "Noto Sans CJK") else emptyList()) +
        listOf("/system/fonts/Roboto-Regular.ttf" to "Roboto", "/system/fonts/DroidSans.ttf" to "Droid Sans")
      val (path, family) = candidates.firstOrNull { File(it.first).exists() } ?: return null
      return AssNative.create(path, family).takeIf { it != 0L }?.let(::AssSubtitles)
    }
  }
}
