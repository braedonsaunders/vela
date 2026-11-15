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
  superseded/preroll frames. A seek keeps the same source cache/device/pipelines.
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
