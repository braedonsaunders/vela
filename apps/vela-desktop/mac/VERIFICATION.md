# macOS native playback verification

2026-11-19, Apple silicon, macOS 26.6.2. Runs used a scratch Electron copy followed by the Developer ID signed,
notarized app, always with separate user data. The owner's installed application is untouched.

## Verified

- Workspace typecheck passes after installing frozen workspace/mock-server dependencies.
- Integrated Bun run: 677 passing, one Android/JVM test skipped. Additional
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
  returns the window to its normal bounds; the completed DOM transition still
  needs a follow-up assertion.

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

## Server selection and pending QA

The fresh Mac session advertised HDR10/HLG but Ether selected its cached
1920x960 H.264 SDR Fall release. The authorized lab-only Asmo pin enabled the
HDR proof. The coordinator confirmed restoration to the original empty pin
list after each run. No production configuration changed.

Mac live TV with an induced network stall and the completed native Escape/DOM
transition assertion remain pending. A local relay is prepared for the live
check; its initial preparing-plan handling is test setup, not a native playback
failure. Native runtime testing pauses when host memory pressure escalates.

Dolby Vision metadata preservation and E-AC-3/JOC passthrough depend on the
AVFoundation path and output route; neither Dolby Vision panel output nor Atmos
receiver acceptance has been demonstrated on this Mac. Aether's current
macOS display-criteria implementation does not switch display modes.
