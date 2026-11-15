# Vela playback core

One Vela-owned pipeline, behind the existing `vela-player` native view. The
engine owns scheduling and state; upstream WebGPU Player supplies components,
**not its controller**. No user-selectable engine or beta mode.

```
SourceReader → Demux → Decode → bounded audio/video queues → Scheduler
                                        AudioWorklet → MediaClock → WebGPU + subtitles
```

## Modules and ownership

All new orchestration lives in `client/player/core/` (playback lead).

- `source/`: original HTTP ranges, conversion CMAF/HLS and live HLS readers.
  One source-scoped memory cache, strict206/Content-Range/size/revision checks,
  abortable bounded retries. No private media disk cache. Header/index reads can
  overlap; index pages stay pinned within the cache bound.
- `demux/`: Mediabunny as a demux library for MKV/MP4, plus TS/CMAF adapters.
  Produces actual track configurations and timestamped encoded packets. Seek by
  cues/sample tables to the preceding keyframe; decode preroll without presenting
  it. Missing indexes use bounded search, never an unbounded scan of a remux.
- `decode/`: exact-config WebCodecs first; installed WGSL decoder packages next;
  available WASM decoder last. Route changes retain source, position and tracks.
  Broker conversion is the final authorized source fallback. Reuse upstream
  package parsers, GPU decode sessions and presentation/colour helpers as libraries.
- `clock.ts`, `buffer.ts`, `scheduler.ts`: Vela owns the media timeline, queue
  bounds, backpressure and frame deadlines. Audio-rendered timestamps are master;
  monotonic time is used only for silent/video-only playback. Pause/seek/rate
  changes reset anchors atomically. Present the newest due frame and release
  superseded/preroll frames. Prime the target video frame before starting audio;
  loading-time Play/Pause changes intent without reviving a retired epoch. A seek
  keeps the same source cache/device/pipelines. Presentation counters record frame
  age against the physical audio clock; they do not claim human lipsync accuracy.
- `session.ts`, `recovery.ts`, `quality.ts`, `live.ts`: Vela owns Ether authority,
  generations, plans/SSE/observations, retries, rendition/source switches and live
  edge policy. URL/timeline/edition/source revision must remain compatible across
  a switch; otherwise require a new authoritative plan. Never choose an edition.
- `runtime.ts`: adapts this core to existing snapshots/commands. Chrome receives
  real audio/subtitle/quality inventories, selected/pending state and speed.
  Native/MSE is a narrow internal last resort for unavailable secure/WebCodecs
  paths; it does not own the capable-browser pipeline.

The audio/subtitle specialist owns `client/player/universal/audio/` and
`client/player/universal/subtitles/`; these become controller-independent core
modules. No duplicate byte reader, media clock or scheduler inside them.

## Frozen component boundary

Times are absolute title **microseconds** inside the core; subtitle clock callback
uses seconds. A local monotonic `epoch:number` changes on seek/decoder replacement;
all packet/output callbacks carry it. Ether source/seek generations remain separate
wire authority, and old replies/events cannot advance a newer epoch.

- `ByteReader`: `size(signal):Promise<number>`,
  `read(offset,length,signal):Promise<Uint8Array>`, `dispose()`. Shared with embedded
  subtitle demux; source-scoped cache, reads cancellable per epoch.
- `EncodedPacket`: `{trackId,timestampUs,durationUs,key,data,epoch}`.
  Track metadata carries real container track ID/full source index, codec config,
  codec private data, dimensions/colour or sample rate/channels/speaker mask.
  Descriptions never veto actual decodable container facts.
- Audio module: configure actual track; `decode(packet)`, `flush(positionUs,epoch)`,
  `play/pause`, volume/mute/rate and `dispose`. Reports
  `{epoch,mediaTimeUs,performanceTimeMs,playing,bufferedUntilUs}` from the physical
  output clock. Core MediaClock owns extrapolation, bounds and playback intent.
  PCM downmix, limiter, resampler and codec packages remain specialist-owned.
- SubtitleSession: supplied shared reader, original/external descriptors, surface,
  `clock:()=>seconds`, epoch and abort signal; discover/select/seek/dispose.
  Reports actual inventory/selected/pending/failure. Safe text cues first, libass
  for real ASS/SSA shaping, PGS palette/RLE/composition for bitmaps. One overlay
  above video and below chrome; paused seeks refresh it. HLS burn-in is explicitly
  a server tracks command, never presented as decoded text.

