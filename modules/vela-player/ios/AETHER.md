# Apple playback

Vela's Apple player uses AetherEngine 7.70.0 first, with MPVKit 1.0.0's LGPL
product retained as a load-error fallback. Both use the same native view,
PlayerState and PlayerReport, so JavaScript commands and Ether observations
keep their existing shapes. The snapshot backend identifies the active engine.

The pod uses React Native's `spm_dependency` to compile AetherEngine. The Expo
`apple-player` plugin pins FFmpegBuild 3.15.0 for the package's C module headers,
but the executable resolves both engines against MPVKit's single LGPL FFmpeg
build. MPVKit provides libavcodec 62.28.102, libavformat 62.12.102, libavutil
60.26.102 and libswresample 6.3.102. Their public codec/packet/format/frame/channel
layout declarations match FFmpegBuild's micro-103 headers apart from framework
include names. All 293 FFmpeg symbols Aether imported are supplied by MPVKit.

This matters because both engines are static: each `av_*` symbol resolves once
in the executable. Linking Aether's dynamic FFmpeg first made mpv use a build
without HTTP protocols. The plugin links MPVKit's libraries first, removes the
app's AetherLib product dependencies and strips unused dylibs. There are no
AetherLib frameworks in the resulting app and no AetherLib load commands. The
link map places `avformat_open_input`, `avcodec_version` and
`av_interleaved_write_frame` in MPVKit's archives. Preserve this check on upgrades;
a different API/ABI requires rebuilding the common LGPL FFmpeg provider.

Only the AetherEngine product is compiled. Optional package traits and GPL
products are not enabled. SwiftPM copies the engine resource bundle. Both
release pins are exact, and both deployment targets are 18.0.

Authenticated files use `ScopedAetherReader`: bounded range requests are made by
Vela's URLSession transport under the immutable media grant. Redirects strip
all grant fields outside the origin/path prefix and never restore them later in
the same chain. Aether's own `LoadOptions.httpHeaders` stays empty, including for
secondary requests. The real URLSession tests cover cross-host, path escape,
encoded traversal and return redirects, oversized replies, real byte-reader
seeks/size/clones, and cancellation before or during a native read. A header-dependent
playlist that cannot work through a custom byte reader falls back to mpv.

The engine owns display matching on its route. Vela's existing display matching
is used only after mpv fallback. Engine instances are retained for reuse across
loads; the muted hero preview has an independent instance. Detaching the view
cancels loading, removes subscriptions and stops playback.

## Distribution notices

AetherEngine: LGPL-3.0 with App Store exception, unmodified source at
https://github.com/superuser404notfound/AetherEngine/tree/7.70.0 .
FFmpegBuild: LGPL headers used at build time; its dynamic FFmpeg products are
not embedded. Source and notices are at
https://github.com/superuser404notfound/FFmpegBuild . The shipped FFmpeg provider
is MPVKit's LGPL product, covered by its existing notices.
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

## Cleared-space Fall endurance run

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

## Upstream issue: default VOD cache can exhaust tvOS storage

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
