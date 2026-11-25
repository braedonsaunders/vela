# Visualizers in Listen

[Open the three static layout studies](mockups.html). Ink in Water and Hyperspace are captures from the tvOS Metal spike. Track and lyric text are examples. The revised 18-scene picker is awaiting owner review. The studies illustrate placement and focus using two scenes from the existing framework.

## Entry and navigation

| Surface | Enter | Pick a scene and leave |
| --- | --- | --- |
| Phone / narrow tablet | Open the mini player. In Now Playing, **Visuals** replaces the ambient artwork background with the last available scene. **Expand** fills the safe area. | **Scenes** opens a bottom sheet of named stills. Tap to apply. Swipe down or use Close to return to the same transport. The toggle restores the ambient background. |
| Wide tablet / unfolded phone | Use the same controls, with lyrics or queue in the free pane. Keep controls and text clear of the hinge. | The sheet becomes a side panel when both panes fit. Rotation or folding preserves the scene and the playing position. |
| Web / Mac / Windows / Linux | Enter from the Listen bar's Now Playing view or the available Visualizer shell entry. Full screen fills the app, with browser/window fullscreen available on explicit user input. | Tab to Scenes, use arrow keys within its grid and Enter to apply. Escape dismisses the panel first. Leaving full screen restores the originating control. Keyboard media keys keep controlling playback. |
| Apple TV / Android TV | Select Visuals in Now Playing, then Expand. Focus starts on the scene stage in full screen. | On the stage, Left/Right select the preceding/following available scene. Menu opens Scenes. Android remotes without Menu use Select on the stage. In the picker, arrows move focus without switching the stage and Select commits. Back/Menu dismisses the picker. A visible **Return to Now Playing** action there provides an exit even with a single Menu/Back key. |

Use still thumbnails from the approved manifest in a virtualized grid. Mark the applied scene separately from the focus ring. Announce the scene name once on commit and restore focus to its tile when the picker reopens. Keep one live renderer across background/fullscreen handoff. A tile, hover, or focus move never starts a second simulation.

Lyrics stays an independent overlay above the visualizer. Give the active line a stable high-contrast scrim, even on white frames. The lyrics control retains its current seek behavior. With the lyric list or transport focused, directional keys navigate those controls. Only the focused full-screen stage consumes scene-change keys.

**TV idle mode.** Offer an opt-in timeout in Now Playing, with a proposed default interval of one minute. Enter only while music is playing and the screen is visible, with no picker, lyrics interaction, accessibility focus session or system overlay active. Hide transport and artwork, retain the scene and let any navigation press reveal controls without performing a second action. Dedicated media keys still take effect. Pause, end of queue or leaving Listen exits idle. Respect system sleep and screen saver policy. With Reduce Motion, use static artwork or a still frame and disable automatic transitions.

## Agreement with Listen

The experiences lead reserved two surfaces in the L1 and L2 briefs. L1 will publish the rich-block runtime contract and keep Now Playing able to host a background. L2 will use the ambient tint when the block is absent and hide its full-screen entry until available. The plan on `experiences/main` documents token-based parts, block-owned TV focus and bounded data in `docs/experiences.md`. The promised `packages/skin/src/blocks/listen/README.md` was absent when this proposal was prepared. The field names below are offered for L1/L2 review.

| Proposed contract | Owner and behavior |
| --- | --- |
| Built-in `visualizer` block, `background` or `fullscreen` | Listen places it and owns navigation. The background is decorative and outside the focus order. The full-screen block hosts the stage and picker. |
| Capability and scene selection | The app checks renderer support, music-analysis availability and the bundled scene manifest. Local preferences hold the chosen stable scene ID. An unavailable ID falls back to the first supported scene. Context loss or analysis failure restores ambient artwork and the existing transport. |
| Parts | Offer `visualizer.scrim`, `visualizer.toolbar`, `visualizer.sceneTile` and `visualizer.selectedScene` as token-styled parts. The block manages focus, descriptions and animations. |
| Audio and rendering | The host passes visibility, presentation, reduced motion and a local selection to the renderer. The active music engine owns the clock and analysis. Documents receive neither samples nor per-frame subscriptions. Shaders and scene IDs come from the installed manifest. |

## Which player carries the music?

The Listen music queue is attached by `AudioDock` in `apps/vela/src/media/audio.tsx`. The web export selects `audio-engine.web.ts`. That includes the Electron browser windows on Mac and Linux and the WebView2 window on Windows. Their Aether / mpv integrations host the **video** player. A libmpv audio filter or macOS Aether callback would therefore miss the ordinary Listen queue in this checkout.

| Actual path | Proposed observation point |
| --- | --- |
| Web, Mac Electron, Linux Electron, Windows WebView2 | In `modules/vela-player/web/gapless/player.ts`, outgoing and incoming items each feed the common bus through level and fade gains. Branch a single analyser from the final EQ filter before master volume. Keep the normal destination connection. Rebind when `ensureContext` changes sample rate, and disconnect the observation branch when hidden. The WebGL2 canvas reads the mixed music in the renderer process. |
| HTML audio fallback in those four hosts | HLS, unsupported decode or a speed change may select `createElementEngine`. Its current and preloaded elements swap, and its silent Media Session element contains no music. Keep ambient artwork until a separately tested, origin-permitted element graph can observe both current and spare elements through handoff. Preserve fallback playback when the URL or host cannot provide analyzable audio. |
| iOS / iPadOS / tvOS | In `modules/vela-player/ios/AudioPlayback.swift`, music uses AVQueuePlayer, with a shared SoundTap for a player's successive items. Observe the existing post-processing tap. Align the two players by presentation time during AutoMix. Reusing the tap preserves item handoff. |
| Android phone / tablet / TV | In `modules/vela-player/android`, each music ExoPlayer has its own VelaSoundProcessor. Copy bounded, timestamped mono samples after processing. Combine overlapping players on the consumer side using their actual gains and output timing. Never wait for GPU or analysis in the audio callback. |

**Integration acceptance.** On each desktop shell, play a supported pair across an ordinary gapless handoff and an AutoMix overlap. Capture the mixed output against a renderer-off baseline and check sample continuity, fade timing, analyser response and underruns. Repeat after changing sample rate, hiding/restoring the window and switching to an element fallback. Verify the scene follows the active engine, the fallback stays audible on a permitted test route, and closing the visualizer leaves the queue and media keys working. These desktop and Listen flows await integration and device testing. The static mockups demonstrate layout only.
