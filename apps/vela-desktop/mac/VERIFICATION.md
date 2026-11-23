# macOS native playback verification

2026-11-19, Apple silicon, macOS 26.6.2. Runs used a scratch Electron copy followed by the Developer ID signed,
notarized app, always with separate user data. The owner's installed application is untouched.

## Verified

- Workspace typecheck passes after installing frozen workspace/mock-server dependencies.
- Final Bun run: 688 passing, one Android/JVM test skipped. Additional
  desktop lifecycle tests cover teardown, stale callbacks and browser fallback.
- Native addon loads, reports capabilities, creates/resizes/releases its NSView,
  revokes grants and tolerates repeated destroy. No subprocess is required.
- Camp Crystal from lab Ether visibly plays through Aether's loopback AVPlayer
  route, with advancing `aether-original` snapshots and firstFrameReady=true.
- English SRT selected in the actual page menu visibly renders captions on the
  native picture; the page's controls remain above the video. The title offers
  one E-AC-3 audio track, so this alone does not verify audio-track switching.
- Ten-second forward seek advances the native clock. A 1100x700 resize updates
  the actual outer window and native picture. Fullscreen entry expands to the
  display after explicit native/HTML fullscreen synchronization. Native Escape
  was injected into the test process after fullscreen entry completed; within
  the timed assertion DOM fullscreen was false and normal bounds were 1100x700.

- The signed app visibly renders Fall's Asmo HEVC PQ remux at an explicit
  180-second start position, in both windowed and fullscreen modes. At the
  same time diagnostics report `videoFormat=hdr10`, `route=loopback`,
  `firstFrameReady=true`, `playerLayerEDR=true`, `preferredDynamicRange=high`,
  current EDR headroom 3.51 (potential 16), and rate 1.0. The earlier black
  opening-frame capture is not the visual evidence for this result.
- A local 30-second two-AAC-track fixture in the signed app switches
  `tone440 -> tone880 -> tone440`, reports the selected track, and continues
  native playback after seeking to ten seconds. Subtitle selection/off is
  acknowledged; Camp's SRT capture above provides the visible caption proof.
- Arm64 iOS and tvOS simulator full app builds passed after the shared Swift
  extraction. Mobile device runtime was not rechecked in this task.
- `build.mjs` produced the arm64 DMG and ZIP. Developer ID team is 9YL3YCJTNT;
  deep/strict signature verification passes. Apple notarization was Accepted,
  stapling and validation pass, and Gatekeeper reports Notarized Developer ID.

## Server selection and live recovery

The fresh Mac session advertised HDR10/HLG but Ether selected its cached
1920x960 H.264 SDR Fall release. The authorized lab-only Asmo pin enabled the
HDR proof. The coordinator confirmed restoration to the original empty pin
list after each run. No production configuration changed.

CHROMA 80 visibly plays through `remoteBypass` / `aether-hls`. A test-only
wrapper at the native-host seam redirects its already-validated source to a
loopback relay. The relay accepts only the lab origin and `/sessions/` subtree,
forwards no credentials to other origins, and was stopped after testing. The
production browser plan is unchanged; changing its origin is correctly refused
by the shared media-plan validator.

An 18-second media-request hold drained about seven seconds of buffered media.
Native position stayed at 77.843782375 while buffering for about twelve seconds,
then resumed at 77.867600665. Source/seek generations stayed at 1, all snapshots
reported speed 1, and AVPlayer rate was 1.0 before and after. No automatic live
edge jump occurred. The recovered native picture was captured. The server
confirmed the test session was already gone during final cleanup.

All test Electron/HTTP relay processes were stopped. The final package rebuild
includes the tested native/document fullscreen exit synchronization.

Dolby Vision metadata preservation and E-AC-3/JOC passthrough depend on the
AVFoundation path and output route; neither Dolby Vision panel output nor Atmos
receiver acceptance has been demonstrated on this Mac. Aether's current
macOS display-criteria implementation does not switch display modes.

## Styled ASS through libass (2026-11-23)

Fixture: a 30-second 1280x720 H.264 MKV whose ASS track has a `\pos`+`\frz` sign in Permanent
Marker (attached to the MKV only, not installed on the Mac), a BorderStyle 3 box, `\an9`+`\frx`,
`\move` with `\blur`, `\k` karaoke, `\frz-90`, inline italic/colour/underline and a Hebrew+Arabic
line, served by the mock as the session's original (`/__admin/original`, `selectSubtitle`).

- Vela 0.2.50's published Mac app (unchanged payload) draws the cues as plain white text stacked at
  the bottom: no positions, fonts, colours or karaoke. Its `libVelaNative.dylib` links neither
  libass nor FriBidi.
- The same app with this branch's `native-mac` payload logs
  `[vela-captions] libass track=2 codec=ass header=892 fonts=1` and draws every event as authored:
  the attachment's font, positions, rotations, the box, the karaoke sweep and the `\move`
  advancing between captures, and the right-to-left line shaped (FriBidi, Core Text fallback).
- The Mac captures are in-process renders of the native view's layer tree (the agent shell has no
  Screen Recording permission, and the window server returns blank frames for Electron windows
  without it), so they show the caption layers without the video beneath.
- tvOS 27.0 (Apple TV 4K 1080p) and iOS 27.1 (iPhone Duo) simulators, Release arm64 builds of this
  branch against the same mock, draw the staggered fixture as authored over the picture: all eight
  events, the attachment's font, karaoke and `\move` where their timing puts them (tvOS at 0:18.8,
  iOS at 0:22.8). Those platforms already had libass before this branch.
- AetherEngine 7.70.0 delivers at most three cues sharing an identical start and end time: with
  seven events on 0:00-0:30 (plus karaoke on 0:00-0:04) only three of the seven reached the
  renderer, on 0.2.50's plain text as well. Staggering the starts delivered all of them. Typeset
  signs built from several same-timed layers lose layers until that is fixed upstream.
- Not observed: Developer ID signed and notarized packaging of the new payload (the frameworks
  sign with the Developer ID and hardened runtime and pass strict verification on their own).
