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