## Bounds and honest states

Start with32MiB reader cache, three range requests,16MiB maximum packet/read,
8 queued video frames and audio read-ahead capped at6s. Tune from measurements,
not constants pretending to be universal. First-frame deadline8s; every network,
probe and decoder wait is cancellable and bounded. Recovery is native decoder →
package decoder → authorized Ether conversion; terminal failure gives a reason and
Retry. A moving audio clock alone cannot satisfy the first-video-frame watchdog.
Live uses the same demux/decode/clock: adaptive bounded buffering, low-delay target,
catch-up and upstream-gap vs delayed-publication states.

## Delivery gates

1. Direct original H.264/HEVC parity with0.1.30: audio, colour, seeks, metadata
   tolerance, generations, subtitles and recovery through the new core.
2. Ether HLS/CMAF conversion through the same queues/decoder/clock; remove capable-
   browser MSE orchestration.
3. Live TS/CMAF with edge/reconnect/catch-up policy.
4. Quality continuity across original and converted paths/renditions using actual
   boundaries; then remove the superseded wrapper/controller code.

Each gate compiles, has one purposeful local drive, then one-stream-at-a-time lab
qualification with stop/revoke/browser cleanup. Ship only when matching or beating
0.1.30. Targets over LAN: first frame<~1.5s, seek<~1s, live start<~2s, zero drops at
4K HDR on capable GPUs. Report broker planning separately: prior3.4–3.7s provider
resolution cannot be hidden by client work. The unshipped wrapper speed prototype
is retained only as ignored reference; it is not the new core.

MIT notice, MPL corresponding sources and separately loaded LGPL packages/source
offers remain in every verified runtime payload. New libass/fonts/subtitle assets
need their own pinned licences and corresponding source inventory.

## First direct-file component milestone

The native-view adapter now runs Vela's RangeReader/FileDemux, native WebCodecs
video decoder, audio specialist's CoreAudioOutput, MediaClock and VideoScheduler,
and the upstream WebGPUPresenter solely as a rendering component. The bundled
candidate has no CustomPlaybackController or CustomPlaybackFrameLoop class.
`tools/player/prepare-upstream.ts --core` explicitly builds this local migration
candidate; production continues using the qualified entry until parity passes.

One local same-origin640×360 H.264/AAC fixture drive measured first GPU frame
348.6ms. An engine seek immediately exposed target4s/buffering, then resumed with
a new presented frame in87.7ms including40ms of simulated authority latency.
The runtime and32MiB reader cache were retained across the seek generation. Four
HTTP ranges transferred943524bytes across that source lifetime. Physical-audio
EOF produced ended at8.010895s after the audio tail;206video frames were decoded
including seek preroll. One presentation drop occurred during startup; it remained
one at EOF. Chrome and the owned local asset server were closed.

These are local synthetic measurements, not LAN or new-core HEVC/HDR parity.
An earlier same-core API seek measured38.5ms without the simulated command trip.
Native SDR is implemented; WGSL/HDR route integration, subtitles, HLS/live and
quality continuity are still migration work. The new core is not yet selected by
the production build. Source-scoped abort jobs retain cache/device across seeks;
source replacement, stop and failed startup cancel them and bound teardown.

The next local component drive used actual HEVC Main10/PQ+BT.2020 and E-AC-3
5.1. Vela selected the installed HEVC WGSL decoder and software audio package;
the GPU colour pipeline tone-mapped the PQ steps to SDR. First GPU frame239ms;
authorized retained seek136ms including40ms authority delay; EOF7.995s. There
were212decoded video frames including seek preroll,0presentation drops before
seek and1at/after it. Three ranges transferred676906bytes across the source.
The runtime, reader cache and presentation device survived the seek. The parser
coordinator runs in bounded workers; GPU jobs use the library's decode-session
component while Vela retains packet credits, presentation queues and clock policy.
This640×360 local result does not qualify4K lab parity or Dolby Vision processing.

## Clock-driven subtitle integration

