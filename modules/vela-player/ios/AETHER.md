# Apple playback

Vela's tvOS and iOS apps use AetherEngine 7.70.0 exclusively. AVPlayer and
software decoding are routes inside that engine. No MPVKit, libmpv, MoltenVK,
libplacebo, libass or mpv-only libraries are linked or bundled on Apple mobile
platforms. The macOS Electron host reuses these playback sources through an AppKit rendering
adapter (macOS 15+, Apple silicon). Linux and Windows retain their own mpv
implementations. See `apps/vela-desktop/NATIVE_PLAYER.md` for the IPC contract.

The pod compiles only the AetherEngine product, with no optional traits or GPL
products. The Expo apple-player plugin pins its LGPL FFmpegBuild dependency to
3.15.0. Aether's own dynamic AetherLib frameworks supply FFmpeg; there is no
second provider or static FFmpeg symbol override. Deployment targets are 18.0.

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
texts and FFmpegBuild's LGPL, dav1d, zimg and libzvbi notices. FFmpegBuild's
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
