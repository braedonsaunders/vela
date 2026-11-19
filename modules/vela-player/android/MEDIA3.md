# Android playback

Android phone, tablet and TV use AndroidX Media3 ExoPlayer 1.11.1 exclusively
(the stable release on 2026-11-18). Desktop mpv hosts are unchanged.

`PlaybackEngine` isolates the native controller from ExoPlayer. Each main player
and preview owns a separate engine. Full-screen video goes directly from
MediaCodec to a SurfaceView, preserving HDR metadata; no intermediate SDR GL
surface is used. Media3's default audio sink monitors the connected sink's audio
capabilities and selects supported HDMI encoded output, with the FFmpeg audio
renderer used only when platform audio decoding/passthrough cannot handle it.
TV tunneling is enabled through DefaultTrackSelector and used when compatible
renderers/tracks support it. Neither HDMI format support nor actual HDR display
output can be established on an emulator.

The Media3 FFmpeg audio extension is built from the upstream 1.11.1 module
(commit 8c6678b657ede1e7883fc164ef73ed483c7796c3), with FFmpeg n6.0.1
(commit c41ff724ede7da657762d61097e26fac296c53bf). Run
`modules/vela-player/android/ffmpeg/build.sh` on the Android build host before
`tools/android-release.sh`. All fetched source, static archives and build output
live under ~/.scratch. The script disables GPL, nonfree and version3 components,
selects audio decoders only and builds the JNI wrapper from upstream source.
The APK includes the Apache-2.0 and LGPL-2.1 texts under assets/vela-licenses.
The build script and pinned upstream source permit rebuilding/relinking the
extension; no third-party prebuilt FFmpeg artifact or libmpv is used.

The scoped DataSource captures a grant per engine. Every request (including
manifest, segment, subtitle and seek requests) checks its origin and normalized
path. Redirects are followed manually with a bounded hop count; leaving scope
permanently drops headers for that chain. DataSpec headers do not bypass the
grant. Platform HTTP error messages are replaced with credential-free messages.

PathRecovery uses only plan-advertised paths and existing generation-aware
`switch` and `prepare-fallback` session commands. Attempts are bounded per
session, prefer transcodes, and preserve the current position. The historical
`mpv-sub-` client-only subtitle identifier is a wire spelling, not an engine.
Media3 text and bitmap cues render in the Vela view's subtitle overlay. Embedded
and external tracks are selected through track overrides without reloading the
media item.

Full-screen TV matching sends Surface.setFrameRate with
CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS, leaving the system matching preference in
control. Previews disable Media3's own frame-rate hints, audio tracks, audio
focus, screen-on and observations. The Expo view applies ambient policy before
plans/commands regardless of prop order. Guide browse/tune rules remain in the
shared app controller.

## Verification

The production PathRecovery, grant scope and HTTP DataSource can run on a stock
JVM with the small platform boundary stubs in test/fixtures/android. Set
VELA_KOTLINC to a Kotlin compiler launcher and VELA_KOTLIN_STDLIB to its runtime
jar, then run `bun test modules/vela-player/test/android-native.test.ts`.
These tests ran successfully on bb-worker-server; device verification is tracked
separately and must be recorded before claiming playback parity.
