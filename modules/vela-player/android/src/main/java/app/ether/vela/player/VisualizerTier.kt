package app.ether.vela.player

/** Renderer names come from the GLES context the visualizer will actually use. */
internal object VisualizerTier {
  fun software(name: String) = name.isBlank() || listOf(
    "swiftshader", "llvmpipe", "softpipe", "software rasterizer", "swrast", "lavapipe", "basic render driver"
  ).any { name.contains(it, ignoreCase = true) }

  // The Android TV D3D12 translation path missed both the scene and picker budgets even
  // with an RTX 4080 and the scene held during focus moves. Handhelds have a different UI.
  fun slowTvTranslation(name: String, tv: Boolean) =
    tv && name.startsWith("Android Emulator OpenGL ES Translator (D3D12 (", ignoreCase = true)
}

/** Only sample an explicit foreground fullscreen action. A single cold driver stall can recover. */
internal class VisualizerEntryBudget {
  private var misses = 0
  fun exceeded(elapsedMs: Long): Boolean {
    misses = if (elapsedMs > 400) misses + 1 else 0
    return elapsedMs > 1600 || misses >= 2
  }
}
