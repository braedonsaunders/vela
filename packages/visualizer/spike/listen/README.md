# Visualizers in Listen

[Open the three static layout studies](mockups.html). Ink in Water and Hyperspace are captures from the tvOS Metal spike. Track and lyric text are examples. The revised 18-scene picker is awaiting owner review. The studies illustrate placement and focus using two scenes from the existing framework.

## Entry and navigation

| Surface | Enter | Pick a scene and leave |
| --- | --- | --- |
| Phone / narrow tablet | Open the mini player. In Now Playing, **Visuals** replaces the ambient artwork background with the last available scene. **Expand** fills the safe area. | **Scenes** opens a bottom sheet of named stills. Tap to apply. Swipe down or use Close to return to the same transport. The toggle restores the ambient background. |
| Wide tablet / unfolded phone | Use the same controls, with lyrics or queue in the free pane. Keep controls and text clear of the hinge. | The sheet becomes a side panel when both panes fit. Rotation or folding preserves the scene and the playing position. |
| Web / Mac / Windows / Linux | Enter from the Listen bar's Now Playing view or the available Visualizer shell entry. Full screen fills the app, with browser/window fullscreen available on explicit user input. | Tab to Scenes, move through its tiles and press Enter to apply. The host handles Escape and Back. Leaving full screen restores the originating control. Keyboard media keys keep controlling playback. |
| Apple TV / Android TV | Select Visuals in Now Playing, then Expand. Focus starts on the scene stage in full screen. | Left/Right on the stage changes scene. Select opens the scene rail. Left/Right in the rail moves focus and Select applies the scene. Up/Down remains available to neighboring controls. The host owns Menu and Back. Back closes the page and restores focus to its entry. |

Use still thumbnails from the approved manifest in a virtualized grid. Mark the applied scene separately from the focus ring. Announce the scene name once on commit and restore focus to its tile when the picker reopens. Keep one live renderer across background/fullscreen handoff. A tile, hover, or focus move never starts a second simulation.

Lyrics stays an independent overlay above the visualizer. Give the active line a stable high-contrast scrim, even on white frames. The lyrics control retains its current seek behavior. With the lyric list or transport focused, directional keys navigate those controls. Only the focused full-screen stage consumes scene-change keys.

**TV idle mode.** Offer an opt-in timeout in Now Playing, with a proposed default interval of one minute. Enter only while music is playing and the screen is visible, with no picker, lyrics interaction, accessibility focus session or system overlay active. Hide transport and artwork, retain the scene and let a directional press reveal controls without performing a second action. Back and Menu retain their host behavior. Dedicated media keys still take effect. Pause, end of queue or leaving Listen exits idle. Respect system sleep and screen saver policy. With Reduce Motion, use static artwork or a still frame and disable automatic transitions.

## Approved block contract

