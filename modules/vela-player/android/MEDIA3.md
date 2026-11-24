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
extension; no third-party prebuilt FFmpeg artifact or libmpv is used. Gradle
also requires `dovi/build.sh` (libdovi, Rust, private toolchain) and
`ass/build.sh` (libass and its dependencies, meson/ninja) to have run for each
requested ABI; both keep their pinned source and output under ~/.scratch.

The scoped DataSource captures a grant per engine. Every request (including
manifest, segment, subtitle and seek requests) checks its origin and normalized
path. Redirects are followed manually with a bounded hop count; leaving scope
permanently drops headers for that chain. DataSpec headers do not bypass the
grant. Platform HTTP error messages are replaced with credential-free messages.

PathRecovery uses only plan-advertised paths and existing generation-aware
`switch` and `prepare-fallback` session commands. Attempts are bounded per
session, prefer transcodes, and preserve the current position. The historical
`mpv-sub-` client-only subtitle identifier is a wire spelling, not an engine.

Live timeshift (pause, rewind, back to live) is local, as on Apple. A live plan's
snapshot `live` block reads the current Timeline window on Media3's window time,
which is also `position`: start 0, edge the window's duration, latency the live
configuration's resolved target offset (else 6 s), segment the HLS target
duration; `duration` is null. Live `seek`/`seekBy` clamp into [0, edge - 1 s] and
never become a server session command; `catchUp` seeks to the edge less the
latency. Resuming a pause the window slid past lands 5 s inside its start; an
expired window that fails with BehindLiveWindowException restarts near its start
and keeps the pause. A start-over plan (`live.mode == "startOver"`) loads at its
plan position instead of the live edge.
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
Float PCM carries 24-bit samples exactly. Media3's own speed processor (Sonic)
takes 16-bit PCM only, so playback speed (0.5–2×, pitch kept) is applied at the
AudioTrack (`setEnableAudioOutputPlaybackParameters`), which time-stretches float
PCM too. A bitstream for the receiver plays at 1×: its AudioTrack is never asked
for another speed, and the player offers no speeds while one is out. A TV turns
tunneling off while the speed is not 1×. Live plays at 1×.

The viewer's `outputPreference` choices (OutputPreferences.kt, kept per device)
are `passthrough` (`auto`, or `off`: the audio sink's output provider reports no
encoded format, so every track is decoded on the device) and `dolbyVision`
(`base-layer` plays the HDR10/HLG base of Profiles 7 and 8). A change reloads the
playing title where it is. Android renders no Atmos objects itself, so it offers
no immersive or speaker-layout choice.

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

## Subtitle delay and picture-in-picture

