// The JNI binding to libmpv (src/main/cpp). Handles come from create() and end with destroy();
// statuses are libmpv's (negative on error, errorString() names them).
package app.ether.vela.player

import android.view.Surface

internal object MpvNative {
  init {
    System.loadLibrary("velampv")
  }

  @JvmStatic external fun create(): Long
  @JvmStatic external fun initialize(handle: Long): Int
  @JvmStatic external fun destroy(handle: Long)
  @JvmStatic external fun setOption(handle: Long, name: String, value: String): Int
  @JvmStatic external fun setSurface(handle: Long, surface: Surface?): Int
  @JvmStatic external fun command(handle: Long, arguments: Array<String>): Int
  @JvmStatic external fun setPropertyString(handle: Long, name: String, value: String): Int
  @JvmStatic external fun setPropertyFlag(handle: Long, name: String, value: Boolean): Int
  @JvmStatic external fun setPropertyDouble(handle: Long, name: String, value: Double): Int
  @JvmStatic external fun setPropertyStringList(handle: Long, name: String, values: Array<String>): Int
  @JvmStatic external fun observe(handle: Long, name: String, format: Int): Int
  @JvmStatic external fun requestLog(handle: Long, level: String): Int
  @JvmStatic external fun waitEvent(handle: Long, timeout: Double): MpvEvent?
  @JvmStatic external fun wakeup(handle: Long)
  @JvmStatic external fun errorString(status: Int): String
}

/** libmpv's mpv_format values for observed properties. */
internal enum class MpvFormat(val value: Int) {
  STRING(1),
  FLAG(3),
  INT64(4),
  DOUBLE(5),
  NODE(6),
}

/**
 * One libmpv event. `name` and `value` are the property and its value (Boolean, Long, Double,
 * String, List or Map) for a property change, or the prefix and text of a log message; `reason`
 * is an end-file reason or a log level, and `error` libmpv's status.
 */
class MpvEvent(val id: Int, val name: String?, val value: Any?, val reason: Int, val error: Int) {
  companion object {
    const val SHUTDOWN = 1
    const val LOG_MESSAGE = 2
    const val END_FILE = 7
    const val FILE_LOADED = 8
    const val PLAYBACK_RESTART = 21
    const val PROPERTY_CHANGE = 22

    /** mpv_end_file_reason: the file failed to play. */
    const val END_REASON_ERROR = 4

    /** MPV_ERROR_LOADING_FAILED: the input could not be opened or read. */
    const val ERROR_LOADING_FAILED = -13
  }
}