L2 reserves the optional Now Playing background and a hidden full-screen page entry. L1 will publish the Listen contract. The experiences lead approved these fields for G2’s generated schema. Today’s music app hosts the component directly until Listen ships. It follows [Building blocks](../../../../docs/plugin-screens.md#building-blocks) and [One renderer for everything](../../../../docs/experiences.md#2-one-renderer-for-everything).

| Node field | Type | Behavior |
| --- | --- | --- |
| `type` | `"visualizer"` | Identifies the built-in rich block. |
| `mode` | `"background" \| "fullscreen"` | Required. The background ignores pointer events and never takes focus. Fullscreen owns one focus region for the stage and picker. |
| `sceneId?` | `Template` | Initial built-in scene ID when the viewer has no supported saved choice. Resolve the template and check the ID against the installed, device-supported manifest. If neither choice is usable, use the first supported scene. |

All block types share the generic `fallback` field. A renderer draws this node for an unknown or unavailable block. Now Playing supplies its ambient artwork tint.

Declare the node in `BlockNode` in `packages/protocol/skin.ts`, resolve it to an `RNode` of kind `visualizer`, and draw it through a component in `packages/skin/src/blocks/` using `ScreenBlockRuntime`. The block fills its allocated area. The surrounding layout owns sizing and uses `PerClass` for responsive dimensions (`default`, `small`, `wide`, `tv`). Document-level `presentation` keeps its existing meaning.

**Availability.** The full-screen document declares `requires: ["visualizer"]`. The Now Playing document keeps the block optional so older clients can still open the page. G2 reserved `env.canVisualize` as the shell entry's `when` condition. The host enables it when the device supports a built-in scene and its rendering budget. Keep the entry hidden on budget TV devices until the floor measurements pass.

**Selection and trust.** G1 reserved the local action `vela.setVisualizerScene {id}`. A valid selection updates the active block and the viewer's local preference. Ignore an unsupported ID and retain the current choice. Both modes share the preference. The choice stays on this device, scoped to the server and viewer profile. Documents and plugins may name only compiled Vela scenes by ID. The schema accepts no shader source, script, samples or analysis records. The block privately observes the active music engine through a read-only tap. Opening it preserves the existing audio route, transport and queue.

**Parts and motion.** Publish `visualizer.scenePicker`, `visualizer.sceneChip`, `visualizer.sceneChipActive` and `visualizer.caption` through G2's parts API. Documents style these with `$ui` tokens. The engine owns scene colors and derives its default tint from `$ui.accent` and the artwork tint already available on the stage. With `env.still`, display a still and disable automatic scene transitions.

**TV acceptance.** When the block exists, add the Listen entry, scene switch and focus path to `tools/perf` on the `vela-tv-floor` emulator. Measure entry to first visible scene frame (≤400 ms), p95 focus move (≤16 ms), and UI-thread frame durations throughout initialization, switching and steady playback (no long frames). Verify that hiding the block, backgrounding the app or covering it with the player stops both analysis and rendering while the music clock advances. Use slow audio envelopes for geometry and fast envelopes for light. These criteria still need measurements on the integrated block.

## Which player carries the music?

The Listen music queue is attached by `AudioDock` in `apps/vela/src/media/audio.tsx`. The web export selects `audio-engine.web.ts`. That includes the Electron browser windows on Mac and Linux and the WebView2 window on Windows. Their Aether / mpv integrations host the **video** player. A libmpv audio filter or macOS Aether callback would therefore miss the ordinary Listen queue in this checkout.

| Actual path | Proposed observation point |
| --- | --- |
| Web, Mac Electron, Linux Electron, Windows WebView2 | In `modules/vela-player/web/gapless/player.ts`, outgoing and incoming items each feed the common bus through level and fade gains. Branch a single analyser from the final EQ filter before master volume. Keep the normal destination connection. Rebind when `ensureContext` changes sample rate, and disconnect the observation branch when hidden. The WebGL2 canvas reads the mixed music in the renderer process. |
| HTML audio fallback in those four hosts | HLS, unsupported decode or a speed change may select `createElementEngine`. Its current and preloaded elements swap, and its silent Media Session element contains no music. Keep ambient artwork until a separately tested, origin-permitted element graph can observe both current and spare elements through handoff. Preserve fallback playback when the URL or host cannot provide analyzable audio. |
| iOS / iPadOS / tvOS | In `modules/vela-player/ios/AudioPlayback.swift`, music uses AVQueuePlayer, with a shared SoundTap for a player's successive items. Observe the existing post-processing tap. Align the two players by presentation time during AutoMix. Reusing the tap preserves item handoff. |
| Android phone / tablet / TV | In `modules/vela-player/android`, each music ExoPlayer has its own VelaSoundProcessor. Copy bounded, timestamped mono samples after processing. Combine overlapping players on the consumer side using their actual gains and output timing. Never wait for GPU or analysis in the audio callback. |

**Integration acceptance.** On each desktop shell, play a supported pair across an ordinary gapless handoff and an AutoMix overlap. Capture the mixed output against a renderer-off baseline and check sample continuity, fade timing, analyser response and underruns. Repeat after changing sample rate, hiding/restoring the window and switching to an element fallback. Verify the scene follows the active engine, the fallback stays audible on a permitted test route, and closing the visualizer leaves the queue and media keys working. These desktop and Listen flows await integration and device testing. The static mockups demonstrate layout only.