The core native-view candidate shares its original-file ByteReader with the
subtitle subsystem. Actual full-container subtitle tracks populate the existing
chrome snapshot. Selection, Off and paused seeks are local; text selection never
restarts the broker. HLS text uses the same overlay with absolute title time and
cancellable WebVTT windows. An embedded decode/acquisition failure may request
one authorized server fallback per session/source/track; external network errors
do not trigger an encoder restart. Burn-in is explicitly reported.

A local generated AVC/AAC+ASS fixture rendered its attached font and italic cue
at a paused, authorized seek to2s: one overlay canvas,7536nontransparent pixels,
selected server ID preserved, no subtitle error. The generated PGS fixture used
the same native-view/seek path and rendered14300nontransparent pixels. Off
removed the overlay in both drives. Neither selection sent a tracks command;
the only session command was seek. Both browsers and the local asset server
were closed. These prove local host integration, not lab or4K parity.

Plain-text appearance preferences are exposed to chrome and persisted locally.
ASS and PGS keep authored styling/bitmap composition and disable those overrides.
Subtitle assets, fonts, exact corresponding sources and notices are optional,
verified payload components; embedded families are declared only by a core
payload containing them. The production wrapper remains selected until the
core migration gates pass.

## HLS/CMAF packet-source milestone

SegmentReader now owns scoped same-origin acquisition, two-request concurrency,
16MiB object/1MiB playlist limits,32MiB LRU cache, bounded retries and aborts.
It resolves and pins the first master variant without opening any other rung.
Mediabunny supplies HLS/CMAF/TS packet demux only: the same Vela video decoder,
AudioOutput, clock and scheduler consume those packets. HLS library timestamps
are playlist-relative and mapped once to the authoritative title origin; raw
fMP4 decode timestamps are not rewritten. Clear, muxed, finite VOD is implemented;
separate audio groups, encrypted media and moving live windows fail explicitly
until their adapters exist. This is still an unshipped core component.

One local generated eight-second AVC/AAC drive started from an offset4s playlist:

| Input | First presented frame | Seek to6s | End | Presentation drops |
| --- | ---: | ---: | ---: | ---: |
| CMAF, selected from a two-rung master |181.6ms |14.7ms |8.010894s |0 |
| MPEG-TS, same core and output modules |38.5ms |not driven |8.010896s |0 |

Only segment002/003 were requested; neither segment000 nor the unselected master
variant was fetched. The CMAF reader cache survived the seek. A CLI request
listener initially crashed because URL is absent from its outer sandbox; after
correcting that drive script, both media paths passed. No test suite was added.
Chrome and the local asset server were closed. These640×360 loopback measurements
exclude broker planning and do not establish4K or lab parity.

The explicit core payload now enables finite HLS in the same `vela-player` view
via its verified manifest, without changing the production wrapper's admission.
A local native-view remux plan at4s selected WebGPU, first GPU frame255.9ms,
active audio IDa2, and both server-offered audio choices. An authorized seek to6s
immediately exposed target6/buffering, then resumed in68.5ms including40ms
simulated authority latency. The exact runtime/cache survived, no earlier segment
was fetched, and presentation drops stayed0. Selecting audioa1 emitted the normal
server tracks command rather than attempting a nonexistent local HLS track.
Chrome and the local server were closed. Finite HLS remains a migration candidate;
live-window, alternate-group and cross-rendition continuity gates are outstanding.

## Watch-view integration

The core uses the existing `vela-player` roster entry and immutable shared
runtime descriptor, including the actual `/watch` foundation's private media
props, transport/menu commands, snapshots and session observations. A production
payload choice changes that implementation; no diagnostic-only route, alternate
chrome or viewer switch is required. `snapshot.diagnostics.implementation` reports
`vela-core` for qualification without exposing media URLs or authorization.

The hidden video element is only the native fallback surface and volume store.
Its waiting/error/transport events cannot change a WebGPU backend's state.
Snapshots come from the core clock and presented frames. Observations pause while
a seek/source switch is pending, and until the first presented frame, so an old
clock cannot overwrite a newly authorized broker position or report startup as
paused. Chrome and Close remain foundation-owned through loading and recovery.

## Track, quality and live transitions

Original audio selection uses actual demux track identity and publishes pending
state. A superseded selection cannot replace a newer one. Text/ASS/PGS overlay
selection is local; turning off server-burned image subtitles issues the canonical
tracks command. Before original→converted delivery, a local audio or PGS choice
is authorized by a tracks command, followed by the requested path switch. No new
session or invented switch boundary is introduced. The returned generations,
measured origin and position control replacement demux/decoder state.

