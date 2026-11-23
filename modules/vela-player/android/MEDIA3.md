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

Full-screen TV matching asks for an exact display mode: the same resolution
with the fewest refreshes per frame (23.976 fps takes 23.976 Hz or 47.952 Hz,
never 24 Hz; 25 takes 50; 29.97 takes 59.94), through
WindowManager.LayoutParams.preferredDisplayModeId, and hints the surface with
Surface.setFrameRate(CHANGE_FRAME_RATE_ALWAYS). HDMI refresh changes are never
seamless, so the previous CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS request (also
Android 11's default) never switched a TV. On Android 12+ the viewer's Match
content frame rate setting decides: Never and Seamless only keep the mode; on
Android 11 (Shield) Vela switches, as Kodi and Plex do. A mode that already shows
every frame evenly is kept, and the request is cleared when playback stops.
Phones get a seamless-only hint. Previews and multiview tiles never touch the
display, and disable Media3's own frame-rate hints, audio tracks, audio focus,
screen-on and observations. The Expo view applies ambient policy before
plans/commands regardless of prop order. Guide browse/tune rules remain in the
shared app controller.

## Audio

Full-screen playback enables Media3's float output. Without it DefaultAudioSink
converted every high-resolution PCM stream to 16 bits (ToInt16PcmAudioProcessor),
so 24-bit FLAC/ALAC and FFmpeg-decoded TrueHD and DTS-HD MA were not lossless.
Float PCM carries 24-bit samples exactly; speed control (unused, fixed at 1) is
what float output gives up.

Bitstream passthrough is Media3's own: MediaCodecAudioRenderer sends AC-3,
E-AC-3, E-AC-3 JOC (Atmos), TrueHD (Atmos objects intact), DTS, DTS-HD and DTS:X
(DTS UHD P2) unchanged whenever AudioCapabilities lists the encoding for the
routed device (Android 13+ TVs: AudioManager direct profiles; older TVs: the HDMI
plug intent's EDID list). Otherwise the FFmpeg extension decodes to multichannel
float PCM: TrueHD to its 7.1 bed (objects are lost), DTS-HD MA losslessly
through FFmpeg's XLL decoder (DTS:X objects are lost; the 7.1 bed remains), DTS
core, E-AC-3 and AC-3. Android exposes no app-level Dolby MAT packing: a HAL
that takes ENCODING_DOLBY_TRUEHD (Shield) wraps it in MAT itself, which is why
Snapshot.format leaves `carrier` unset. Media3 skips IEC 61937 encapsulation, so
a device whose HAL lacks the TrueHD/DTS-HD encodings but accepts raw IEC 61937
(several Fire TV and Amlogic boxes) decodes instead; an IEC 61937 packer is
future work.

`ClientCapabilities.audioOutput` is the same AudioCapabilities answer for the
routed device at negotiation time: passthrough tokens, the device's channel
count (EDID for HDMI), its highest rate, and `lossless` when TrueHD passes
through or float PCM reaches 8 channels. A mid-title route change falls back to
decoding.

## Dolby Vision

Media3 gives Dolby Vision Profile 7 (UHD Blu-ray: an HDR10 base layer plus an
enhancement layer and RPU in one HEVC track) no fallback decoder
(MediaCodecUtil.getAlternativeCodecMimeType skips DvheDtb), so a device without
a Profile 7 decoder refused the video and fell into a server transcode. An
extractor tap (SampleTap.kt) now handles a Profile 7 track before decoding:

- a Profile 7 Dolby Vision decoder: unchanged;
- a Profile 8 decoder: each RPU is converted to 8.1 by libdovi (dovi_tool's
  dolby_vision 3.4.0, mode 2: no-op mapping curves, as `dovi_tool -m 2` and the
  Apple player do), the enhancement layer's NAL units (type 63) are dropped and
  the track is declared `dvhe.08`;
- otherwise: RPU and enhancement layer are dropped and the HDR10 base layer
  plays as HEVC Main 10.

Profiles 5, 8 and 10 are untouched: a Dolby Vision decoder takes them, and
Media3 falls back to the HEVC/AV1 base layer for 8 and 10 itself. Capabilities
list `dolbyVisionProfiles` only where the display reports Dolby Vision; `7` is
listed when the conversion library loaded and a Profile 8 decoder exists.
Build libdovi with `modules/vela-player/android/dovi/build.sh` (pinned source,
private Rust toolchain, output under ~/.scratch) before Gradle.

HDR10+ is declared where the display reports HDR10+ and a decoder names an
HDR10+ profile; the SEI/metadata reaches MediaCodec unchanged. HDR-to-SDR tone
mapping is the platform's (MediaCodec or SurfaceFlinger) when the display cannot
show HDR; Vela adds none.

## Info card and diagnostics

Snapshot.format (modules/vela-player/web/engine/format-info.ts) comes from what
Media3 reports: the video and audio input formats, the initialized decoders
(hardware or software, and whether the video decoder is a Dolby Vision decoder),
the AudioTrack it opened (passthrough encoding or PCM, channels, rate) and the
routed device. TrueHD Atmos is read from the stream's major sync (four
substreams with the 16-channel presentation flag). The route's channel and rate
limits mark Android's own downmix/resample. Logcat tag `vela-media3` records the
Dolby Vision decoder profiles and conversion availability per engine, each
input/output format and every change of Snapshot.format.

## Subtitles

The CC menu's size, colour, background and position apply to text cues and are
kept in the app's preferences. ASS/SSA is Media3's SsaParser: colours, italics,
bold, alignment and \pos placement survive; fonts, outlines, karaoke and
animated tags do not (libass is future work). PGS, VobSub and DVB are Media3
bitmap cues.

## Containers

Media3 demuxes MKV/WebM, MP4/MOV, MPEG-TS (188-byte), MPEG-PS, AVI, Ogg and
FLV. Blu-ray M2TS is not declared (`m2ts`): Media3 reads 188-byte packets only
and has no readers for HDMV LPCM, TrueHD, PGS or VC-1 in TS, and parses 0x86
(DTS-HD MA) as SCTE-35.

## Licensing

Shipped native code: Media3 (Apache-2.0), FFmpeg 6.0.1 audio decoders built with
GPL, nonfree and version3 disabled (LGPL-2.1, relinkable from the pinned source
and build script), and libdovi (MIT) with its Rust dependencies (MIT/Apache-2.0,
used under MIT). Their texts are in assets/vela-licenses. Passthrough sends Dolby
and DTS bitstreams unchanged; decoding them uses FFmpeg's independent decoders,
not licensed Dolby or DTS implementations, and patent licensing for that use is
the distributor's responsibility where patents remain. Dolby Vision processing is
done by the device's own licensed decoder; libdovi only rewrites RPU metadata.

## Verification

The production PathRecovery, grant scope and HTTP DataSource can run on a stock
JVM with the small platform boundary stubs in test/fixtures/android. Set
VELA_KOTLINC to a Kotlin compiler launcher and VELA_KOTLIN_STDLIB to its runtime
jar, then run `bun test modules/vela-player/test/android-native.test.ts`.
These tests ran successfully on bb-worker-server; device verification is tracked
separately and must be recorded before claiming playback parity.

Capability declarations use actual MediaCodec profiles and supported resolution
pairs. The server receives its existing `maxWidth`, `maxHeight`, codec-name and
HDR fields. HDR is the intersection of the display's HDR types and compatible
hardware decoder profiles. Full profile/level and frame-rate details are available
through the internal `decoderCapabilities` diagnostic function; no new v0 wire
field is invented. An emulator without hardware AVC can declare bounded software
AVC, labelled as software in diagnostics, without declaring software HEVC/HDR.

For external subtitles, `delivery.format` takes precedence over the original
source codec: a converted WebVTT delivery is parsed as WebVTT even when the source
was SRT or bitmap subtitles. Static sidecars work on original files, HLS and DASH,
including initial selection and turning them off. Raw external SUP/IDX/SUB is a
remaining limitation: Media3 needs packet timing/IDX palette initialization that
the single-URL external delivery does not carry. Such selections use the existing
server `tracks` command for a supported delivery or burn-in path; they are never
fed into an uninitialized bitmap parser. Embedded PGS/VobSub uses the initialization
data extracted from its container and Media3's bitmap cue output.
