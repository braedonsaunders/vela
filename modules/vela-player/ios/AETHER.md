# Apple playback

Vela's tvOS and iOS apps use AetherEngine 7.70.0 exclusively. AVPlayer and
software decoding are routes inside that engine. No MPVKit, libmpv, MoltenVK,
libplacebo or mpv-only libraries are linked or bundled on Apple mobile
platforms; libass is Vela's own subtitle renderer (Subtitles, below). The macOS Electron host reuses these playback sources through an AppKit rendering
adapter (macOS 15+, Apple silicon). Linux and Windows retain their own mpv
implementations. See `apps/vela-desktop/NATIVE_PLAYER.md` for the IPC contract.

The pod compiles only the AetherEngine product, with no optional traits or GPL
products. The Expo apple-player plugin pins its LGPL FFmpegBuild dependency to
3.15.0. Aether's own dynamic AetherLib frameworks supply FFmpeg; there is no
second provider or static FFmpeg symbol override. Deployment targets are 18.0.

## Audio and picture delivery

Full-screen loads take the viewer's choices from `PlaybackPreferences` (the player's Audio menu,
"Sound and picture"; kept in UserDefaults, applied to the playing title with
`reloadAtCurrentPosition(applying:)`). Previews and multiview tiles keep the engine's defaults.

| Setting | Default | Engine option |
| --- | --- | --- |
| Surround: Lossless PCM / Dolby Digital Plus (ARC soundbar) | Lossless | `audioBridgeMode = .lossless` / `.surroundCompat` |
| Atmos from TrueHD and DTS:X: On / Off | On | `objectAudioRendering = .render(layout)` / `.off` |
| Speakers: 5.1.2, 5.1.4, 7.1.2, 7.1.4, 9.1.6 | 7.1.4 | the rendered bed's `SpatialSpeakerLayout` |
| Dolby Vision: Automatic / HDR10 base layer | Automatic | `dolbyVisionHandling = .automatic` / `.baseLayerOnly` |

Before this, Vela left Aether's default `.surroundCompat`: TrueHD, DTS-HD MA and PCM above two
channels left as 768 kbit/s E-AC-3 5.1. Lossless is bit-perfect FLAC up to 7.1 at the source rate,
decoded to LPCM by the system. It needs an AVR over HDMI or an eARC receiver or soundbar; behind
legacy ARC tvOS downmixes LPCM to stereo, which is what the Dolby Digital Plus choice is for. Aether
cannot tell the two apart (AE#794: with Continuous Audio Connection every HDMI route reports 32
channels).

