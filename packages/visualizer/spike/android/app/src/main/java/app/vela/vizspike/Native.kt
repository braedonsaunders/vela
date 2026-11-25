package app.vela.vizspike

/** libvizspike: the PCM tap's ring buffer, and the visualizer engine (Hermes + GLES executor + DSP). */
object Native {
  init { System.loadLibrary("vizspike") }

  /** Playback thread: [n] mono samples starting at media frame [frame]. */
  @JvmStatic external fun tapWrite(mono: FloatArray, n: Int, frame: Long, rate: Int)

  // GL thread only.
  @JvmStatic external fun create(bundle: ByteArray, width: Int, height: Int, scene: String, gpuFinish: Boolean): Long
  @JvmStatic external fun resize(handle: Long, width: Int, height: Int)
  @JvmStatic external fun frame(handle: Long, heardUs: Long, underruns: Int)
  @JvmStatic external fun step(handle: Long, delta: Int)
  @JvmStatic external fun destroy(handle: Long, glValid: Boolean)
}
