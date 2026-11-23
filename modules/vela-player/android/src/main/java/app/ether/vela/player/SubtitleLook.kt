// The viewer's subtitle appearance (the CC menu's subtitleStyle command): the same names and choices as
// modules/vela-player/web/engine/universal/subtitles/preferences.ts. Pure; the view applies it.
package app.ether.vela.player

internal data class SubtitleLook(
  val size: String = "medium",
  val background: String = "shadow",
  val color: String = "white",
  val position: String = "bottom",
) {
  /** Text height as a fraction of the video's height (the web player's 0.058 × size factor). */
  val textFraction: Float get() = 0.058f * when (size) { "small" -> 0.75f; "large" -> 1.25f; "xl" -> 1.6f; else -> 1f }
  /** Space below the lowest line, as a fraction of the video's height. */
  val bottomFraction: Float get() = if (position == "raised") 0.2f else 0.08f

  val snapshot: Map<String, Any>
    get() = mapOf("subtitleSize" to size, "subtitleBackground" to background, "subtitleColor" to color,
      "subtitlePosition" to position, "offsetSeconds" to 0)

  /** One `name=value` command applied, or null when it is not a known choice. */
  fun updated(command: String): SubtitleLook? {
    val name = command.substringBefore('=', "")
    val value = command.substringAfter('=', "")
    if (value !in (choices[name] ?: return null)) return null
    return updated(name, value)
  }

  fun updated(name: String, value: String): SubtitleLook? = when {
    value !in (choices[name] ?: emptyList()) -> null
    name == "subtitleSize" -> copy(size = value)
    name == "subtitleBackground" -> copy(background = value)
    name == "subtitleColor" -> copy(color = value)
    else -> copy(position = value)
  }

  companion object {
    val choices = mapOf(
      "subtitleSize" to listOf("small", "medium", "large", "xl"),
      "subtitleBackground" to listOf("none", "shadow", "box"),
      "subtitleColor" to listOf("white", "yellow"),
      "subtitlePosition" to listOf("bottom", "raised"),
    )

    /** Stored values (any missing or unknown keeps its default). */
    fun from(stored: (String) -> String?): SubtitleLook =
      choices.keys.fold(SubtitleLook()) { look, name -> stored(name)?.let { look.updated(name, it) } ?: look }
  }
}