Core HLS exposes its active rung and real ladder to the same chrome. Pinning
opens only that advertised URL; Auto releases the pin while retaining the current
level. Conversion Auto is deliberately conservative: producing rung at startup,
no speculative encoder probing or upswitch, one step down only after a sustained
stall, with startup hold and cooldown. Original/lower-quality path changes remain
server-authorized. This is interrupted, position-preserving transition coverage;
seamless cross-source overlap has not been established.

The live reader refreshes versioned playlist snapshots independently of immutable
media caching. Every size/header/body read sees one playlist version. Sequence
identity plus actual EXTINF durations merges overlapping windows; missing history
is never replaced by sequence×targetDuration arithmetic. Initial mapping requires
`X-Ether-Live-Media-Sequence` and `X-Ether-Live-Window-Start` from the same response.
These describe session time, independent of broadcast PDT. A private synthetic
date anchor conveys that exact mapping to the demux library only; it is neither
claimed as broadcast time nor sent back to Ether. Missing initial proof falls
through to the narrow browser backend rather than guessing.

The same packet/decode/AudioWorklet clock serves live. At the moving edge, packet
reads are provisional and release the serial demux lane between polls, allowing
audio and video to progress independently. Encoded and decoded queue bounds stay
in force; duration remains unknown until actual stream end. The live census is
bounded, and the library demux epoch rotates over the same reader every three
minutes to bound its retained metadata. That rotation can briefly buffer and is
not a seamless-handoff claim. Ten seconds without a presented frame invokes
bounded recovery. Exact source/seek generation changes still retire old readers.

Live bounds, measured throughput/read-ahead and starvation feed the existing
adaptive latency policy; its catch-up rate is applied to the physical audio
output and core clock, without a viewer mode choice. Jump-to-live uses that same
moving window. The installed wrapper stays production until the combined real-app
qualification; these additions are candidate code, not a lab pass.

Live metadata deliberately skips the demux library's duration query: its default
segmented implementation asks for the segment at Infinity and waits for live EOF.
The first local look exposed that wait; the eight-second watchdog recovered to
native playback. That is a recovery pass, not a core live pass. Core live must
present frames and advance its mapped edge in the follow-up local check.

The focused live follow-up after removing that query presented through the core,
advanced its mapped edge 80→86 s and locally sought to 81 s while preserving wire
seek generation 1; zero drops/underruns. A quality switch in that same look exposed
a separate unit-boundary defect: an interpolated clock may contain fractional
microseconds, whereas the audio output's epoch floor requires an integer.
`startEpoch` now rounds once and rejects unsafe integers before any decoder/output
reconfiguration. This also applies to audio switches at a running position.

Final generated-media native-view look after integer target normalization passed:
selected EAC3 audio `a1`, visible external captions `s`, speed 1.25, and paused seek
to exactly 2 s. A real 320×180 lower HLS rendition played through `vela-core`;
releasing its quality pin to Auto retained that same runtime and active low rung.
The moving live source also stayed on `vela-core`: initial position 66/edge 78,
then edge 84 and local seek to 79, wire seek generation unchanged at 1. It decoded
190 frames with zero drops and zero worklet underruns in this short sample.
The dedicated browser and fixture server were closed; no lab/provider requests
were made. Build/type checks passed. This establishes the local components and
first-edge motion, not long-run latency tightening, metadata-epoch rotation,
PGS burn-in or cross-path continuity; those remain in the combined real-app run.

### Lab.26: source recovery and subtitle conversion gate

Actual cinematic app candidate `0.1.37-core-f071d36`, runtime
`8758a83c20733c08`, played the pinned Inception jennaortegaUHD release
`525f3640da729300e2e6562e155516ff23c29212` directly. Ether independently
confirmed the release and no FFmpeg, host-cap waits, cancelled/failed ranges,
slow responses or prefetch failures during original playback.

| Measurement | Result |
| --- | --- |
| Play to first frame | 365.2 ms |
| Plan received | 124.5 ms after Play |
| Post-plan first frame | 240.7 ms |
| Sustained sample | 45.6 seconds of media, no buffering |
| Decoded / presented / dropped | 1,099 / 1,093 / 1 |
| Audio worklet underruns | 0 |
| Last / maximum sampled presentation lag | 1.5 / 26.6 ms |

