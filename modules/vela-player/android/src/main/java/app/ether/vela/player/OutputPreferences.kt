// The viewer's audio and picture delivery choices on Android, kept per device and applied to every full-screen
// load: the `outputPreference` command ("passthrough=off") and Snapshot.outputPreferences, the same command and
// report as the Apple player's (ios/PlaybackPreferences.swift). Pure; the engine applies them.
//
//   passthrough  auto: Dolby (AC-3, E-AC-3 with Atmos, TrueHD with Atmos) and DTS (core, HD MA, DTS:X) go to
//                the receiver undecoded where the route takes them (Media3's AudioCapabilities), so it
//                decodes them and renders the objects; off: every track is decoded on the device to PCM in
//                its own channel layout (a 7.1 bed for Atmos), which the system mixes down to the route.
//   dolbyVision  auto: Dolby Vision where a decoder takes it (Profile 7 converted or reduced, DolbyVision.plan);
//                base-layer: the HDR10/HLG base of Profiles 7 and 8, for a remux whose Dolby Vision is broken.
//
// Android has no object renderer of its own, so there is no Atmos rendering or speaker layout choice (Apple
// offers those only where it renders objects); the decoded layout follows the source and the system's mix.
package app.ether.vela.player

internal data class OutputPreferences(val passthrough: String = "auto", val dolbyVision: String = "auto") {
  val values: Map<String, String> get() = mapOf("passthrough" to passthrough, "dolbyVision" to dolbyVision)

  /** Every encoded track decoded on the device. */
  val decodeAll: Boolean get() = passthrough == "off"
  val baseLayer: Boolean get() = dolbyVision == "base-layer"

  /** One "name=value" choice applied, or null when the name or value is unknown. */
  fun updated(assignment: String): OutputPreferences? {
    val name = assignment.substringBefore('=', "")
    val value = assignment.substringAfter('=', "")
    if (value !in (choices[name] ?: return null)) return null
    return if (name == "passthrough") copy(passthrough = value) else copy(dolbyVision = value)
  }

  /** The settings to offer, in menu order: passthrough on a TV (its receiver may be off now), where the route
   * takes any encoded format, or while it is off (so it can be turned back on); Dolby Vision always. */
  fun available(routePassthrough: Boolean, television: Boolean = false): List<String> =
    listOfNotNull("passthrough".takeIf { television || routePassthrough || decodeAll }, "dolbyVision")

  companion object {
    val choices = mapOf("passthrough" to listOf("auto", "off"), "dolbyVision" to listOf("auto", "base-layer"))

    /** Stored values; any missing or unknown keeps its default. */
    fun from(stored: (String) -> String?): OutputPreferences =
      choices.keys.fold(OutputPreferences()) { preferences, name ->
        stored(name)?.let { preferences.updated("$name=$it") } ?: preferences
      }
  }
}

/** Playback speed: the web player's choices (0.5–2×), pitch kept. A live stream plays at 1× (its latency is
 * the stream's to keep), and audio sent to the receiver undecoded cannot be sped up. */
internal object PlaybackSpeed {
  val choices = listOf(0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0)

  /** The speeds to offer: none (a disabled menu at 1×) for live or undecoded audio. */
  fun offered(live: Boolean, passthrough: Boolean): List<Double> = if (live || passthrough) emptyList() else choices

  /** Why `value` cannot be set now, or null when it can. */
  fun refusal(value: Double?, live: Boolean, passthrough: Boolean): String? = when {
    value == null || !value.isFinite() -> "speed needs a value"
    live -> "Live playback speed is managed automatically"
    value < 0.5 || value > 2 -> "Playback speed must be between 0.5 and 2"
    passthrough && value != 1.0 -> "Playback speed needs decoded audio: set passthrough off in Sound and picture"
    else -> null
  }
}
