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
