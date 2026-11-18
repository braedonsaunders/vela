# Apple playback

Vela's Apple player uses AetherEngine 7.70.0 first, with MPVKit 1.0.0's LGPL
product retained as a load-error fallback. Both use the same native view,
PlayerState and PlayerReport, so JavaScript commands and Ether observations
keep their existing shapes. The snapshot backend identifies the active engine.

The pod uses React Native's `spm_dependency` to compile AetherEngine. The Expo
`apple-player` plugin links FFmpegBuild 3.15.0's dynamic products into the app.
The static pod already contains the engine and libdovi; linking the engine
again duplicates its symbols. SwiftPM copies the engine resource bundle.
The app puts AetherLib* before inherited MPVKit flags so the engine resolves
its FFmpeg calls against the matching ABI. This avoids a
separate FFmpeg build and platform-specific binary distribution. Both the pod
and app pin the exact release, and both deployment targets are 18.0.

Only the AetherEngine product is linked. Optional package traits and GPL
products are not enabled. FFmpegBuild ships prefixed dynamic AetherLib*
frameworks, separate from MPVKit's dynamic FFmpeg. Verify the engine's startup
FFmpeg version line and the executable's symbol bindings on device builds.

The engine owns display matching on its route. Vela's existing display matching
is used only after mpv fallback. Engine instances are retained for reuse across
loads; the muted hero preview has an independent instance. Detaching the view
cancels loading, removes subscriptions and stops playback.

## Distribution notices

AetherEngine: LGPL-3.0 with App Store exception, unmodified source at
https://github.com/superuser404notfound/AetherEngine/tree/7.70.0 .
FFmpegBuild: dynamically embedded LGPL FFmpeg and dependencies; source and
license texts at https://github.com/superuser404notfound/FFmpegBuild .
LibDovi: MIT, including quietvoid and contributors' notice.
Anime4K: MIT, Copyright (c) 2019-2021 bloc97.

The upstream license texts and dependency notices ship in the
VelaPlayerLicenses resource bundle. The existing MPVKit notices still apply
to the fallback.

## Device verification

The Basement Apple TV has played Camp Crystal through the loopback AVPlayerLayer
route with Vela's play/pause and ten-second seeks. The owner reported that the
picture may look better. A framebuffer at 2436.6 seconds tracked the source
levels: 20 to 19, 52 to 52, 68 to 66 (the previous mpv route lifted 20 to 27).
No colour compensation is applied.

Fall's 4K source has also played on the Basement TV. The native ready log reports
`route=loopback format=hdr10 audio=bridged AVPlayerLayer=true`. This display
reports HDR10 support and no Dolby Vision support. TrueHD uses the audio bridge;
this check does not establish TrueHD Atmos object delivery or Dolby Vision output.

The iPhone Release build compiled and installed. Full-app playback still needs a
runtime check while the phone is available. Its initial launch hang also occurred
in the pre-Aether baseline: lab-pinned builds rejected saved standalone Ether
records. Shared session restoration now preserves those records and bounds startup.
The TV resumed playback after that fix. Track switching, hero previews and a
source refused by Aether still need device verification.

Fallback carries the current pause, mute and volume settings. A native ready log
records the route, video format, audio delivery and AVPlayerLayer presence without
logging the media URL or its authorization.