The lag measures scheduling against the audio clock, not human lip-sync or
physical speaker mapping. This short source-recovery sample improves on the
lab.25 sample (26.7 seconds of media in 30 seconds, five drops and two underruns).

English PGS selection did **not** establish caption pixels. Embedded preparation
requested the bounded burn-in fallback; the lab's Homebrew FFmpeg then failed
HDR-to-SDR conversion because it lacked the production bundle's tone-map filters.
The init returned HTTP 500 and subsequent source recovery failed. No 720p, seek
or PGS pass is claimed for this run. UI Stop returned 200/ended, sign-out revoke
returned 200/accepted, and the dedicated Chrome closed. Ether independently
confirmed zero sessions and encoders, removed the pin, and scheduled its
production-bundled Jellyfin FFmpeg for the next run. Production remains on the
qualified wrapper.

The transition also exposed an HLS validation precision hole: an interpolated
seconds target could be 0.2 microseconds below its independently rounded origin.
`openHls` now rounds both to the same microsecond grid before comparing them;
invalid/non-finite or genuinely earlier targets still fail. A direct method
check accepts 83,123,456.8 us against origin 83,123,457 us and still rejects a
one-second earlier target. Subtitle preparation failure messages now survive
replacement of the overlay in a bounded, URL-redacted snapshot diagnostics list,
so a burn-in fallback cannot erase its initial cause. Scoped core/native-host
TypeScript compilation passed after these changes.

### Bundled-FFmpeg transition follow-up

The next actual-app candidate, clean `6585160` / core `ed2f01cb60f06b09`, used
production-bundled Jellyfin FFmpeg on the same lab.26 and pinned source:

| Action | Result |
| --- | --- |
| UHD first frame | 494.8 ms; plan 168.1 ms, post-plan 326.7 ms |
| Direct seek to 61.4 s | 382.5 ms |
| Original → 720p H.264 SDR | 1,170.8 ms to first core frame |
| Subsequent 720p fragments | 351 decoded / 347 presented / zero drops in 15 s; one startup underrun |
| Auto | Retained the playing core HLS backend |
| Return to Original | 612 ms to first core UHD frame |

This start had one early direct-play audio underrun and three drops; it is not a
zero-stall claim. The 720p source also briefly buffered once after its first
frame. Ether confirmed hardware tone-map/scale/encode and healthy later segment
publication. Later multi-`moof` segments stayed on the core, establishing the
initial padded-`styp` repair on the real app.

PGS still failed locally with the now-preserved message `Subtitle metadata
operation exceeds bounds`. Its bounded burn-in fallback did produce visible
captions (screenshot inspected), but a later fragment exhausted the library's
ten-box format probe and recovered to MSE. Thus this is a burn-in/browser
fallback pass, not an embedded-PGS/core parity pass. UI Stop and revoke each
returned 200, the dedicated Chrome closed, and Ether independently confirmed
zero sessions/encoders and no remaining pin.

Ether clarified that leading `free` boxes are intentional keepalives sent during
slow encoding. Their count is arbitrary. The Vela format adaptation now derives
its box budget from the fetched object's finite byte length, accepts `styp`
after any possible padding count within that object, checks safe box arithmetic,
and yields for cancellation every 1,024 headers. It reads headers, not padding
payloads. Unknown-size sources retain the library's conservative probe; HLS
objects have a known size and the existing 16 MiB acquisition bound. Generated
HLS with 1,100 leading `free` boxes per segment fails the previous probe and
passes the adapted one: 156 video and 281 audio packets, including later
multi-`moof` objects.

The subtitle index previously issued a separate reader operation for every
small Cues field. A valid 30,000-entry generated index reproduced the exact
failure after 100,021 reads, although it was only about 0.5 MiB. Cues are now
read as one bounded (at most 16 MiB) metadata document and parsed locally, with
validated EBML parent/size arithmetic, the existing 100,000-position cap, a
finite structure budget and cancellation yields. The same generated index now
requires 30 total reader operations and produces the expected 3,168 opaque PGS
pixels; borrowed-reader disposal remains zero. No network cache, source scan or
read-budget expansion was added. Scoped TypeScript compilation passed; the next
real-title caption and long HLS proof remain gates.
