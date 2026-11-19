# macOS native playback verification

2026-11-19, Apple silicon, macOS 26.6.2. All runs use a scratch Electron copy
and separate user data. The owner's installed application is untouched.

## Verified so far

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
  input and final release behavior still require a follow-up check.

## Pending

Fall HEVC PQ EDR output, two-audio switching, live induced-stall recovery, final
signed/notarized package checks. The fresh Mac session advertised HDR10/HLG but
Ether selected its cached 1920x960 H.264 SDR Fall release. The coordinator has
applied an authorized temporary lab-only Asmo HEVC PQ pin; prior state was no
pins and must be restored after proof. Do not treat EDR potential=16 alone as
HDR playback evidence.

Dolby Vision metadata preservation and E-AC-3/JOC passthrough depend on the
AVFoundation path and output route; neither Dolby Vision panel output nor Atmos
receiver acceptance has been demonstrated on this Mac. Aether's current
macOS display-criteria implementation does not switch display modes.