`subtitleOffset` (the CC menu's delay, ±600 s, never stored) runs Media3's text
renderer behind the playback clock (SubtitleDelay.kt), so text and bitmap cues
(PGS, VobSub, DVB) move alike; libass draws ASS/SSA at the shifted time. The
renderer drops cues once they pass, so its stream keeps the cue samples it handed
over (ten minutes, 32 MB) and a change of delay replays the ones still on at the
new position: the cue moves at once, paused or playing, without a seek.

Phones and tablets show the full-screen player in the activity's own
picture-in-picture window (PictureInPicture.kt; the manifest comes from
apps/vela/plugins/android-picture-in-picture.js): the player's button, or Home
while playing (auto-enter on Android 12+, the user-leave hint before). The
picture moves above the app for the window, which takes the video's ratio and a
play/pause action. Closing the window pauses, and the watch route stops the
session as it does when the app leaves the foreground. Android TV never offers it.

### IEC 61937 (not built)

Some Android TV HALs (Fire TV, many Amlogic boxes) list TrueHD or DTS-HD only as
IEC 61937 encapsulated profiles (Android 13+ `AudioProfile.getEncapsulationType()`
`AUDIO_ENCAPSULATION_TYPE_IEC61937`), which Media3's AudioCapabilities skips, so
those devices decode TrueHD to PCM (bed only) today. The missing piece is an
AudioSink beside DefaultAudioSink that, for such a profile, packs the bitstream
the way FFmpeg's spdif muxer (libavformat/spdifenc.c, LGPL) does: TrueHD into
MAT frames (24 access units per 61,440-byte burst, Pc 22) and DTS-HD MA into type
IV bursts (Pc 17), written to an `ENCODING_IEC61937` AudioTrack at 8 channels,
192 kHz, with position and pause/flush handling. It needs such a device and an
AV receiver to verify, so it is not built blind.

## Music, audiobooks and podcasts; the media session

`AudioPlayback` is the app's one audio player (modules/vela-player/src/audio.ts):
an ExoPlayer with the platform decoders first and the FFmpeg extension for the
rest (ALAC; Opus, Vorbis and FLAC where MediaCodec lacks them), audio focus,
becoming-noisy (headphones out pauses) and a network wake lock. It does not use
float output: DefaultAudioSink applies speed only in integer PCM (Sonic), and
speed with the pitch kept is what audiobooks need, so 24-bit sources reach the
AudioTrack as 16-bit. Requests go through `ScopedMediaDataSource` with the load's
own grant (Jellyfin, Emby and Plex headers; none for Ether).

`VelaAudioService` is a Media3 `MediaSessionService` (foreground type
`mediaPlayback`, bound by the module on first use) hosting the app's one
`MediaSession`: the media notification, lock screen, Bluetooth and headset buttons,
Android TV's Now Playing, Android Auto and the Assistant. `MediaSessionHub` shows
the player that owns it: the audio player, or the full-screen video player (never a
preview or a multiview tile), the last to claim winning. The session sees a
`SessionPlayer` (a `ForwardingSimpleBasePlayer`) with the owner's metadata and
commands; every system command goes to the owner instead of the player: the audio
player hands them to JavaScript (the store's queue, as the browser's Media Session
handlers do), the video controller runs them as `command` props. Music offers
previous and next, spoken word 15/30-second skips, video 10-second skips. Media3
keeps the service in the foreground for ten minutes after a pause, and the audio
player keeps an unloaded item, paused, for 15 s while the next one loads, so a queue moves on
from the background without a refused foreground start; only an unload with no
load after it empties the player, and the notification goes with it
(`SHOW_NOTIFICATION_FOR_IDLE_PLAYER_NEVER`). The release build needs the Play
Console foreground-service declaration for media playback; media notifications
need no POST_NOTIFICATIONS prompt.

### Gapless

The store hands the next queue item to the player before the current one ends
(`audioPreload`): it waits behind the current MediaItem in ExoPlayer's playlist, so
the player moves on with no gap, trimming the delay and padding the file declares
(the LAME header, iTunSMPB, an MP4 edit list). `onMediaItemTransition` (auto) sends
`advanced` with the new item's id and drops the finished item; an item that resumes
part-way is not queued (JavaScript loads it). MP3 always decodes in the FFmpeg
extension: Media3 trims the LAME delay plus the 529 samples of FFmpeg's decoder
delay, but MediaCodec's MP3 decoder drops those itself, so with it every track lost
its first 12 ms and ended on 12 ms of padding.

Measured on the mock's gapless test albums with a temporary tee of the PCM fed to
the AudioTrack (API 34 emulator, one AudioTrack across every join): FLAC bit-exact,
MP3 0 samples at every join. AAC in an ffmpeg-muxed M4A ends on 630-1019 samples of
padding per track: ffmpeg marks the end by shortening the last sample's duration and
`BoxParser` computes the padding from the summed durations, so it finds none. Files
with iTunSMPB or a padded edit list are trimmed; the ffmpeg case needs Media3 to
derive padding from the last sample's duration, or a Vela-side trim to the edited
duration. Media3's `WavFileAudioBufferSink` splits its file at every item change even
when playback is seamless (the sink drains and reconfigures there); measure with a
single-file tee.

### Sound: levelling, EQ and AutoMix

Each audio ExoPlayer's DefaultAudioSink starts its processor chain with a
`VelaSoundProcessor` (VelaSound.kt), so it runs on decoded 16-bit (or float) PCM
at the file's rate, before Sonic. It applies the levelling gain, the EQ (the
pre-gain, then RBJ cookbook biquads in Direct Form I, double precision, exactly
as packages/core/src/audio/eq.ts computes them) and AutoMix's equal-power fades.
A levelling or EQ change glides over 10 ms (an EQ change runs the old and new
filters side by side, the new one starting from the old one's history).

Per-item gain across a gapless join is sample-exact, with no timing guess: every
renderer moves the sink to the next item's stream offset after the last buffer of
one item and before the first of the next, and the sink then drains and flushes
its processors. `VelaSoundSink` (a ForwardingAudioSink) passes the offset change
on, and the processor switches to the next item's gain at that flush. Offsets map
to items in playlist order (`audioPreload` tells the processor which id follows
which), and an offset seen again (a seek back into an earlier stream) maps back.

A crossfade (`audioPreload` with `crossfade`) prepares a second deck (an
ExoPlayer with its own processor) with the incoming item, paused. Two seconds
before `at`, once that deck is ready, the outgoing processor gets its fade-out,
on its own samples from `at` (later only if it has already passed it); the
incoming processor fades in from the item's first sample. The only timed step is
the incoming deck's `play()`: posted on the main thread against the outgoing
sink's heard position (its last `getCurrentPositionUs`, extrapolated; ExoPlayer's
`currentPosition` lags the playback thread), less the time a prepared deck takes
from `play()` to its first sample heard. That lead starts at 80 ms and is learnt
from every crossfade that plays through. The incoming deck becomes the active
player at once (`advanced`, status events, the media session); the outgoing one
keeps the audio focus while it fades, then stops and is kept as the spare deck,
and the incoming one takes the focus. A pause, a seek, a load or a focus loss
during the fade ends it.