**TrueHD Atmos and Dolby MAT.** tvOS gives apps no compressed or IEC 61937 output: a TrueHD
bitstream cannot be wrapped in MAT and passed through, by any app. tvOS itself produces Dolby MAT 2.0
on HDMI, from E-AC-3 JOC played by AVPlayer (stream-copied unchanged, the receiver shows Atmos) or
from multichannel PCM or APAC in an Atmos speaker layout. Aether's object route decodes a TrueHD
track's channel and object presentations (LibTrueHD), renders the objects into the chosen bed with
heights and hands it to the system as 24-bit PCM (APAC over AirPlay); tvOS carries it to the receiver
as Dolby MAT, and Aether loops a silent E-AC-3 Atmos stream beside it so soundbars switch to Atmos.
Objects reach the receiver as that fixed bed, not as objects: the most any tvOS app can deliver. This
is a decode and render of the stream, not a re-encode by Vela and not a Dolby MAT encoder (the MAT
framing is tvOS's own). DTS:X heights take the same route through FFmpeg's `dca` decoder; tvOS has no
DTS output, so the receiver shows Dolby Atmos for them. It needs tvOS/iOS 26 and 48 kHz sources;
anything else, or a failure to start, plays the lossless channel presentation.

**Dolby Vision.** Profiles 5, 8.1 and 8.4 play natively. Profile 7 (MEL and FEL) is converted to 8.1
per packet with libdovi; with the `DolbyVisionFelCurves` trait a FEL enhancement layer's luma residual
is folded into the 8.1 RPU so the platform decoder applies it. The `DualLayerDolbyVision` composer is
not built: it evaluates MMR prediction covered by live Dolby patents, and on its software route an
E-AC-3 JOC track loses its objects. HDR10+ SEI is kept to the display; HLG and HDR10 are native. A
display without Dolby Vision presenting HDR shows the HDR10 base layer; Profile 5 is composed by
AVPlayer everywhere.

**Optional components.** `apps/vela/plugins/apple-player.js` gives the Pods project's AetherEngine
reference the `TrueHDObjectAudio`, `DTSXObjectAudio` and `DolbyVisionFelCurves` traits in a Podfile
`post_integrate` hook (React Native's `spm_dependency` cannot name traits and CocoaPods' project model
drops the key) and pins LibTrueHD 3.2.0 exactly; the macOS host's generated Package.swift names the
same traits. `AetherEngine.OptionalComponent` hides a setting a build cannot honour.

**Licensing.** LibTrueHD is MIT and compiles in the truehdd `truehd` and `oamd` crates (Apache-2.0);
both texts and its NOTICE ship in VelaPlayerLicenses. DTS:X decoding is FFmpeg's (LGPL). No Dolby or
DTS encoder is involved. The TrueHD object decoder is an independent implementation, not Dolby's;
Aether notes that these components may be subject to third-party patent licensing, which falls to the
integrator. The owner approved enabling them on 2026-11-22.

**Info card.** `PlaybackFormat` reports what Aether (`sourceVideo*`, `sourceDVProfile`,
`dolbyVisionConversion`, `videoFormat`, `activeVideoDecoder`, the active `TrackInfo`, `audioDelivery`,
`LiveTelemetry.objectAudio`), `AVAudioSession` (route, `renderingMode`) and `AVDisplayManager`
(matching enabled, criteria requested, switching) say, as `Snapshot.format`; a `[vela-format]` line logs
it without URLs. Dolby MAT is named only when the system's rendering mode is Dolby Atmos on HDMI.

**Capabilities.** `PlayerCapabilities` declares hardware video codecs for server HLS, software
decoders for original files (AV1 only in hardware: every Apple TV decodes it in software, too slow
for 4K), `hdr10+` beside `hdr10`, `dolbyVisionProfiles` 5/7/8.1/8.4 on a Dolby Vision display (else
`dolbyVisionReshape` for what AVPlayer composes) and `audioOutput`: Dolby passthrough and E-AC-3 JOC,
`truehd-atmos`/`dtsx` while rendering is on, and `lossless` while surround is lossless.

**Subtitles.** ASS/SSA tracks are drawn as authored by libass 0.17.5 (positions, styles, colours,
outlines, rotation, karaoke and the container's embedded fonts, through Core Text for system fonts)
on tvOS, iOS and the macOS desktop host alike: loads set `preserveASSMarkup`, and `ASSSubtitles` feeds
the raw event lines, the track's header and `fontAttachments` to libass, and the platform's rendering
(`UIKitPlaybackRendering`, `AppKitPlaybackRendering`) lays its bitmaps over the picture at its pixel
size (at most 1920 wide). `modules/vela-player/ios/ass/build.sh` builds `Libass.xcframework` (libass
with FreeType and HarfBuzz, ISC/FTL/MIT) and `Fribidi.xcframework` (LGPL-2.1, a separate replaceable
dynamic framework) for tvOS, iOS (device and simulator) and macOS, from pinned, checksummed sources,
stripped and signed ad hoc with the hardened runtime. `tools/apple-tv.sh`, `tools/ios.sh`,
`tools/testflight.sh` and `apps/vela-desktop/mac/build.mjs` run it when `build.sh --check` says the
build is missing or was made by another version of the script; the podspec vendors the result and
bundles its licences, and the Mac host links it as SwiftPM binary targets and ships the frameworks
beside `libVelaNative.dylib`. A build without them draws ASS as plain text (the macOS host up to
0.2.50 did). Simulator builds are arm64 only (the libass and LibDovi simulator
slices are). AetherEngine 7.70.0 delivers at most three cues that share an identical start and end
time (observed 2026-11-23 on macOS with plain text and libass alike), so a sign typeset as several
same-timed layers loses layers until that is fixed upstream; see
`apps/vela-desktop/mac/VERIFICATION.md`. Other text
formats (SRT, WebVTT, mov_text, teletext) keep their bold, italic, underline, strike-through and colour
runs and ASS `\an`/`\pos` placement, sized against the picture in the viewer's subtitle appearance
(size, shadow or box, white or yellow, bottom or raised; kept per device). PGS, DVB, DVD and VobSub stay
Aether's bitmaps. The subtitle menu's delay (±10 minutes) shifts the overlay against the clock, and
`maximumSubtitleOffsetSeconds` follows it so the cues it reaches stay decoded.

**Speed, picture in picture and the background (2026-11-23).** The player offers the web's speeds,
0.5× to 2× (`PlayerReport.speeds`), through `AetherEngine.setRate`, pitch-preserving on every route
(Aether pins TimeDomain stretching); a speed carries across sources as on the web, and a live stream
reports no speeds and plays at 1× (`perform` refuses a speed on live). iOS, iPadOS and the macOS host
offer picture in picture (`PictureInPicture`): a controller around `nativePlayerLayer` on the native
routes or `softwarePiPSource` on the software route, rebuilt on every route or source change, setting
`pictureInPictureActive` from its delegate; on iOS it opens on its own when the app goes home while a
title plays (`canStartPictureInPictureAutomaticallyFromInline`). Previews and multiview tiles have none,
and Apple TV offers none (AVKit there does not present the software route, and Vela's chrome hides the
system affordance). The app's `UIBackgroundModes` `audio` key (the apple-player config plugin; a plain
Info.plist key, no entitlement or capability, so TestFlight and App Store need nothing more) keeps a
playing iPhone or iPad watch going behind the home screen: the native route keeps playing and the software
route drops to audio only (`[SWHost] background audio-only`), restoring the picture on return. iOS takes the
player view out of its window in the background, which `VelaPlayerView` no longer treats as leaving the
page, and the player's JavaScript keeps a playing iPhone or iPad session (`stopsInBackground`). Apple TV,
Android and a paused iPhone keep stopping the session as the app leaves and starting it again on return;
previews and tiles set `backgroundPlaybackEnabled = false`. The quality menu never offers Automatic here:
it is shown only for engines that pick HLS renditions themselves (`present.ts` `qualityAuto`); an HLS
rung the chrome offers maps to the server path of the same height (`VelaPlan.switchTarget`).

**Not available on Apple TV.** DTS bitstreaming (tvOS has no DTS output; DTS-HD MA decodes losslessly
to PCM, DTS:X heights render as above). Any compressed passthrough other than what AVPlayer forwards
for Dolby Digital and Dolby Digital Plus. Hardware AV1 (Apple TV 4K third generation decodes it in
software, so AV1 is not claimed to servers). Gapless album playback: AetherEngine has no queued
next-item path; a gap between tracks remains.

**Segment cache sizing (2026-11-22).** A 4K TrueHD Atmos remux on the Basement Apple TV filled the
volume (`storageExhausted`, ENOSPC) and the killed sessions left 2.7 GB in `tmp/aether-segments`, so not
even the production build could be reinstalled (0 bytes free). Every load now sets
`sessionCacheHardLimitBytes`, `sessionCacheByteBudget` and `sessionCacheFreeReserveBytes` from the space
free for the app (`volumeAvailableCapacityForImportantUsage` on iOS, purgeable included; tvOS only has
`volumeAvailableCapacity`, which leaves purgeable space out and so errs small) through
`PlaybackCacheBudget.plan`: 40% of free space, at most 2 GB, keeping 1 GB free; below 3 GB free the
reserve is a quarter of free space (at least 200 MB) and the cache keeps a 320 MB working floor so
playback still runs. Previews and multiview tiles take a quarter share. Under a hard limit AetherEngine
evicts history behind the playhead and waits instead of writing past it. Session directories whose
`session.lock` no live engine holds (AetherEngine keeps an flock on it for a session's lifetime) are
swept at launch and before every load. If the volume still runs out, the title reloads at its position
with half the share (twice at most) instead of asking the server for a transcode, which needs the same
disk. The earlier "no Vela cache sizing policy ships" decision above is superseded.

**Needs a real receiver** (the simulator outputs none of this): TrueHD Atmos and DTS:X showing Atmos,
E-AC-3 JOC showing Atmos, lossless 7.1 reaching the receiver as 8-channel PCM, Dolby Digital Plus 5.1
on legacy ARC, a speaker layout change mid-title, and Dolby Vision Profile 7/8 on a Dolby Vision TV.

An engine refusal emits the existing native session-command event. PathRecovery
selects an untried ready or on-demand path (preferring server transcodes) using
`switch` with the current position. If the plan advertises idle fallback, it
requests `prepare-fallback` once, then switches when a ready path arrives.
Failed paths are bounded per session. Commands receive authoritative generations
and idempotency keys through PlayerReport; the shared JS chrome is unchanged.
The historical `mpv-sub-` client-only subtitle identifier remains a wire-contract
spelling and does not select an engine.

Authenticated files use ScopedAetherReader and bounded URLSession ranges under
an immutable media grant. Redirects strip grant fields outside its origin/path
prefix and never restore them in the same chain. Aether LoadOptions.httpHeaders
stays empty, including secondary requests. Header-dependent HLS may use only the
adapter's existing `MediaAccess.nativeURL` (Plex transient token or Jellyfin
api_key). This private attachment must match the clean source, plan identity and
current grant generation, and both URLs must remain within that grant. It is
discarded on stop, plan change or grant replacement. URLs never enter snapshots
or diagnostics. Otherwise a refused playlist must be replaced by a server path.
Tests exercise real redirects, seeks, clones, size probes, bounded responses,
cancellation, attachment lifetime and credential-free diagnostics. Cancellation
interrupts the active I/O epoch; retained readers can rewind for track reloads.

Aether owns full-screen display matching, subject to tvOS Match Content settings.
Expo commits the ambient policy before applying a plan, then applies pending
commands; setter ordering cannot accidentally start a preview as full screen.
Guide ambient and hero previews both use the preview engine, disable matching,
and set `displayCriteriaOwner = .host` so the engine never writes or resets
display criteria for a preview load. Main and preview sessions use separate
reusable engine instances. Safe `[vela-display]` logs include the load policy,
current matching setting, criteria presence and system mode-switch start/end
notifications; they contain no media addresses or credentials. Detaching stops playback and removes subscriptions.
Upstream free-form logs are suppressed because they may contain grant URLs;
Vela logs route, video format, audio delivery and cache counters without URLs.

Public HTTP servers use the owner's selected address. The generated Apple plist
must not combine `NSAllowsArbitraryLoads` with `NSAllowsLocalNetworking`: the
latter overrides the former on current Apple OS versions. Local and public HTTP
connections were checked on the Basement Apple TV.

## Music, audiobooks and podcasts

Audio-only plans do not use AetherEngine. `AudioPlayback` is one AVPlayer for the
app (modules/vela-player/src/audio.ts): MP3, AAC and ALAC (MP4/M4A/M4B, ADTS), FLAC
and WAV play directly; Opus and Vorbis are declared as unsupported so the server
transcodes them (AVPlayer has no Ogg or WebM demuxer). The audio session is
`.playback` with the long-form route policy (`.spokenAudio` mode for audiobooks and
podcasts), the app has the background audio mode (apps/vela/plugins/apple-player.js),
interruptions pause and resume as the system says, and losing the route (headphones
out) pauses. Speed uses the spectral time-pitch algorithm. While it plays it owns
`SystemMediaControls`: Now Playing as audio (title, artist, album, artwork,
duration, position, rate) and the remote commands for its style, previous and next
for music, 15/30-second skips (and previous/next for the headset) for spoken word.
Every command goes to JavaScript, which drives the queue as the app's own buttons
do. Between items a background task keeps the app running while JavaScript asks for
the next plan.

Gapless: `AudioPlayback` is an AVQueuePlayer. The store hands it the next queue item
before the current one ends (`audioPreload`); the next AVPlayerItem waits behind the
current one, and `actionAtItemEnd` is `.advance` only while one does (otherwise the
finished item stays, paused, as before). The `currentItem` change sends `advanced`
with the new item's id, moves the item observers, and holds Now Playing for JavaScript's
title of the new item (a second at most) instead of publishing the finished item's
title over the new position. An item that resumes part-way is not queued.

Measured on the mock's gapless test albums in an iOS 27.1 simulator (Release build):
an MTAudioProcessingTap on every item received exactly the expected samples per part
(the delay and padding of FLAC, LAME MP3 and edit-listed AAC trimmed), and the parts
joined measure 0 samples at every join; in separate runs without the tap (attaching
one made AVQueuePlayer start each item afresh, with ~0.3 s between them), the
player's clock sampled every 2 ms went from one item to the next within 0.1 ms
(about 4 samples, the sampling limit) at every join, FLAC, MP3 and AAC alike. That is
AVFoundation's clock, not the speaker; a device and the lock screen were not checked.
The tvOS target builds with the same player. AVFoundation's reported durations differ
from the real ones by a few tens of milliseconds (FLAC +37 ms, MP3 +40 ms, AAC -25 ms),
which affects only the displayed duration.

## Multiview tiles

A view with the `tile` prop (0-3) is one of up to four live tiles on one screen.
Each tile leases its own AetherEngine, never the reusable primary or preview
engine, and loads with `sharedOutputRole = .secondary`, `logTag = "tileN"` and
host-owned display criteria with matching off: no tile writes the panel's mode or
claims Now Playing, and Aether's shared-output coordinator keeps the audio
session up until the last engine stops. A tile is activated like full watch (its
audio session) but starts muted; the screen's mute commands make one tile
audible. A stopped tile engine is released, not pooled. Views playing at once
hold the idle timer together (a count), so one tile stopping never lets the
screen sleep under the others.

## Single-engine device verification, 2026-11-18

Release builds installed on the Basement Apple TV and owner's iPhone played
Camp Crystal (Crystal Lake S01E01) through the loopback AVPlayerLayer route.
Camp Crystal's audio/subtitle menus were exercised on TV. The authenticated
two-audio-track fixture switched to Spanish and visibly rendered its English
subtitle on both devices, exercising reader reuse after cancellation. The final
TV fixture visibly displayed the caption over the full-screen picture after
placing subtitle layers above Aether's later-attached video layer. English/off
switches were also exercised. Hero trailers played through the separate preview
Aether instance on both devices; successive TV hero picture crops differed
while the native route remained Aether loopback/AVPlayerLayer.

Fall's 71,425,306,132-byte Asmo HEVC remux played through
`route=loopback format=hdr10 audio=bridged AVPlayerLayer=true` on both devices.
The lab needed a temporary owner-approved release pin: Ether reused a cached
19.9 GB SDR release despite HDR-capable client capabilities. The pin was removed
after proof, restoring the original no-pin state. This is recorded as an Ether
selection gap in `packages/protocol/title-player-gaps.md`. No client format
spoofing or production server changes were made.

The production Ether public address on port 32450 played BBC Two HEVC on the
TV through `remoteBypass` for more than ten minutes. Pause froze successive
frames and resume advanced them. Quick Connect was approved by the owner.
Production guide requests hit Ether's image-grant quota (503); the server team
identified and fixed that issue separately. Vela caches guide pages per channel
and time window for five minutes and coalesces overlapping loads. A controlled
48-channel/48-programme case used 24 startup pages rather than 39, with no repeat
fetches during the next four minutes.

The lab's Ether On Air CHROMA 80 channel played full screen on TV uninterrupted
from 02:11:43 through 02:17, using `remoteBypass` and AVPlayerLayer. Paused
frames eight seconds apart had zero pixel difference; resume advanced the image.
The server advertised adaptive live playback with a rolling window (0–6 seconds
in a fresh lab14 session), without a persistent DVR/recording capability. This
proves pause/resume within retained live media, not recording or arbitrary
timeshift seeking. The real
TV counter measured two distinct startup guide requests, one on tuning, then
two at the five-minute refresh: five guide requests and two channel-list
requests by elapsed 360 seconds, with no identical guide URL requested twice.
The guide's days and programme focus were exercised. The native TV channel
arrows tuned SHIFT 10 → CHROMA 80 → SHIFT 10, with a fresh Aether/AVPlayer
ready event and visible picture after each change. A TV focus guide makes these
arrows reachable above the transport controls without changing directional
navigation into transport shortcuts. Later fresh lab tunes briefly failed with
503/-1008: Ether traced those to Giganews refusing the shared account's
simultaneous IPs, not a lab restart. Cached sources subsequently allowed the
successful tuning checks. Production was not modified.

An authenticated fMP4 HLS fixture on TV used the real Jellyfin adapter's native
URL helper and played through Aether/AVPlayer. A redirect outside the grant
received neither the query token nor an authorization header. The displayed
diagnostic URL omitted its query. These are test-only entries under
`modules/vela-player/test/device`, never distribution entry points.

The final TV recovery probe replaced the original URL in a real Ether plan with
the authenticated refused-M3U fixture. Aether emitted `customSourceProbeFailed`
(-1094995529), then Vela's `switch` selected the actual advertised
`quality-720p4000k-hevc-sdr` path. The probe limited alternatives to that real
server path to require conversion rather than a stream-copy remux. It visibly
played as `aether-hls` through `remoteBypass`. The original was H.264 1920x1080;
ffprobe of the returned initialization and first fragment confirmed HEVC
1280x720. Ether labels the prepared delivery `remux`, despite serving this
converted rendition. No replacement media URL was manufactured by the client.
The Ether team corrected this quality-rung label to `transcode` in lab14,
deployed around 02:48; the earlier observation above records the pre-fix server.
The final post-restart TV run repeated the refusal and played the first requested
720p path with `kind=transcode`, `readiness=ready` and `aether-hls`.
The test also caught a reused engine's initial previous-error publication:
subscriptions now ignore their initial old values and defer stopping out of
`@Published`'s setter. The final run had one refusal and used the first requested
replacement, without skipping it.

App bundle sizes below count regular-file bytes, excluding symlinks, using the
same measure for the supplied dual-engine baseline and the final Release build:

| Platform | Aether + mpv baseline | Aether only |
| --- | ---: | ---: |
| tvOS | 99,078,013 | 78,746,254 |
| iOS | 85,490,183 | 78,637,811 |

Both bundles contain nine AetherLib FFmpeg/dependency frameworks and no mpv,
MoltenVK, libplacebo or libass files. Allocated bundle bytes were respectively
99,627,008 to 80,912,384 (tvOS) and 86,081,536 to 80,773,120 (iOS).
In KiB, matching the supplied on-disk baseline measure, tvOS went from 97,292
to 79,016 (-18.8%) and iOS from 84,064 to 78,880 (-6.2%). Logical file bytes
fell 20.5% and 8.0% respectively. Neither normal bundle contains the test-only
bootstrap or fixture-token markers.

At handoff, the TV's original saved state was restored with synchronous Keychain
readback verification, and the normal Release app was installed and opened.
The final normal iPhone app is built and audited. Its original-state restore
launch remains blocked by the phone's lock screen: both foreground and
`--no-activate` launches returned FrontBoard error 7 (`Locked`). The installed
test-only restore entry restores the saved device/session/server values on its
next launch; after that verified launch, install the normal iPhone Release app.
The phone was left locked, with no personal app driven. Device-test servers and
the agent's TV playback process were stopped. No production configuration was
changed and the temporary Fall lab pin was removed.

## Distribution notices

AetherEngine: LGPL-3.0 with App Store exception, unmodified source:
https://github.com/superuser404notfound/AetherEngine/tree/7.70.0 .
FFmpegBuild 3.15.0: dynamic LGPL FFmpeg provider and dependency notices:
https://github.com/superuser404notfound/FFmpegBuild/tree/3.15.0 .
LibDovi and Anime4K: MIT. The VelaPlayerLicenses resource bundle carries their
texts and FFmpegBuild's LGPL, dav1d, zimg and libzvbi notices, and ass/build.sh's
libass (ISC), HarfBuzz (MIT), FreeType (FTL) and FriBidi (LGPL-2.1, with
`fribidi.NOTICE.txt`: dynamic linking, source, replacement) texts. FFmpegBuild's
published build script documents its FFmpeg patches and GPL source exclusions.

## Historical device verification (before mpv removal)

The following observations describe the earlier dual-engine build and are not
verification of the single-engine build.


The Basement Apple TV has played Camp Crystal through the loopback AVPlayerLayer
route with Vela's play/pause and ten-second seeks. The owner reported that the
picture may look better. A framebuffer at 2436.6 seconds tracked the source
levels: 20 to 19, 52 to 52, 68 to 66 (the previous mpv route lifted 20 to 27).
No colour compensation is applied.

Fall's 4K source has also played on the Basement TV. The native ready log reports
`route=loopback format=hdr10 audio=bridged AVPlayerLayer=true`. This display
reports HDR10 support and no Dolby Vision support. TrueHD uses the audio bridge;
this check does not establish TrueHD Atmos object delivery or Dolby Vision output.

The iPhone Release build compiled and installed. Camp Crystal has visibly played
through AVPlayerLayer with the single FFmpeg provider. Native surface geometry
is synchronized explicitly when the Vela view lays out. Its initial launch hang also occurred
in the pre-Aether baseline: lab-pinned builds rejected saved standalone Ether
records. Shared session restoration now preserves those records and bounds startup.
The TV resumed playback after that fix. A native iPhone fixture then played
header-protected FFV1 through Aether's software route. An authenticated M3U
returned `customSourceProbeFailed` (-1094995529), demoted to mpv and visibly
played the same fixture; its snapshot reported `mpv-original` and `vela-mpv`.
The normal iPhone home also visibly played a hero trailer through a separate
Aether AVPlayerLayer (344 by 440 points, aspect fill). A two-audio-track
H.264/AAC/SRT fixture switched from English to Spanish using
the production native command prop: Aether's audible readback changed from
`eng` to `spa`. Selecting embedded English subtitles visibly rendered the fixture caption;
turning them off cleared the selection. The corresponding commands all acknowledged
success. On the TV, both production menus opened over Camp Crystal: audio
listed English EAC3 6-channel, and subtitles listed Off, ENG (srt) and SDH
tracks. Selecting ENG updated the checked item and Aether published stream 2
cues while playback continued.
The iPhone player UI tour compiled but its runner timed out enabling device
automation, before any steps ran.

Fallback carries the current pause, mute and volume settings. A native ready log
records the route, video format, audio delivery and AVPlayerLayer presence without
logging the media URL or its authorization.

## Historical cleared-space Fall endurance run

On 2026-11-18, after the owner cleared TV storage, the final build played Fall
continuously through AetherEngine beyond ten minutes (`cpuprobe t=601s`). It
stayed on the HDR10 loopback AVPlayerLayer route with no mpv demotion or failure.
Thirty-nine session-cache snapshots showed default retention actively evicting.
At that point: resident 1,319,767,503 bytes, forward 437,062,424 bytes, 133
evictions, zero rejected writes and `lastFailure=none`. The automatic base/safety
budget was 1,054,720,000 bytes. Requested budget and hard limit remained nil,
reserve zero, and retention ten forward/twenty backward segments: all defaults.
The playback-safe floor can exceed the soft safety budget, but with space
available that did not disrupt this run. No cache-sizing workaround ships.

## Historical upstream issue: default VOD cache can exhaust tvOS storage

With little free space, AetherEngine 7.70.0 defaults exhausted the cache volume
on the Basement Apple TV
4K (third generation), tvOS 27.2.1, while playing Fall's 71,423,402,926-byte HEVC
Main 10 / 23.976 fps remux with TrueHD 7.1 audio (FLAC bridge with the
MPVKit provider). Vela leaves
`sessionCacheByteBudget`, `sessionCacheHardLimitBytes`,
`sessionCacheFreeReserveBytes`, `forwardBufferSegments` and the cache directory
at their defaults. A temporary fixed-cap experiment was removed; no Vela cache
sizing policy ships. The cache is under the app's normal `tmp/aether-segments/`.

Minimal repro: bind an AetherPlayerView and load that HTTP-range source with
`LoadOptions()` on a TV reporting about 0.7-1.2 GiB available on the cache volume.
Observe `engine.diagnostics.$sessionCacheStatus` and let playback run. At about
60-80 seconds the segment cache reports that its volume is out of space, the
muxer fails cuts, retries twice, then the host falls back. This also occurred with
upstream FFmpegBuild's binaries, before the single-provider change.

Captured default-session status immediately before failure:

```json
{"requestedBudgetBytes":null,"volumeSafetyLimitBytes":193536000,
 "baseEffectiveBudgetBytes":193536000,"effectiveBudgetBytes":651796407,
 "playbackSafeFloorBytes":651796407,"residentBytes":651796407,
 "forwardBytes":97548099,"forwardSegments":10,"backwardSegments":20,
 "hardWindowFloorExceeded":true,"evictionCount":0,"hardLimitBytes":null,
 "freeDiskReserveBytes":0,"rejectedWrites":0,"diskAdmissionWaiting":false}
```

An earlier run reached 915 MiB resident at 60 seconds, with 1,214 MiB initially
available. Segments are roughly 45-52 MB. With a nil hard limit and zero reserve,
`SegmentCache.stagingWriteAdmission` bypasses its own clamp; `rejectedWrites=0`
also rules out a configured-cap refusal. The out-of-space notification in this
path is raised by a staging write/open returning ENOSPC. The observed symptom
is therefore a real write failure, although `lastFailure` remained `none` in the
status snapshot.

The upstream capacity query uses `volumeAvailableCapacityKey`, which excludes
purgeable space. tvOS can hold purgeable caches on an apparently full volume, so
that value understates reclaimable capacity. This accounting and the protected
playback-window floor exceeding the automatic safety budget both belong in the
upstream investigation. Aether should evict consumed history or wait rather than
terminate playback. Vela does not compensate by reducing everyone's forward buffer.

Native `[vela-aether-cache]` JSON lines capture the status about every 15 seconds
and immediately before fallback, without media URLs or grant headers.

This investigation is recorded locally; no upstream issue or PR has been filed.

Live HLS uses native remote HLS when its URL needs no headers (including the
adapter-authorized URL attachment above). Vela disables AVPlayer's automatic
time-offset preservation, leaves configuredTimeOffsetFromLive invalid, and caps
live AVPlayer rate at 1.0. No live cushion is configured. Explicit Live remains
a viewer command. Live loads also disable clampsLiveResumeToWindow, which otherwise
snaps a live-only resume to the edge when sufficiently far behind.

Live timeshift (pause, rewind, back to live) is local. On the remote HLS route
the snapshot's `live` block reads the current item's seekableTimeRanges (first
start, last end) on AVPlayer's item time, which is also `position`; latency is
the item's recommendedTimeOffsetFromLive (else 6 s). Loopback and software
routes report Aether's published `liveEdgeTime` and `seekableLiveRange` on its
session axis; without a DVR window they have an edge and no start, so seeks
are refused and `catchUp` uses `seekToLiveEdge`. Live seeks clamp into
[start, edge - 1 s] and never become a server session command; resuming a
pause the window slid past lands 5 s inside its start. A start-over plan
(`live.mode == "startOver"`) is placed at its plan position once the window is
known, since live HLS joins at the edge.

Upstream request for AetherEngine: expose a LoadOptions opt-out for automatic
live resume re-placement and live edge recovery. In 7.70.0 SoftwarePlaybackHost
arms resumePlacement after an edge rebuffer and publishes liveResumeCatchUp;
AetherEngine+Loading consumes it with seek(origin: .liveRejoin). Vela cannot
disable this through the public API. Non-native/software live routes therefore
still require that upstream option; a cushion does not disable re-placement.


## macOS shared session

PlaybackSession owns plans, scoped authorization, commands, observations and
bounded recovery for both Expo and Electron. VelaPlayerView is the thin Expo
wrapper; PlaybackHost and PlaybackRendering isolate AppKit/UIKit integration.
The desktop addon compiles these same Swift sources without a second player
implementation. Aether's native view sits below Electron's transparent page.

macOS uses EDR layers and probes potential display headroom for HDR eligibility.
Aether's display-criteria matching is currently a no-op on macOS. Its AVFoundation
route can preserve Dolby Vision metadata, but EDR headroom alone does not prove
Dolby Vision display output. E-AC-3/JOC passthrough depends on the native audio
route; decoding TrueHD through an audio bridge does not establish Atmos object
delivery. Runtime desktop verification is recorded in the desktop host docs.