Measured on the API 34 emulator with the debug capture (`audioCapture`: each
processor's output to a WAV, silence to the device): gain error under 0.001 dB,
the gapless gain switch on the boundary sample, the EQ within 0.003 dB of the
expected response from 31 Hz to 16 kHz, glides of 10 ms with no overshoot, and
crossfades starting 8 ms early to 15 ms late (the emulator's mixer starts a track
on its ~22.7 ms cycle), with the summed power within 0.02 dB. Only the MediaCodec
renderer was measured; the FFmpeg renderer (MP3, ALAC) signals the offset change
the same way, but that path was not captured.

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

ASS/SSA in Matroska is drawn by libass 0.17.5 (with HarfBuzz shaping, FriBidi
and FreeType), so positioning, rotation, movement, borders, shadows, karaoke and
fades render as authored. Subtitle transcoding runs after the extractor tap, so
the tap hands libass each raw event with its absolute time while Media3 still
builds its own cues; for the selected ASS track those cues are suppressed and
the overlay (AssOverlay) draws libass frames on every display frame, timed to the
video frame on screen (VideoFrameMetadataListener) rather than the audio clock.
Android has no font provider for libass. Fonts attached to the Matroska file
(found through the SeekHead or before the first Cluster, read with one ranged
request through the same scoped grant when the first ASS track appears) and
fonts embedded in the script are used by family name; every other family falls
back to Roboto (Noto Sans CJK for Chinese, Japanese or Korean system languages). If the
library is missing, Media3's SsaParser cues are shown instead (colours, italics,
bold, alignment and placement only). Build libass with
`modules/vela-player/android/ass/build.sh` (pinned sources, meson/ninja) before
Gradle.

The CC menu's size, colour, background and position apply to text cues (SRT,
WebVTT, TTML and Media3's SSA fallback) and are kept in the app's preferences;
an ASS track keeps its own styling. PGS, VobSub and DVB are Media3 bitmap cues.

## Containers

Media3 demuxes MKV/WebM, MP4/MOV, MPEG-TS (188-byte), MPEG-PS, AVI, Ogg and
FLV. Blu-ray M2TS is not declared (`m2ts`): Media3 reads 188-byte packets only
and has no readers for HDMV LPCM, TrueHD, PGS or VC-1 in TS, and parses 0x86
(DTS-HD MA) as SCTE-35.

## Licensing

Shipped native code: Media3 (Apache-2.0), FFmpeg 6.0.1 audio decoders built with
GPL, nonfree and version3 disabled (LGPL-2.1, relinkable from the pinned source
and build script), and libdovi (MIT) with its Rust dependencies (MIT/Apache-2.0,
used under MIT), libass (ISC), HarfBuzz (MIT), FreeType (FreeType License) and
FriBidi (LGPL-2.1, static, relinkable from the pinned source and ass/build.sh).
Their texts are in assets/vela-licenses. Passthrough sends Dolby
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
