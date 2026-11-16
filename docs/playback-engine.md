# Playback engine

## Current platform decision

Vela is moving to React Native and Expo. Web keeps this framework-independent
WebCodecs/WebGPU core, imported into the Expo JavaScript graph. Native platforms
use the shared player-view contract with libmpv. The Exact native-view registration
below is transitional and is deleted with the Exact app; it is not part of the
final web host. Qualification, direct dependencies and old-player excision remain
required before launch.

## Core-only launch plan (owner directive, pending qualification)

Ship one Vela player and one source-complete build. First finish delivery-aware
admission and the real-app matrix below; then remove the legacy implementation;
finally repeat the full matrix with only the core installed. Send this plan to
the orchestrator before deleting. Production remains unchanged during the work.

| Remove | Concrete repository scope |
| --- | --- |
| Frozen wrapper runtime | Descriptor/payload `3c579f70de6e1cfe`, its release reuse instructions and wrapper qualification gates. No wrapper bytes enter the new release. |
| Upstream orchestration | `client/player/universal/runtime.ts` (`upstream-controller`), controller/frame-loop/decode-session integration and wrapper-only audio/control/transport/audit adapters under `universal/`. Check imports before removing each shared helper. |
| Old player dependency | `vendor/webgpu-player` gitlink, `.gitmodules` entry, upstream revision pin/checks, inherited tsconfig/npm tooling and imports into its `src/` or `tools/`. The core currently uses some of these: removing only the controller would be incomplete. |
| Two runtime build modes | Replace `tools/player/prepare-upstream.ts` and its `--core` branch with one static-asset builder. Metro bundles the core JavaScript; the immutable payload contains decoder/worklet/subtitle assets, sources and notices. Remove wrapper build transforms and wrapper audit payload generation. |
| Frozen-release reuse | Remove `--universal-from-release`, `stageUniversalFromRelease` and `tools/release/universal-from-release.py` with the packager. Release tooling verifies the fresh static asset inventory and digest alongside the Expo export; it does not reuse a wrapper or load a separate core JavaScript entry. |
| Migration switches | Remove `upstream-controller` unions, wrapper-compatible optional methods, core-vs-wrapper host checks, migration manifest flags (`core.vodHls/liveHls`) and descriptor overrides used for paired qualification. Hardware capability and installed-decoder checks remain. |
| Obsolete documentation/proofs | Replace this historical wrapper integration narrative and wrapper build instructions with the current core contract. Remove wrapper-only fixture/proof scripts and stale generated references; retain a concise dated evidence record rather than instructions for reviving the old player. |

Before removing the submodule, give the core direct, explicit dependencies:
Mediabunny's demux source and licence; separately loaded audio/video decoder
packages, hashes and corresponding sources; and subtitle assets. Replace the
upstream presentation/audio-output/worker/asset plumbing the core still imports.
If a small permissively licensed format or colour primitive is retained, keep
its minimal reviewed source and attribution with the core. Do not copy the old
controller or whole player into a renamed directory. Preserve MPL/LGPL source
and licence obligations, including replaceable decoder modules. Install build
dependencies directly, without the old submodule's `node_modules`.

The retained fallback chain belongs to the same Vela engine: native WebCodecs
or installed decoder packages; core HLS demux when Ether remuxes/transcodes an
unsupported original; bounded, typed server conversion/burn-in when necessary;
and Vela's native-element/MSE compatibility backend where browser capabilities
require it. These are delivery/decoder backends, not a second controller. A core
error must never silently load the deleted wrapper. Keep scoped media-header
authorization, native fallback token handling, observations, progress/epoch
semantics, chrome commands, trickplay and cleanup across every backend.

Coordinate release inputs/defaults with `thr_tgszknwfsb` and the unchanged
foundation/player event and prop contract with `thr_2e6r64an8e`. Qualify the
current candidate in the actual watch view, then qualify again after excision:
1917 HLS; verified 4K HDR10 TrueHD; Inception UHD DTS-HD and VC-1 server
conversion; PGS pixels and Off; live channels/latency/preview stop; audio and
subtitle changes; quality/Auto; trickplay; off-grid and backward seeks. Record
the actual release, backend, start/seek/transition timing, decoded/presented and
dropped frames, audio underrun duration, buffering, fallback/recovery and byte
refetch. Stop/revoke/unpin each run. Only the clean core-only pass goes to the
packager for the launch release.

## Core capability matrix (current routes, not package-presence claims)

Native below means exact-configuration WebCodecs support on the device, usually
hardware, not a guarantee that the browser selected hardware. WASM modules load
only for the selected codec. All decoded video uses the same WebGPU presenter.
The owner's launch scope retains server conversion for older video codecs;
installed VC-1/MPEG packages are **not** wired or advertised by this work.

| Container/delivery | Core path | Limits / server requirement |
| --- | --- | --- |
| Matroska/MKV, WebM | Mediabunny metadata plus shared streaming clusters and bounded range cache | MKV qualified on real originals; WebM reader exists but is not a separate real-library qualification. Codec support is independent. |
| MP4, MOV/QuickTime | Mediabunny sample tables/fragments over the same reader | Real MP4 and local edit-list/fragment proofs exist; encrypted samples require an authorized browser DRM backend, which the custom core does not implement. |
| Clear fMP4 HLS, VOD/live | Core segment reader/demux, generation identity and exact live anchor | Producer remux/encode remains necessary when the original codec is unavailable locally. Playlist/timing admission fails honestly when unprovable. |
| MPEG-TS / HLS-TS | Library demux exists | Not independently qualified as an original-file route; server remux is the launch fallback. |
| AVI, ASF, MPEG-PS | Library readers exist | Not advertised as qualified originals. Legacy video remains server conversion. |
| MP3, ADTS, FLAC, Ogg, WAV, AIFF | Library audio readers exist | Audio-only UI/transport is not qualified by the current video launch set. Ogg presence does not establish Theora video support. |
| DVD/BD disc menus, ISO, encrypted/DRM media | No custom-core disc/DRM path | Requires server handling or a compatible licensed native path; no browser VLC-equivalence claim. |

| Video | Local route | Qualification / remaining fallback |
| --- | --- | --- |
| H.264/AVC | WebCodecs, hardware preferred; browser software if supported | Real direct and HLS proofs; exact profile/level still checked. |
| HEVC Main/Main10 SDR, HDR10, HLG | WebCodecs; installed HEVC parser/WGSL decoder package when native route cannot be used | Real Main10/HDR originals; package route has generated local proof. HDR presentation remains device-qualified. |
| Dolby Vision | Supported HEVC base layer through the same route | No FEL reconstruction, full DV metadata display or certification claim; base-layer rendering is explicit. |
| AV1, VP8, VP9 | Exact-config WebCodecs component can accept these | Not in the current advertised qualified-original video list (H.264/HEVC only). Do not infer real-library qualification from browser API support. |
| VC-1/WVC1, WMV3 | Server video conversion | Owner-selected launch fallback; no installed VC-1 package activation. Inception DDB must demonstrate bounded, honest conversion playback. |
| MPEG-1/2, MPEG-4 Part 2/Xvid/DivX, older WMV/H.263 | Server video conversion | No new software decoder work or package activation in this scope. |
| Theora, ProRes, JPEG2000 and other unqualified codecs | Server conversion where available | No local performance or correctness claim from a dormant package/library codec name. |

| Audio | Local route | Qualification / limits |
| --- | --- | --- |
| AAC, MP3, AC3/EAC3, FLAC, Opus, Vorbis, ALAC, MP2, admitted PCM variants | Independently loaded FFmpeg WASM/audio output | Exact codec/config/layout admission; general package also contains unadvertised codecs. |
| DTS / DTS-HD | Separately loaded libdcadec WASM | DTS-HD core decoding qualified; do not claim lossless MA extension reconstruction without a measured matching proof. |
| TrueHD / MLP | Separately loaded FFmpeg WASM | TrueHD PCM path; Atmos object rendering/passthrough not claimed. Real 7.1 title is in the launch matrix. |
| WMA, ADPCM, APE, WavPack and other dormant package codecs | Package code may exist; not advertised as qualified | Server audio conversion until explicitly admitted and qualified. |

| Subtitles | Local route | Limits / fallback |
| --- | --- | --- |
| SRT/SubRip, WebVTT/wvtt | Text parser and clocked canvas, embedded or external | Growing VTT polls honor completeness only on successful responses. |
| ASS/SSA | Lazy JASSUB/libass WASM, attached fonts | Independently licensed assets/sources; exact history failures are visible. |
| PGS/SUP | Streaming selected MKV blocks, PGS bitmap decoder/canvas | Direct-play pixels proven previously; repeat in final app matrix. Header stripping/zlib supported; unsupported encodings remain explicit fallback. |
| tx3g/mov_text | MP4 text decoder and canvas | Local edit-list fixture; repeat source/seek/Off behavior in final pass. |
| VobSub/DVD, DVB, teletext, encrypted/unsupported subtitle encodings | Server conversion or burn-in | No invisible selection or endless retry. |

No CPU-throughput limit is invented here: a device's unsupported configuration,
measured decoder failure/insufficient throughput, missing browser capabilities,
or explicitly unsupported format determines fallback. Native-element/MSE
compatibility remains available for browsers without the core's GPU/decoder
facilities. Report the selected path and reason in the real-app evidence.

## Historical Exact host integration (superseded by Expo)

The original integration used Exact's **app web native-view module**, with a `vela-player`
custom view owning one HTMLVideoElement. Contract owns all chrome. No iframe,
DOM escape in the data module, or change to pinned Exact is required.

## Evidence at Exact 29e5bbd724c7982d906331588fcf869672f9fb46

- `vendor/exact/host/web/native-glue.js:1–24` defines ABI 1: `roster`,
  `create(tag, element, propsJson, event, reply)`, `setProps`, `destroy`.
  The module receives a real DOM element, and can create video and MediaSource.
- `native-glue.js:98–123` creates each view after load and observes replacement
  string props; `:78–95` checks event nonces and dispatches after the current batch.
  Event ordinal 8 is a string `message` for Contract.
- `native-glue.js:159–198` exposes `later(request)` on the page and
  `connect({changed, now})` for native topic subscriptions. This is an alternative
  data-module bridge; it does not give the data module a video reference.
- `vendor/exact/host/web/build.mjs:569–593` emits the native module meta tag;
  `:724–729` copies the app's web module directory and reads its roster.
- `vendor/exact/apps/native-fixture/modules/web/index.js:9–46` is a working
  example rendering into a shadow root with message events.
- `vendor/exact/host/web/module-glue.js:118–122,195–207` isolates app.ts and
  refuses browser I/O/clocks there; `:428` onwards supports Worker placement.
- `vendor/exact/docs/contract-for-agents.md:2968–3000` describes package
  `web.assets`, which copies files but does not itself execute a main-thread
  media engine. The app module is the simpler explicit supported integration.

## Integration and boundary

Bundle `client/player/web-module.ts` as ESM into `client/modules/web/index.js`
with Bun's browser bundler. Register `vela-player` in app.json `modules` (Exact
finds `modules/web/index.js` by convention). Do not import the engine from app.ts.
Place the view underneath Contract PlayerChrome in a sized overlay. Fullscreen
must target their shared parent (supplied through the module's container option).

Props are strings: `session` (JSON PlaybackSession), `playerCommand` (JSON command
with monotonically increasing `id`). Repeated props never repeat a command.
Commands: play, pause, seek(seconds), volume(value), audio(trackId),
subtitle(trackId|null), quality(renditionId|null), lowDelay(enabled), pip,
fullscreen. `message` emits JSON snapshots and errors. Snapshot includes session,
source/seek generations, actual source strategy/backend/rendition, playback state,
position/duration, playable ranges, throughput, track selections and failure.
Observation messages carry the protocol's PlayerObservation; transport/auth are
owned by the adapter, not the view. At most one observation per second; no queue
of historical snapshots. Destroy aborts requests, drops listeners/timers, releases
SourceBuffers/object URLs and clears video source.

SessionController owns identity and cancels work on source, seek, and session
changes; every async continuation checks its token. The segment engine owns
network/append/ABR; UI never manipulates SourceBuffer. Direct files and native
Safari HLS use browser buffering; those paths report unavailable throughput as
null rather than inventing segment measurements.

## Delivery limits

The initial MSE implementation consumes clear fMP4 HLS media playlists with
EXT-X-MAP and aligned independent rendition boundaries. It refuses encryption,
byte ranges, discontinuities and unsupported containers rather than corrupting
playback. Server plans must supply qualified codecs and safe timeline identity.
Separate audio is selected through server-provided complete source variants;
native audioTracks is used when available. No demuxer, DRM, WebGPU decoder,
transmuxing of MPEG-TS or arbitrary release splicing is included.

Prefer direct, then remux, then transcode among browser-qualified sources. Compatible
recovery requires the same media and edition/timeline identity. ManagedMediaSource is preferred on Apple browsers when it supports the plan;
native HLS remains the fallback when managed streaming or the segmented codec is
unavailable. Other browsers prefer their supported MSE ladder.
Fullscreen/PiP require browser support and user activation; asynchronous Contract
commands cannot guarantee activation survives dispatch. Unsupported actions emit
explicit errors. iOS fullscreen can use the video-only platform presentation,
which cannot retain custom Contract chrome; ordinary in-page playback can.

Browser/device coverage is an implementation target, not qualification evidence.
Only an actual media drive can establish decode/recovery; platform APIs alone
cannot establish codec or container compatibility.

## Implemented API

`client/player/model.ts` is the browser command and snapshot contract;
`client/player/protocol.ts` translates `protocol/v0/types.ts` plans and creates
wire observations. The view also accepts `plan` (a JSON PlaybackPlan) in place
of `session`. Older revisions/generations for the current session are ignored.
A command is still processed when the accompanying plan prop is unchanged/stale.

```json
{"id":1,"type":"play"}
{"id":2,"type":"seek","seconds":42}
{"id":3,"type":"subtitle","trackId":"english"}
{"id":4,"type":"quality","renditionId":null}
```

Other payloads: volume `value` (0–1), audio `trackId`, lowDelay `enabled`;
pause, pip and fullscreen have no extra fields. Quality null restores auto ABR;
subtitle null disables captions. Each command id is consumed once per view.

Events are `snapshot` with a `snapshot` object, `error` with a `failure` object,
and `observation` with `sessionId` and a typed `observation` object. Errors use
network/source/decoder/unsupported/action classes. Snapshot fields are declared
in `model.ts`; duration and metrics are null when unobservable. `recovering`
is visible until metadata is accepted; actual progress is only `playing`.
The adapter must send observations to the server and handle generation conflicts;
the engine itself holds no bearer credential. Protocol does not yet describe a
track-specific replacement source; native audioTracks can select an existing
browser track, while other audio changes require a newly negotiated server plan.

Build with `bun run player:build` in client before Exact dev commands. The normal
`bun run build` includes that step. Commit the generated modules/web/index.js
alongside engine edits so Exact's stock web command can consume it immediately.
Native HLS manages its own quality and throughput; manual quality there emits an
explicit unsupported action. Same-source seek on MSE rebuilds the pipeline,
retains seek generation, and does not claim a seamless transition.

Exact reserves `command` as a host attribute. The native view prop is
`playerCommand`; the JSON payload retains its `type` field.

## Manual evidence (2026-11-13)

Engine strict browser TypeScript compilation passed. The one Exact Contract build
reported concurrently edited UI errors (forwarded to the UI owner); it did not
report engine errors. No Exact maintainer checks or test suites were run.

A temporary Chrome page loaded the shipping web-module artifact and drove its
actual HTMLVideoElement. Direct MP4 reached 3.2859 seconds / 84 decoded frames,
zero dropped frames, and no engine errors. A clear fMP4 fixture generated from
Exact's 10-second motion clip exercised MSE (50 seconds, 2-second segments).
MSE reached 3.7018 seconds / 94 frames with accepted buffer through 34 seconds.
Persistent HTTP 502s on the primary caused bounded retries and a visible switch
to the compatible fallback. The corrected resume path retained a 35-second target,
then played through 38.0751 seconds / 79 decoded frames with zero dropped frames
and no engine errors. Throughput stayed null because tiny local transfers are
intentionally excluded from estimation. This was an engine drive, not an
end-to-end authenticated app drive; the mock media generator was not ready.
Temporary browsers, server, fixture and driver were removed after the drive.

The drive found and fixed relative playlist URL resolution, superseded play
promise reporting, teardown of an uninitialized MediaSource, and resume-position
retention when a request fails before the seek target is buffered. Chrome now
advertises native HLS: selection explicitly prefers the MSE ladder there,
while Apple browsers retain the native HLS preference. This evidence does not
qualify Safari/ManagedMediaSource, Firefox, Android, audio switching, subtitles,
PiP/fullscreen, multi-rendition ABR or live playback on real devices.

## Live observations and catch-up

Snapshot `live` is null for VOD; otherwise it contains:

- `edgeSeconds`, `windowStartSeconds`, `driftSeconds`: seconds on the source
  timeline, nullable when unknown. Drift is nonnegative edge minus playhead.
- `edgeSource`: `playlist` (last published segment end), `seekable` (browser's
  current seekable range), `server` (last plan), or null. None is a promise that
  the edge is downloaded or playable; server/playlist positions are observations
  at their last update and are not extrapolated using elapsed wall time.
- `reconnecting`: source recovery or a retry actually observed by the engine.
  Native browser internal reconnects are not observable.
- `delivery`: `available`, `waiting-for-publication`, `segment-delayed`,
  `upstream-gap`, or `unknown`. Waiting means the next sequence is not yet in
  the current playlist when needed. Delayed means a requested segment is being
  retried or has exceeded the greater of its duration and one second. Only an
  explicit publisher EXT-X-GAP tag proves an upstream gap; 404s and stalls do not.
  Native HLS reports unknown because the browser owns these requests.
- `canCatchUp`: a newer usable target exists in accepted MSE buffer or the
  native browser's seekable range. This is deliberately stronger than having
  a server-advertised edge.

`{id,type:"catchUp"}` seeks within the latest usable range, retaining six
seconds in low-delay mode or eighteen in adaptive mode (clamped to the range).
It preserves pause/play intent, advances seek generation, and uses ordinary
seek cancellation/recovery. It reports an action error when no newer usable
range exists. It cannot jump to unpublished or undownloaded MSE media merely
because a server reported a newer edge. EXT-X-GAP triggers visible source recovery.

One Chrome manual drive used the actual mock muxed fMP4 fixture with ENDLIST
removed to model a fixed live publication window. The snapshot reported playlist
edge 60s, playhead 52s, drift 8s and canCatchUp=true. Catch-up advanced seek
generation to 1, retained source generation 0, and accepted playhead 54.021332s
(drift 5.978668s). This checks the live observation/control boundary; it does not
qualify a moving live window, reconnect traces or a physical tuner. The temporary
browser and server were stopped after this drive.

## Authenticated watch drive (Chrome, 2026-11-13)

Real app on `127.0.0.1:3000`, shared mock on `:7777`, signed in through the
`demo` / `vela` form, opened a title and used Resume into `/watch`. The saved
12-second position appeared in both the video and controls. Source changes used
the actual Playback path menu and the server command endpoint; seeks used the
actual scrub input. The ladder was the mock's generated muxed H.264/AAC media.
Times below are browser `performance.now()` differences, not wall-clock guesses.

| Drive / observation | Measured result | Interpretation |
| --- | --- | --- |
| Healthy 6 Mbps ladder | 360p → 540p after 16.00 s of pipeline snapshots; no `waiting` events | Conservative warm-up observed; this includes paused prebuffer time |
| Buffered Play → `playing` | 5.40 ms | Warm start with 31.24 s buffered; **not** cold startup |
| Collapse 6 → 1 Mbps, then restore at +14.00 s | 720p → 540p at +13.45 s, with 24.49 s playable ahead; 360p at +18.64 s, with 23.29 s ahead | Both reductions preceded buffer exhaustion; 0 `waiting`/`stalled` events during the run, 0 dropped frames |
| Restore → higher quality in 60 s fixture | Not observed before all segments were downloaded | Remaining media was already buffered before throughput recovery plus 12 s up-switch hysteresis; longer fixture qualification follows |
| Every second CMAF response truncated | First accepted adaptive buffer after 1.65 s; no engine errors; buffer built through 51.95 s from position 20 | Truncated transfer retried; no corrupt partial append was treated as playable |
| Every CMAF response HTTP 502 | Explicit terminal network failure after 1.23 s from seek marker | Retries exhausted; UI exposed `Media HTTP 502` and stopped source work |
| Offered fallback made unavailable before selection | UI showed `Fallback unavailable` within the 1.87 s observation window | Source stayed direct, source generation stayed 1, position stayed 28; denied media was never activated |

The initial 720p in the collapse trace was selected using the quality menu, then
returned to Auto before the cap changed. Thus the trace demonstrates automatic
protective down-switching, not an automatic ramp to 720p. No test suite or test
harness was added. Instrumentation only observed the shipping engine's emitted
snapshots and the actual video's browser events during the manual drive.

The drive fixed inherited detail-modal sizing (watch explicitly requests fullscreen
presentation), stale-plan early return swallowing server rejection, and repeated
ended observations after the server had closed the session. The cinematic chrome
owns no network requests: its seek/path intents are authorized through the data
adapter; rejected requests retain the current source and show their reason.

### Completed restore qualification on the 180-second ladder

The active scratch alias was independently checked before this trace: direct MP4
reported 180.000 seconds and each media playlist contained 45 four-second segments.
An earlier alias blip exposed old/incomplete files; those attempts were excluded.
The final drive used the standardized `bun tools/dev.ts` supervisor (app :8765,
mock :7777) in explicit mock mode. The initial 720p was selected, then returned
to Auto before the fault, as in the earlier trace.

| Final Chrome trace | Measured result |
| --- | --- |
| Play request → actual `playing` | 0.550 s; initial startup `waiting` lasted 0.441 s |
| 6 → 1 Mbps collapse → automatic 720p → 360p | 2.455 s; 3.805 s accepted buffer remained |
| Restore to 6 Mbps → automatic 540p | 18.615 s; 29.432 s accepted buffer remained |
| Restore → automatic 720p | 39.671 s; 28.365 s accepted buffer remained |
| Rebuffering after first `playing` | 0 `waiting` events, 0 `stalled` events |
| Decoder pressure at final observation | 0 dropped / 2,425 total frames; playhead 100.708 s |
| Engine/UI state agreement | video.paused=false, engine=playing, control label=Pause |
| Idle chrome | header opacity=0 after idle; pointer movement restores it |

This completes the post-restoration qualification missing from the 60-second
fixture. The delay before returning to higher quality was measured rather than
inferred from the ABR hysteresis constant. The top and bottom chrome are absolute
overlays, with track/quality settings in a popover. Browser geometry confirmed
both the native host and actual video occupy (0,0,1200,746), with object-fit contain;
any black letterboxing follows the media aspect ratio, not reserved chrome rows.

### Other trusted host views

`vela-context` emits the runtime page origin; `probe="media"` emits browser-declared
format support from canPlayType/isTypeSupported, not a hardware/throughput claim.
`vela-preview` consumes only an explicitly ready cached URL and future UNIX-ms
`expiresAt`; inactive, offscreen, hidden-document, reduced-motion, SaveData and
expiry states pause and remove the media source. The preview remains transparent
until actual playing, and refusal preserves the artwork. It holds no playback
session or progress telemetry. The UI worker's real broker-grant look confirmed
ready playback and search/covered-home removal.

`vela-install` renders a native trusted-gesture button when the production PWA
runtime reports installable; `pwaAction="update"` renders the explicit update/reload
control only when an update is available. Runtime absence leaves it hidden. Late
runtime availability is observed through the runtime's state event. Install/update
prompts still require actual production/browser qualification by the release owner.

## Manual Firefox / WebKit qualification

Exact's pinned `playwright-core` **1.64.1** drove Firefox **157.0** (revision 1555)
and Playwright WebKit **27.2** (revision 2370) on this Mac. The matching browser
builds were installed once into the shared host cache. Browser processes ran
outside the tool sandbox; app/mock ownership stayed with `bun tools/dev.ts`.
These were temporary manual app drives, not an added test suite.

**Playwright WebKit is not real Safari or iOS.** It exercises WebKit APIs on this
Mac, including ManagedMediaSource here, but does not qualify Apple's Safari UI,
iOS power/background policies, touch/device decode limits, AirPlay or OS PiP.

| Check | Firefox 157.0 | Playwright WebKit 27.2 |
| --- | --- | --- |
| Selected adaptive backend | MediaSource | ManagedMediaSource (actual constructor observed) |
| Initial VOD waiting → playing | 0.237 s | 0.875 s |
| VOD seek and continued progress | Passed, seek generation advanced | Passed, seek generation advanced |
| WebVTT off → English | 4 cues loaded, showing | 4 cues loaded, showing |
| Audio selection | No native audio API: menu honestly absent | Spanish native track `spa` enabled; English restored before the English-only MSE ladder |
| Collapse 6 → 1 Mbps | 720p → 540p after 10.75 s, 18.80 s buffer ahead; then 360p | 720p → 360p after 10.84 s, 10.02 s buffer ahead |
| Restore → conservative up-switch | 540p after 17.70 s; 720p after 33.76 s | 540p after 25.53 s; 720p not reached in the 50 s restoration window |
| Waiting/stalled after collapse | 0 / 0 | 0 / 0 |
| Final decode counters | 0 dropped / 1,689 total frames | 0 dropped / 1,608 total frames |
| Final measured throughput | 4.63 Mbps | 4.06 Mbps |
| Managed streaming lifecycle | Not applicable | 1 startstreaming and 2 endstreaming events observed after instrumentation attached; no false recovery |
| Authoritative pause / resume / end | Passed; terminal source removed and video paused | Passed; terminal source removed and video paused |
| Install/update unavailable in dev | Both hidden and computed display:none | Both hidden and computed display:none |
| Visible path label | Adaptive transcode | Adaptive transcode |

Startup above is the observed video waiting interval, excluding sign-in and page
bootstrap. Rendition times are the first emitted/coalesced snapshots, not an exact
decoder transition timestamp. The two engines shared the same fault schedule,
with the mock's documented per-response cap; this is one local trace per engine,
not a statistical performance claim. Both started at selected 720p, returned to
Auto, and warmed at least 12 seconds of buffer before collapse. The source-stable
adaptation replay followed the track/seek drive; a pass disrupted by the shared
bootstrap fix was excluded from timing results.

The first pass exposed Firefox redacting Resource Timing transferSize to zero.
That is not proof of a browser cache hit: no-store responses and cross-origin
privacy-redacted timings now retain their measured bytes/time samples. Managed
streaming pauses also used to erase up-switch eligibility whenever the buffer
fell below the high-buffer gate. Throughput stability now survives those pauses;
the actual up-switch still requires sufficient buffer and the 12-second guard.

Other fixes qualified here: anonymous CORS media mode for brokered VTT, native
track mapping by exact ID or unique canonical language (never array index),
actual browser-enabled PiP/fullscreen checks, authoritative server pause/end,
and preservation of the presentation position while decoding from the authorized
independent boundary. PiP is unavailable without a decoded frame or after end.
OS floating-window/fullscreen presentation itself remains unqualified here.

The WebKit mobile-viewport look used **390×844**. The video occupied the full
viewport and document scrollWidth stayed 390; paused chrome showed Play and the
real title. Screenshots: `.exact/watch-webkit-mobile-controls.png` (visible paused
chrome) and `.exact/watch-webkit-mobile.png` (playing/idle chrome hidden). Those
are viewport checks, not iOS device qualification.

Relative skip buttons and J/L/arrows now send `seekBy` to the engine, which reads
the actual playhead rather than the coalesced UI position. One focused control
check observed 1.228062 → requested 11.228062 seconds, exactly +10 seconds. Slider
and chapter seeks remain absolute. Ended-state controls do not offer fake replay.

## Real Ether lab drive

Target: `http://192.168.68.65:32550/vela`, Ether `0.3.11-lab.1`, real Chrome,
2026-11-13/14. One stream at a time; no fault injection. Mock/browser qualification
above is separate from these real-server results.

| Installed client / step | Result | Evidence |
| --- | --- | --- |
| 0.1.1 initial load | Failed before sign-in | No API requests; all 26 requests were static assets (HTTP 200). HTTP origin lacks `crypto.randomUUID`; device initialization called it before capabilities. |
| 0.1.1 packaged module graph | Failed: two app instances | Both `/vela/app.js?v=…` and `/vela/app.js` executed; DOM contained two `main` roots. `client/.exact/lab-01-load-failed.png`. |
| Ether console root | HTTP 401 | `GET /` returned an Unauthorized document, without a viewer sign-in form. Quick-connect approval and Watch handoff await a viewer-accessible console route. |

Data fix `9c7c756` uses secure `getRandomValues` IDs and handles unavailable Web
Crypto SHA-256 on HTTP LAN origins. Player fix `bd32218` reuses the same ID helper
for seek and source-switch idempotency keys. Packaging removes the entry URL
identity mismatch in 0.1.2. Further playback requires the corrected package to be
installed: driving two app runtimes could violate the single-stream lab rule.
No authenticated or playback pass is claimed for 0.1.1.

### Installed 0.1.2, first authenticated pass

| Step | Result | Evidence |
| --- | --- | --- |
| Fresh load / password sign-in | Passed | One `main` root; `/auth/sign-in` HTTP 200, `/bootstrap` HTTP 200; viewer identity rendered. |
| Home rows / artwork | Passed for supplied rows and images; hero absent | Real catalogue rows and lazy image grants (`/vela/v0/images/…`, HTTP 200); 37 images decoded in the initial viewport/nearby rows. `lab-02-home.png`. Missing hero left excessive blank space, assigned to UI. |
| Impressions / receipts | Failed | POST `/vela/v0/interactions` HTTP 503, `transient/service_unavailable`, `retry.allowed=false`; 16 signed visible-entry events. Ether identified missing entry-receipt handling. Vela retried rapidly on subsequent visibility events. |
| Sign-out | Failed | Receipt flush failed before revoke, leaving the viewer signed in. Fixed with bounded telemetry retries and logout independent of telemetry in `3a15976`; installation/recheck pending. |
| Title search | Passed | “Avengers” returned real title matches, HTTP 200. |
| Descriptive search / AI honesty | Request passed; no matches | “hopeful stories about found family” returned HTTP 200 and zero items. No AI requests; server advertises AI unavailable. `lab-03-search.png`. |
| Movie detail | Metadata passed; playback blocked | “Avengers: Endgame” detail HTTP 200 in 19.8 ms, 30 cast and six crew entries; `lab-04-movie.png`. `canPlay` omitted, so no Play button or fabricated stream facts. Ether identified absent trusted-peer request context in the permission lookup. |

At this checkpoint no media stream had been opened. Same-viewer approval portal
`/ether/me` was reachable, but quick-connect, show detail, playback, progress,
resume and live remained unqualified pending the blocking fixes. Do not treat
these pending steps as passes.

### Installed 0.1.3 / Ether 0.3.11-lab.2

| Step | Result | Evidence |
| --- | --- | --- |
| Password / sign-out recheck | Passed | Sign-in and revoke HTTP 200; sign-in form restored. One denied telemetry batch, no rapid retry burst. Stale private header after logout was separately assigned to UI. |
| Missing-hero layout | Passed | Blank reserved area collapsed; `lab-05-home-013.png`. |
| Same-viewer quick-connect | Passed | `/ether/me` authenticated as the test viewer, approved this Vela request, and Vela polling returned home. `lab-06-quick-connect.png`; no owner identity used. |
| Real hero / receipts after server deployment | Passed | Hero and artwork rendered; three fresh `/interactions` POSTs returned HTTP 200. `lab-08-hero.png`. |
| Console Vela Watch handoff | Succeeded with client race | Same-viewer console endpoint returned 200, one redeem returned 200, authenticated home appeared and code fragment was cleared. Concurrent source invocations also sent 60 failed redeem attempts. Data fix `7956d15` makes redemption single-flight with a stable key; clean recheck pending. Deployment-window 503s are excluded from steady-state server findings. |
| Show detail | Passed for metadata | “The Gilded Age”: four seasons plus specials, episode list, 11 cast and three crew entries. Show itself correctly reports `canPlay:false`. |
| Movie broker | Passed for authorization / plan creation | “1917”, `canPlay:true`; playback POST HTTP 200 in 3529 ms, ready primary HLS transcode, no offered qualities, four source audio tracks, no offered subtitles. |
| Movie media startup | **Failed** | Broker-issued same-origin `/sessions/media/:session/:token/master.m3u8` returned HTTP 401 and HTML Unauthorized. Video time 0, readyState 0, zero decoded frames, `DEMUXER_ERROR_COULD_NOT_PARSE`. `lab-09-playback-failed.png`. |

The failed movie was the only opened stream and was closed before further client
installation. Seek, track switching, rendered progress, resume and live playback
remain blocked by media authorization, not claimed as passes. No fallback edition
was selected. In-app Close now queues an explicit broker stop before navigating
back; its dedicated root mutation survives route changes. Full browser unload
cannot guarantee delivery of an in-flight authenticated command.

### 0.1.6 / Ether 0.3.11-lab.3 retry checkpoint

Ether fixed the media-route mount in `8019bd952`; previously `/sessions/media`
fell through to Plex bearer authentication. Vela 0.1.6 includes explicit queued
stop (`87a05db`), one stop-only stale-generation retry (`d0aba0d`), single-flight
web-code redemption (`7956d15`), and initial play intent for a new ready session
(`707dba1`). Metadata-ready revisions still preserve an explicit pause.

The fresh retry was blocked **before media**: its single `/auth/sign-in` POST
returned HTTP 503 and the UI displayed “rate limited” (`lab-10-auth-rate-limit.png`).
No playback POST or new session was opened. Ether was asked for the natural reset
and correct error classification; credentials were not repeatedly retried.
The previous failed movie session was independently confirmed expired and closed
by Ether logs. Codec playback, seek, stop acknowledgement, resume and live remain
unverified until an authenticated drive succeeds; installing fixes is not a pass.

### 0.1.6 / lab.3 after the natural auth-window reset

The shared LAN-IP login bucket reset at 03:54:32 UTC. One fresh password action
after that reset returned HTTP 200; no limit was changed.

| Step | Measured result |
| --- | --- |
| 1917 broker / first decoded frames | Broker HTTP 200 in 532 ms; first frames 13,960 ms after Play; native HLS transcode, readyState 4. Media MPEG-TS responses HTTP 206. `lab-11-playing.png`. |
| Seek +10 seconds | Actual 22.816829 → requested/authorized 32.816829 seconds; command HTTP 200 in 55 ms, seek generation 2. Video resumed at the authorized position after 15,173 ms. |
| Progress reporting | HTTP 200 observations with increasing playing positions, including 40.356585 → 42.356186 seconds after seek. |
| Rendering / buffering sample | At 43.404 seconds: 257 decoded frames, 19 dropped. Buffering was observed after seek and near 52 seconds; this drive does **not** establish zero stalls. `lab-12-seek-settings.png`. |
| Track / quality controls | Four source audio tracks advertised, but Chrome exposes no native audio-switch API and server session track changes are unavailable. No offered subtitle tracks or quality ladder. No switching pass claimed. Empty settings popover assigned to UI for removal. |
| Explicit Close | Stop HTTP 200, authoritative `ended` at 52.062166 seconds; local video removed. No second stream before acknowledgement. |
| Reopen / resume | **Failed**: playback POST replayed the same session with original `ready`, position 0. Vela reused its page/title idempotency key across watch openings. Assigned to data worker for stable per-opening identity. |

The replay did not create a new broker session; the original was already ended.
Chrome was closed after recording the resume failure. Live TV and clean
single-flight handoff rechecks remain pending the next installed client batch.

### Installed 0.1.7: resume, skins, and live checkpoint

| Step | Result / evidence |
| --- | --- |
| Profile and production skin switch | Passed. Opened anchored profile menu, switched to Index, browsed real Home and 1917 Detail: `lab-13-profile.png`, `lab-14-index-home.png`, `lab-15-index-detail.png`. |
| Fresh watch-opening identity | Passed: new session rather than replaying the ended session. Initial resume 0 after 52 seconds is correct under Ether's deliberate 5% start threshold (356.9744 seconds for this movie), confirmed from the actual viewer watch row and server state rule. |
| Eligible progress persistence | Chapter 8:20 authorized; real playing observation HTTP 200 at 515.163351 seconds, then stop HTTP 200 `ended` at that same position. |
| Same-page reopen / saved resume | **Passed**. New distinct session, omitted request position, server resume 515.163351, actual decoded playback at 515.338811 (readyState 4, 12 frames) after 15,279 ms. `lab-17-resume-confirmed.png`. |
| Empty settings removal | Passed: zero Playback settings triggers with no switchable tracks/ladder; normal chapter control retained. |
| Live guide | Failed before guide request: authorized channels HTTP 200 contained 100 items, `continuation:unknown`, no cursor. Client correctly rejects incomplete enumeration. Ether confirmed server truncation of a complete neutral channel list and missing guide pagination. `lab-18-live-guide.png`. |
| Reloaded bootstrap | Failed: GET `/vela/v0/bootstrap` with no cursor returned HTTP 409 `conflict/cursor_expired`, after negotiation HTTP 200. Handed to Ether. |

The resumed movie was stopped and acknowledged ended before entering Live. No
channel stream was opened while the guide was blocked. Chrome was closed for
the server fix batch. Live channel and the clean single-flight Watch handoff
remain pending; they are not passes. Earlier startup screenshots show playback,
not proof of resume—the resume proof is specifically `lab-17`.

### Completed real-server drive: 0.1.7 / Ether 0.3.11-lab.4

Ether `cea628e57` repaired real channel/guide pagination and cursorless bootstrap
refresh; no client change was needed for those fixes. The final drive used fresh
real Chrome, one stream at a time, with no fault injection.

| Check | Final result | Evidence |
| --- | --- | --- |
| Password / sign-out / same-viewer quick-connect | Passed | Password and revoke HTTP 200; portal approval as the test viewer returned Vela to authenticated Home. Final sign-out removed all private profile/Live controls. `lab-06`, `lab-24`. |
| Hero / rows / image grants / receipts | Passed | Real server hero, Continue Watching and catalogue rows; image grants and fresh interaction POSTs HTTP 200. `lab-08`, `lab-14`. |
| Search / AI honesty | Passed for requests and displayed results | “space exploration”: fast lane 50 items / 152.506 ms, descriptive lane zero items / 2.010 ms, both HTTP 200. AI unavailable; zero AI requests. Empty descriptive result is not semantic-search quality proof. `lab-22`. |
| Movie / show detail and skins | Passed | Real 1917 and Gilded Age metadata; seasons/episodes/cast/crew; anchored profile and real Index Home/Detail. Stream facts omitted when unavailable. `lab-13`–`lab-15`. |
| Movie play / seek / progress / stop / resume | Passed | Measurements above: 13.96 s first startup; +10 authorized seek; observations 200; stop 200 `ended`; distinct reopened session resumed at saved 515.163 s with actual decoded playback. `lab-17`. |
| Live guide | Passed | 173 channels: page 1 = 100 / `more` + cursor; page 2 = 73 / `exhausted`. Guide = eight programmes / `exhausted` in the selected window. `lab-19-live-guide-fixed.png`. |
| One live channel transport | Passed; **content failed** | BBC News, remux HLS, broker HTTP 200 / 2962 ms; first decoded frames 3436 ms after tune. Playing observations 200 through 35.520 → 36.521 s; stop 200 `ended` at 36.521 s. `lab-20-live-channel.png` captures Pluto-branded first frames, not proof of actual news. The installed 0.1.8 look below identified an unavailable-device slate. |
| Reload after progress changed | Passed | Fresh root navigation and reload both bootstrap HTTP 200, authenticated Home and Continue Watching rendered; no repeat of cursorless 409. |
| Clean console Watch handoff | Passed | Same-viewer console endpoint HTTP 200; exactly **one** redeem request, HTTP 200; authenticated Home and cleared fragment. `lab-23-single-flight-handoff.png`. |

Audio/subtitle/locked-quality switching was unavailable in the real tested plan
and browser/server capabilities, and was not simulated. Movie buffering and a
dropped-frame sample are recorded above; this is not a zero-stall qualification.
Live startup is not end-to-end broadcast latency: the server supplied adaptive
mode without verified live-window anchors, so no live-edge latency claim is made.

The final movie and live sessions each received acknowledged stop before another
session; the viewer was signed out of Vela and the portal, and the dedicated
Chrome was closed. Engine/full-flow evidence here is specifically for 0.1.7 with
lab.4; the installed 0.1.8 UI result and content correction follow.

### Installed 0.1.8 visual result and live-content correction

The UI worker completed the narrow installed look: live controls top 88 / right
36, clear of the wordmark; normal idle state opacity 0, inert true, pointer-events
none. Its playing sample was 33.385272 seconds, readyState 4, 1006 frames, with
HTTP 200 observations and acknowledged stop `{status:200,state:ended,kind:stop}`.
The video was removed, viewer signed out, and its dedicated Chrome closed.

**BBC News content did not pass.** Decoded media was a Pluto unavailable-device
slate, not news. The measured captures show:

- `lab-21-live-controls-018-visible.png`, 2026-11-14 04:27:27.296789 UTC:
  Portuguese ending/availability text.
- `lab-22-live-controls-018-hidden.png`, 04:27:42.782734 UTC:
  “Pluto TV ist auf diesem Gerät nicht mehr verfügbar.”

Channel identity was `ee070ebfa1b4b8fa9ad2`; that UI session ID and exact stop
wall-clock time were not retained. The capture times, transport/stop results and
slate evidence were sent to the Ether worker and coordinator for upstream
provider/device-availability diagnosis. No additional stream was requested.
The earlier unqualified live-channel pass is retracted: guide, transport and UI
passed; actual BBC News content failed and remains an open demo limitation.

Ether's read-only source/history correlation selected a priority-zero Pluto input
from USA TV Next. Its imported URL declares web / Chrome 126 / app 9.1.2; no proxy
headers were supplied, and the backend's default User-Agent is MediaPlayer/1.0,
independent of Vela's browser. At 04:27:05 UTC the upstream returned HTTP 200,
frames decoded, and programme fallback remained false. Health retained outcome
`ok` because sustained frames define success; it does not recognize refusal
slates. These facts explain the transport-success signal, but do not prove the
provider's exact rejection cause. No additional provider request, stream, or lab
mutation was made for that correlation.

### One CHROMA 80 check on installed 0.1.8

The coordinator authorized exactly one virtual-channel attempt through the real
guide. CHROMA 80 appeared normally as channel 1980 with a `Watch CHROMA 80`
control, on the second page of this 118-channel response (100 / more, then 18 /
exhausted). The single tune returned HTTP 200, session
`LHWIHS43Y22HBSDLVWW6WZ2BY7`, channel `showcase-chroma-80`, ready adaptive HLS
remux. First decoded frames were observed at 20,419 ms: readyState 4, paused false,
four frames, time 0.012943. The title was `CHROMA 80 · Big`; chrome simultaneously
retained `DEMUXER_ERROR_COULD_NOT_PARSE`, so this was not a sustained-play pass.

Before sustained playback/content inspection and the requested screenshot, the
dedicated playwright-cli browser unexpectedly reset to `about:blank`. Its daemon
error log was empty. No further stream was opened; Chrome was closed. Ether was
asked to confirm playing observations and stop/expiration, and to clean up only
that identified session if necessary. Browser reset cause is unproven.

This attempt does **not** qualify real programme content, a playing observation
200, clean Close/stop acknowledgement, or explicit sign-out. The requested
`lab-25-live-chroma80.png` was not produced; no other screenshot substitutes for
it. See [live-tv.md](live-tv.md) for the focused status. A further tune requires
the coordinator's clearance under the one-attempt constraint.

Read-only Ether correlation subsequently found the sole matching Vela tune's
resources released at 04:36:18.941 UTC (age 53.613 seconds; ready, media requested,
media delivered and viewer reservation released), and its channel broadcast
stopped at 04:37:18.962 UTC. No cleanup mutation was needed for those resources.
These log lines do not prove a playing observation or HTTP stop 200; current
public broker-session state correlation remains with the coordinator.

## Real Ether quality follow-up: source analysis, no new streams

Revision inspected: Ether `cea628e57` (lab.4), using `git show`, and the coordinator's
redacted `vela-lab/vela-1917-session.log`. No media/provider GET, stream, server
change or new browser run was performed for this investigation.

### Mechanism decision: broker fMP4, not client TS transmuxing

Prefer Ether's existing fragmented-MP4 HLS output. Source evidence:

- `internal/frontends/vela/playback.go:143–148` builds the direct-play profile
  but fixes the HLS transcoding profile to `Container:"ts"`. `:224` constructs
  the single primary path with `qualities:[]`. This prevents Vela's MSE ladder
  from being selected even though the broker may expose variants.
- `internal/sessions/media.go:642–687` generates master variants from the real
  ladder: bandwidth, optional average bandwidth, resolution, RFC 6381 CODECS,
  frame rate and per-rung media-playlist URLs. It emits no audio/subtitle
  `EXT-X-MEDIA` groups. `internal/transcode/ladder.go:38–50,155–218` defines the
  conditional 1080p8m / 720p4m / 480p1500k / 360p800k rungs below the base.
- `internal/transcode/args.go:928–950` already emits `-hls_segment_type fmp4`,
  an initialization file and fragment clock options; the alternate branch
  emits MPEG-TS. `internal/transcode/playlist.go:64–90` emits version 7 and
  `EXT-X-MAP` when an init segment exists, version 3 for TS. This establishes
  fMP4 support, not comprehensive CMAF conformance for every codec/timeline.
- Captured 1917 responses were MPEG-TS (`video/mp2t`, HTTP 206); encoder logs
  explicitly select MPEG-TS, H.264 VideoToolbox and AAC stereo. Base output
  requests 2160p/40 Mbps; ladder encodes use 4-second keyframe/segment targets,
  while initial/base runs show 2-second targets. Master codec generation is
  `internal/transcode/hls_attributes.go:12–85` and `dash.go:245–280` (e.g.
  H.264 High 5.1 `avc1.640033` for the 2160 base, AAC `mp4a.40.2`). Exact
  served CODECS strings, all variant EXTINF values and master text were **not
  retained**, so these are source-derived output contracts, not captured bodies.

Vela currently consumes clear, continuous fMP4 **media** playlists, not arbitrary
masters: `player/hls.ts:3–29` requires `EXT-X-MAP`, rejects encryption, byte ranges,
master tags and discontinuities. `pipeline.ts:115–139` opens the server-qualified
rendition URLs; `engine.ts` chooses native HLS when no supported ladder is offered.
Therefore Ether must publish the real variant list through `PlaybackPath.qualities`
as well as selecting fMP4. Merely changing the master container is insufficient.
Native HLS still produces position/range/frame observations and session recovery;
client throughput estimation, ABR and abandonment are the bypassed pieces.

### Startup: measured limits and source decision

| Evidence | Timing / meaning |
| --- | --- |
| Original NRQ movie drive | Click → first frames 13.960 s; plan response 0.532 s. The remaining 13.428 s is aggregate client/media startup, not measured encoder time. |
| Browser first-byte / first-segment publication for NRQ | Not retained. Cannot honestly split transport, publication, native buffering and decode from that total. |
| Later F7 run, coordinator log lines 1–17 | Playback source starts 23:03:36.291 EST; transcode session .299; first ffmpeg .320; segment-0 fetch .347; selected 360 rung restarts ffmpeg .370; first segment ready / ready-to-send 23:03:37.128 (~0.78 s after fetch). |
| Same F7 run, lines 17–46 | Segment-1 fetch 23:03:37.140; base-rung restart 23:03:44.398; ready-to-send 23:03:46.857 (9.717 s wait); segment 0 requested again, ready 23:03:49.144 after another restart. Server readiness is not browser TTFB. |
| F7 browser measurement | 13.304 s initial first-frame measurement, separate from NRQ's 13.960 s. Clock alignment to individual server events is not sufficiently retained for a precise first-byte/decode split. |

The selected source was a ~73.6 GB MKV UHD remux with HEVC Dolby Vision profile 7
and TrueHD 7.1. The log explicitly states client rejection of MKV/HEVC/TrueHD,
SDR tone mapping and AAC stereo conversion. For that source/profile, transcode
is justified; this is not evidence that a compatible H.264/AAC MP4 could never
direct-play. The adapter passes `DirectPlay:true` (`playback.go:112`) and maps the
chosen decision to direct/remux/transcode (`:201–224`), but exposes only that
decision. Investigate the log's additional “direct play not allowed by client”
reason against the normalized capability profile rather than guessing a cause.
The repeated serial-encoder rung/base restarts are a concrete latency concern
(`transcode/ladder.go:11–23` documents one active encoder); short first segments
alone do not remove that work or native-player startup buffering.

### CHROMA error diagnosis and client fix

The captured coexistence of four decoded frames and failure chrome does not
prove whether the original parse error was transient, malformed media or a prior
attachment event. No retained CHROMA manifest or generation-tagged event trace
establishes that cause. The later browser reset is a separate unknown.

Confirmed Vela races were fixed in `19417a7`: listeners were global, recovery
could fail after its 300 ms delay even if media had resumed, `play()` could report
playing without clearing failure, errors lacked session/generation identity,
and presentation accepted old-generation snapshots. Media listeners now belong
to the attachment generation; current error-free playback cancels delayed
recovery; terminal failure unloads media and cannot be revived by late playing
events; error/snapshot presentation is generation-scoped; state changes publish
immediately. Failure teardown preserves the last position. This fixes client
consistency, not a demonstrated underlying media parse defect.

Preparation UI now distinguishes “Requesting playback session”, “Waiting for
media metadata”, “Buffering initial media” and “Starting playback”. These are
observed client stages, not assertions that an encoder is running or a segment
has published. Broker-side stage text needs an authoritative stage event.
Bundle + Contract/type-check passed. No new lab/browser verification is claimed;
it requires coordinator clearance.

### Consolidated Ether request

1. For MSE-capable Vela clients, select the existing fMP4 HLS output instead of
   forcing TS. Accept `client.mse` independently of native `client.hls` in the
   DirectStream/profile/transport gates (`playback.go:112,145,202`); Vela's probe
   intentionally distinguishes native HLS from MSE. Otherwise a Firefox client
   with MSE but no native HLS is rejected before it can use this pipeline.
   Return every actual rendition in `PlaybackPath.qualities` with
   scoped media-playlist URL, bitrate, dimensions and exact encoded RFC 6381
   video/audio codecs. Preserve native HLS fallback. Supply sanitized real master
   and variant fixtures proving `EXT-X-MAP`, independent aligned boundaries,
   continuous decode timestamps, actual EXTINF durations and correct MIME types.
   Declare byte ranges/encryption/discontinuities if needed: Vela does not yet
   support them. Confirm CMAF compatibility separately from fMP4 availability.
2. Preserve direct-play preference for compatible codec/container/profile and
   policy; choose copy-only remux when only packaging requires it, audio-only
   conversion when necessary, full video transcode only with an explicit reason.
   Expose selected source facts and rejected-path reasons. Resolve the observed
   direct-play rejection against normalized profile/options. Avoid starting an
   expensive 2160p/40 Mbps base just to cancel it for a startup rung; preserve one
   shared segment clock across base/rungs and avoid restart/throttle stalls when
   switching. Use short independently decodable initial segments when encoding,
   then steady segments; keep advertised durations/keyframes truthful.
3. Add correlated, generation-scoped timestamps/stages for source resolution,
   decision, encoder launch, init ready, first segment publication and first byte
   served; return meaningful preparing/readiness through session events. Client
   captures will add manifest/segment responseStart, metadata and first-frame
   times on the next cleared drive. Do not label publication as playable buffer.
4. Publish stable audio IDs/languages/labels/defaults and actual output codecs;
   alternate fMP4 audio playlists via master AUDIO groups plus typed group/URL
   association to each rendition. MSE needs separate audio-buffer/selection work
   in Vela; emitting a master group alone does not implement it. Alternatively
   enable authorized session track changes with new generations and compatible
   timelines, preserving position and preference. Expose scoped WebVTT tracks
   (and SUBTITLES groups if supplied by master); PGS image subtitles cannot simply
   be relabeled WebVTT—offer explicit burn-in/new generation or report unsupported.
   Keep sessionTrackChanges false until actually implemented.
5. For CHROMA's parse event, supply retained sanitized playlist/segment metadata
   and error/publication sequence keyed to public session/source/seek generation;
   confirm that a ready master never serves HTML, truncated init/TS, or mismatched
   codec/segment timelines. No new stream/provider request is authorized by this
   ask. Client consistency fixes need one separately cleared post-package drive.

### Installed 0.1.9 urgent startup correction

`2172ae3` resolves native HLS masters once and pins their first-listed variant.
Ether confirmed this is the producing base rung; it does not choose the lowest
rendition. Native ABR can no longer restart the serial encoder by hopping among
the master variants. MSE holds its initial rendition until a healthy startup
buffer, uses expensive-transcode hysteresis, and preserves the next sequence and
timeline anchor on abandonment. New initialization bytes precede switched media.

The initial wanted-play state stays loading/buffering instead of publishing a
spurious pause. Autoplay refusal retries muted once, then exposes an error.
Startup has a 45-second deadline, subsequent no-progress waits 30 seconds, and
fallback authorization 15 seconds. Failure unloads media and offers Retry rather
than waiting forever. Volume/mute persist locally; M and up/down control them.
Cinematic chrome adds a real waiting spinner, volume/mute controls and one
subtle path/quality readout (`4788995`, `c2a186f`).

Purposeful local mock drives, with no lab stream:

- TS master: progress beyond two seconds in 2.821 s; only first-listed ts360
  resources, monotonically seg-000 through seg-022 over ~79 s. Observations
  buffering then playing HTTP 200, no startup paused reports.
- Muxed fMP4 MSE: readyState 4, 55 frames at 2.168 s, 31.957 s buffered; loading
  → buffering → playing, no paused reports. Explicit 540p switch fetched new init
  then seg-021, not seg-000; position advanced 51.225 → 54.002 without rewind.
- WebVTT loaded four cues in showing mode over MSE. A new engine restored volume
  0.37 and muted true.
- A per-request 60-second stalled manifest progressed loading → recovering →
  failed. Its selected fallback command was deliberately not forwarded by the
  isolated driver, so the final bounded error was “Source switch authorization
  timed out”; waiting false, src cleared, paused true. This verifies teardown and
  bounded fallback, not a measured 45-second first-frame timeout.

Mock sessions stopped with HTTP 200/ended, the mock grant was revoked, and the
dedicated browser closed. The UI worker's supervisor was left under its owner.
Ether confirmed client-only 0.1.9 installation (43/43 file hashes, app/SW HTTP
200), with lab.4 server unchanged. No owner-session or lab playback was opened
for qualification; real Other Mommy/MobLand validation remains with the owner.

### Absolute seek clock and immediate target (0.1.12 source)

The chrome now reads `snapshot.seekTarget` while an authorized seek is pending;
`position` and observation reports retain the real playhead. The target is
published before the command leaves the engine, with buffering/waiting enabled.
The target clears when the authorized generation resumes (or a paused seek
finishes); rejection, deadline or terminal state clears it with an honest result.

`PlaybackPath.timelineOriginSeconds` is the absolute title time corresponding to
native HLS presentation time zero. Native currentTime, buffered ranges and media
duration are translated at the engine boundary; direct files retain origin zero.
For older Ether VOD plans without the field, an origin is inferred only when the
finite ENDLIST playlist duration plus requested position matches the known title
duration within 250 ms. Otherwise origin remains zero. MSE keeps original fMP4
decode timestamps; only playlist segment scheduling is anchored to the explicit
origin. It does not apply a second SourceBuffer timestamp offset.

| Local manual check (2026-11-14) | Measured result |
|---|---|
| Direct mock seek, actual playhead 15.886 s → target 80 s | Immediate snapshot target 80, state buffering, waiting true; actual position remained 15.886 s |
| Authorization and reconciliation | Command HTTP 200; subsequent playback at 92.630 s, target null, waiting false |
| Cleanup | Both owned mock sessions stopped HTTP 200; owned Chrome closed |
| Offset native fixture simulation | Altered TS and fMP4 playlists failed native demux before frames; no native offset playback pass claimed. Real Ether qualification remains pending clearance |

The engine browser module type-checks and bundles. The shared Contract build at
this point was blocked by concurrent guide schema edits (`GuideTick.offset`,
`GuideModel.showNow/nowOffset`); no guide code was changed by playback.

Read-only Oak Street evidence (`oak-street-0800.log`, coordinator capture): all
requests stayed on track 0, with no early player-paused report. Initial segments
were produced in 0.854 s and 0.933 s; the ramp restart took 2.086 s for segment 2
and 5.514 s for segment 3, then 1.167 s for segment 4. The first ahead=5 throttle
was later, after that production wait. These server production waits can explain
buffer pressure; the capture does not include browser buffer/transfer timings
needed to attribute every visible stall. The source was 1608p/40 Mbps HEVC DV8,
converted to H.264 SDR/AAC. No client ABR rung churn is present in this run.

The same log confirms a separate seek-clock defect: a broker offset of 1433.5 s
was also applied as native currentTime, leading to a segment around 2865.5 s.
The origin translation above removes that double application. Ether's matching
ask is to emit the actual offset on every initial/seek/track-restart path and
retain original title timestamps for MSE fMP4. A lighter capability-driven SDR
base and shorter production waits remain Ether-side work; no new lab stream was
opened for this analysis.

### Separate MSE audio qualification

The optional delivery descriptor is `PlaybackPath.audioRenditions[]` containing
`{trackId,groupId,url,mimeType,bitrate?}`, paired with a video's
`Quality.audioGroupId`. Such qualities carry video-only media and omit
`audioCodec`. The pipeline creates a distinct audio SourceBuffer. It prefetches
replacement audio before removing the old buffered tail at a shared future
segment boundary; the video buffer and playback clock remain intact. The current
track remains selected until that boundary becomes audible; `pendingAudioTrackId`
(and PlayerView.pendingAudioId) exposes the choice in flight. Prefetch failures
retain old audio; append failures enter visible source recovery. Descriptors are
not fabricated for muxed paths or unavailable audio.

Chrome local mock `transcode-mse` drive (2026-11-14):

| Check | Measurement |
|---|---|
| Actual separate buffers | Two SourceBuffers; backend MSE, audio-en initially playing at 10.387546 s / 252 frames |
| English → Spanish at aligned future boundary | audio-es active by 22.816704 s / 550 frames; pending null; same video SourceBuffer and MediaSource; source/seek generations unchanged at 1/1 |
| WebVTT on MSE | sub-en loaded four cues, text track mode showing |
| Errors and continued progress | No engine error in the drive; Spanish still active at 59.309160 s |
| Cleanup | Stop HTTP 200, state ended; mock grant revoked and owned Chrome closed |

This is local fixture qualification, not a real Ether alternate-track pass.
Ether currently plans to omit separate audio groups until it genuinely packages
them; its alternative is an authorized generation-changing tracks command.
At that qualification point, pending-codec qualities still required the client
integration recorded below; they must never be interpreted as verified tokens.

### Pending codec preparation (paired Ether playback branch)

The client now supports the lazy encoder contract agreed with Ether
`w0311/vela-playback` through `23c664a8e` (including `0f1e8dd3e`). An advertised
quality is a real scoped resource, but `codecStatus: pending` or an empty
`videoCodec` is not a usable codec claim. Startup honors `initialRenditionId` or
the first advertised eligible rung. It fetches that media playlist and exactly
one init, which starts that rung only. It does not probe other pending rungs or
fall back to native HLS merely because exact codecs are not available yet.

The selected init GET has a 50-second deadline, aligned with Ether's 45-second
production wait. Its bytes are retained while the pipeline waits up to two more
seconds for exact init-derived codecs in the latest plan. An earlier event is
retained too. Reconciliation requires the same session/source/seek generations,
rendition ID and URL. After 500 ms without verification the engine emits
`session-refresh`; Contract restarts its session resource, obtaining a fresh
snapshot before reconnecting SSE. There is one refresh per preparation attempt.
Cancellation/stop aborts all of this. The enclosing first-frame deadline is
60 seconds for pending startup; already-known startup remains 45 seconds.

Only verified codecs accepted by `MediaSource.isTypeSupported` create a
SourceBuffer. `snapshot.qualityIds` exposes the verified compatible rungs; menus,
manual quality commands and ABR use this set. A newer plan updates the existing
pipeline's ladder without resetting the media, buffer or playhead. Other pending
rungs remain hidden until their own init was genuinely produced and verified.
Missing or unsupported verification fails explicitly rather than waiting forever.

Local Chrome/mock opt-in fixture `4269ed1`, 2026-11-14 (no lab streams):

| Check | Measured evidence |
|---|---|
| All qualities initially pending with empty tokens | Initial qualityIds empty; only v360 playlist/init/segments requested by the engine |
| Exact codec arrives over SSE | Plan revision 2 at 272.7 ms; first SourceBuffer at 325.8 ms, after 360p was verified; MIME avc1.64001f + mp4a.40.2; playing at 17.352 s |
| Unprepared 720p command | Rejected with “Rendition codec is not verified and playable”; no 720p resource request |
| Another rung becomes ready | Driver explicitly fetched mock v540 init; newer plan exposed 360p + 540p, preserving the same SourceBuffer, MediaSource and generations 1/1 |
| Verification never arrives | Explicit failed state “Codec verification did not arrive after initialization”; zero SourceBuffers, one refresh request |
| SSE deliberately absent | One snapshot refresh recovered verified 360p; SourceBuffer created at 611.3 ms; playback reached 18.024 s / 435 frames, no failure |
| Cleanup | All three owned mock sessions stopped HTTP 200; final ended state confirmed, mock grant revoked, owned Chrome closed |

The player browser TypeScript and shared Contract build passed. This is paired
source readiness for the full Ether branch, not a real-server playback pass; a
new client package must be installed before deploying pending-codec output.

### Ambient live tile

Set `ambient="true"` when creating a `vela-player` view. This is an instance
option: unmount it and create a separate ordinary view for full watch. The video
starts muted (including its defaultMuted attribute), reads no persisted volume
or mute preference, and never writes those preferences through media events or
commands. A normal mute command with value `"false"` unmutes this instance in
place. Volume changes are likewise local; snapshots and observations retain the
usual shape and truthfully report its actual audio state.

The guide owns tuning, visibility and stop authorization. Destroying the native
view releases its local media work; the guide must also obtain a broker stop
before another stream opens. Ambient mode retains the server's initial rendition
recommendation: choosing a lower rung could start another expensive encoder.
`vela-context probe="network"` emits a JSON string `{saveData:boolean}` once,
using `navigator.connection?.saveData === true`. The guide can gate session
creation before tuning; absent browser support reports false, not a promise of
unmetered connectivity.
Local Chrome check: ambient started muted/defaultMuted=true, made zero preference
reads/writes through mute and volume commands, and unmuted in place; an ordinary
instance still loaded saved volume 0.4/muted=false. Network probe returned
saveData=false. No session was opened; all created views and Chrome were closed.

## Universal Player adoption

Owner decision: original-file client demux/decode/WebGPU presentation becomes the
preferred eligible route. The existing HTML/MSE/native HLS engine remains a
fallback. This supersedes the earlier optional-only research recommendation.
The interface to Contract remains session snapshots, commands and observations;
capabilities and failure reasons must describe the actual selected backend.

First adoption milestone pins the independent MIT engine as an unmodified source
submodule at `vendor/webgpu-player`, commit
`a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2`. The licence is reproduced in
THIRD_PARTY_NOTICES. The Jellyfin plugin is not adopted. Source presence alone
does not enable the route or advertise universal decode capability.

Evidence and boundaries at this revision:

- `src/demux/CustomDecodeMediaSource.ts:1` defines URL byte-range or local File
  input; seeking/demux belong to the pinned Mediabunny fork. The controller's
  audio/video track indices are container ordinals, not FFmpeg stream indices
  (`src/capability/CustomPlaybackEligibility.ts:423`). Vela must match tracks,
  never equate those indices by coincidence.
- `src/pipeline/CustomPlaybackControllerTypes.ts` provides audio output factories,
  package selections, decoded PCM layout and clock. Reuse the complete upstream
  audio path; the audio worker owns Vela's package registry and output policy
  under `client/player/universal/audio/`, not a duplicate mixer/worklet.
- `src/pipeline/CustomPlaybackFrameLoop.ts` presents frames against the audio
  clock and returns bounded decode credits. Preserve its ownership/lifetime
  semantics; decoded GPU frames must never leak across source/seek generations.
- `src/presentation/PresentationSetup.ts` owns colour-route authorization and
  `src/presentation/WebGPUPresenter.ts` rendering. Dolby Vision and HDR claims
  require a qualified route, actual package assets and supported profile; they
  are not inferred from a filename or WebGPU existence.
- `scripts/library-assets.mjs` and `docs/src/embedding.md` require four built
  workers, libdovi RPU WASM and audio output-stage WASM. The engine is not a lone
  JavaScript drop-in. Decoder packages are independently loaded; the forked
  Mediabunny and LGPL packages keep their notices and corresponding source.
- `docs/src/formats.md` / `docs/src/architecture.md` qualify direct VOD only.
  Incremental live TS, HLS adaptation and subtitle overlays are Vela integration
  work. Do not advertise these as universal until implemented and measured.

Broker wire agreed with Ether: optional negotiated
`originalPlayback={version:1,range:true,demuxContainers,videoDecoders,audioDecoders,webgpu}`.
Arrays describe installed decoder families, not exact-profile or real-time
promises. A ready direct/file path carries `original:true,range:true`, source
identity and optionally byteLength. HTTP must provide untouched bytes, bounded
206/Content-Range, 416 and validators; a changed original invalidates retained
bytes. Existing scoped grants and viewer/policy rules apply. Fallback uses the
existing generation-authorized `switch` command at absolute title position,
preserving edition and tracks. Grant refresh must preserve the source identity;
its URL renewal handoff remains to be finalized with Ether.

Exact-profile WebCodecs probing and package availability precede original route
admission. Unsupported decode/presentation falls back explicitly rather than
claiming that every device decodes every format. Subtitle PGS/ASS and software
fallback coverage are separate qualification milestones. Audio failures must
not be converted to silent playback success.

Ether already supplies a publicly trusted plex.direct HTTPS origin on the lab;
`secureOrigins` discovery is being added. WebGPU, WebCodecs and AudioWorklet
qualification must use that origin, not the lab's plain HTTP address. No new lab
stream is authorized by source adoption or capability probing.

Runtime asset build: `bun tools/player/prepare-upstream.ts --bootstrap` initializes
only the required Mediabunny submodule, installs the pinned engine dependencies
and scratch-local Emscripten, then compiles WASM and workers. Later invocations
omit `--bootstrap`. Output defaults to `client/modules/web/universal/` and can be
changed with `--out=<absolute-directory>`. The generated asset manifest pins the
source revision and content key; exact MPL fork source and notices accompany the
separately loaded workers. This does not yet switch the native view to WebGPU.

First asset build completed with content key `91f8cfddc70b7353`: four workers,
libdovi parser, audio output stage and qualification vectors assembled; the Vela
preparation command ran successfully and copied exact MPL source and notices.
Chrome on the lab's HTTPS identity page reported secureContext=true, a real
WebGPU adapter, VideoDecoder, AudioDecoder and AudioWorklet, with maximum output
channels=2. This was capability-only: no viewer login, media fetch or stream.
The owned browser and AudioContext were closed. No decode/render performance,
HDR correctness or physical multichannel claim follows from this API probe.

### First original-file native-view milestone

The native view now owns a separately loaded `UniversalRuntime` for an explicitly
marked original file on a secure WebGPU/WebCodecs platform. It demuxes via the MPL
fork with strict ranged responses, bounded retries, cache/read-ahead budgets,
exact private WebCodecs configuration and actual source colour/sample-rate facts.
The upstream controller, presenter and AudioWorklet own decode, presentation and
audio-master timing. Existing commands/snapshots retain their shape; backend is
`webgpu`. Late session/seek work is cancelled, startup is bounded, and fallback to
an advertised on-demand path is an authorized broker switch, never a fetch of an
unready URL. Both supported server switch-generation conventions are reconciled.

This milestone DOES NOT advertise originalPlayback during negotiation yet.
Video package admission is wired but not yet device-qualified; in-player audio
switching has the focused full-controller result below. Subtitle overlays and live TS remain unfinished. Unsupported selected subtitles require a compatible fallback;
menus do not pretend an original overlay exists. PiP is not offered for the custom
renderer. Fullscreen uses the actual containing surface. Legacy playback remains
available and is the shipping default until the original route is qualified.

Local qualification (2026-11-14), fixture `546c3a8`: actual eight-second 640x360
24 fps H.264 High/level31 + AAC48k/stereo, tagged BT.709/limited range. Metadata was
verified with ffprobe, and the same bytes came through the mock broker grant.
The driver supplied the fixture plan explicitly; this was the real native-view
bridge, but not an end-to-end negotiation or a real-library title.

| Measurement | Result |
|---|---|
| Selected engine / source | WebGPU, direct original, source/seek generations 1/1 |
| First GPU-submitted frame from trusted Start click | 830.6 ms |
| Rendered file | 192 decoded and 192 presented frames; natural end at 8.0001 s, duration8 s |
| Controller timing vs audio-master clock | Late frame count0; worst frame lag13.151 ms; clock reset count0 |
| Failure | No engine error; no server transcode |
| Cleanup | Broker stop HTTP200/ended, grant revoked, owned Chrome closed |

This is a short software-timing qualification, not a physical lip-sync, human
listening, HDR, 4K, multichannel, CPU/GPU utilization or long-run recovery result.
Terminal snapshots now preserve the captured frame counters when releasing the
custom renderer, rather than reading zero from the unused HTML video afterward.

The first private-asset overlay attempts did not play. Root cause was proven with
no-media workers: this Chrome routed a top-level worker and its fetch through
Playwright page.route, but a nested worker load bypassed it (parent route called;
child route never called; child load error). The adopted decoder spawns a nested
audio worker. Serving all workers/WASM over real same-origin HTTP fixed startup;
real worker bootstrap and WASM HTTP200/application/wasm/compile were verified
before the single approved playback retry. Do not use a page routing overlay as
an engine asset server. The earlier untagged MP4 correctly failed colour admission
and was not re-labelled SDR just to pass the drive.


### Original decoder admission and source scan facts

The host now keeps exact-file native decode rejection separate from generic
capability vectors. A rejected private WebCodecs configuration cannot be rescued
by a passing baseline vector. Native routes remain preferred; if unavailable,
the runtime lazily loads only the selected codec's independently served package,
verifies its pinned SHA-256 and manifest, then asks the upstream presenter and
eligibility selector for a compatible format/profile/device-buffer route. Package
absence, incompatible profiles or device limits take the existing authorized
fallback path. These upstream video packages use WASM parsers and WGSL GPU decode;
they are **not** a general FFmpeg software-video decoder. There is no packaged
H.264 or VP9 fallback in this pin. This is admission code, not a measured HEVC,
Dolby Vision or performance qualification.

Install the video modules and complete release source/licences with
`bun client/player/universal/video/install-packages.ts <prepared-directory>`.
The asset assembler accepts `--video-dir=<prepared-directory>` and rechecks module
pins before copying them alongside the separately loaded runtime. Audio keeps its
own installer and corresponding-source payload. Both installers support verified
prepared input; build output never silently advertises missing decoder modules.

Broker `originalVideo.isInterlaced`, `fieldOrder` and signed counterclockwise
`rotation` are preserved. Actual demux field order may supplement omitted facts;
positive broker SPS interlace evidence wins over a container progressive flag.
Mediabunny's nonzero clockwise rotation is converted to the wire's opposite sign;
an identity/default matrix does not manufacture a broker rotation fact. Dolby
Vision raw admission requires explicitly known progressive video. This upstream
pin rejects nonzero rotation and separate-field HEVC; those cases fall back rather
than displaying an unrotated or incorrectly woven picture. Rotation transforms
are still work to do.

Original audio switching prepares against the complete advertised/demuxed ordered
inventory, exact codec/private configuration, rate and layout before touching the
controller. Only a successful started result commits the UI's selected ID. A
pending ID reaches the existing skin spinner; seek/dispose cancels preparation,
and a superseded session cannot publish its selected track. Upstream re-primes
both decode generations at the current audio-master time, retaining the same
original URL/session; it does not promise uninterrupted video frames. Universal capability advertisement remains disabled pending video-package, HDR,
subtitle and broader source admission qualification.


Focused native-view audio/seek drive (2026-11-14): real same-origin HTTP assets
and an eight-second tagged BT.709 640x360 AVC Matroska file. The first audio stream
was actual TrueHD48k/5.1(side), the alternate AAC48k/stereo. Synthetic tones,
not Atmos or a 7.1 claim. The proxy's mock API was unavailable before playback,
so the driver supplied an explicit diagnostic plan and a later authoritative seek
revision. This proves the native view/controller and ranged file path, not broker
negotiation, source authorization, progress persistence or server seek handling.

| Measurement | Result |
|---|---|
| First GPU-presented frame after trusted Start | 688.5 ms |
| TrueHD bed through package → PCM → AudioWorklet | 6 source channels → stereo output; clock advanced to1.20604 s; 75,840 submitted PCM frames |
| Audio switch to AAC while paused | 21.8 ms to started; position1.20604 s before and after; pending then selected ID reported correctly |
| AAC playback after switch | Advanced to2.2086 s; 54 presented frames; no engine error |
| Seek to4 s | Target4/buffering exposed immediately; diagnostic seek-generation2 plan resumed to5.003177 s |
| Output resilience counters | Underflow/overflow/dropped PCM frames0 at measured TrueHD, AAC and post-seek samples |
| Video vs audio-master timing | Worst lag5.943 ms TrueHD,8.783 ms after AAC switch,3.348 ms after seek; late count0; clock reset count0 |
| Cleanup | Native view destroyed, dedicated Chrome closed; owned diagnostic server stopped by audio partner |

These are short software timing and queue counters, not human listening, physical
A/V drift, surround speaker mapping or CPU/GPU utilization. The post-end capture
`client/.exact/universal-audio-switch.png` shows the cleared surface; it is not
video-content evidence. The drive exposed upstream frame-count
reset on internal audio decode restart; Vela now accumulates those counters within
the same protocol playback generation so observations do not regress33→1.

### Opt-in original-player beta

The device preference is `vela.player.beta`, off by default. The hidden
`vela-context probe="beta"` publishes the literal `true`/`false`; a `betaPlayer`
string prop persists a user choice. `probe="media"` subscribes to changes and
re-emits capabilities. The UI applies it to subsequent playback, leaving the
current session intact. HTTPS/WebGPU/AudioWorklet absence or missing installed
assets leaves the legacy declaration active, even if the preference is enabled.

Only beta-on plus an actual WebGPU adapter and the verified asset build's
`originalPlayback` declaration adds that field to negotiation. The declaration
names installed families, not exact profiles or real-time guarantees. Local
Chrome capability-only drive passed off→on→off: absent field, present version1
installed-family declaration, absent field again; persisted final choice false.
No media or lab session was opened for that check.

A decode-failed callback can replace the local decoder once at the current audio
clock without changing broker source/seek generations: software audio is prepared
when available, and a matching GPU video package replaces a rejected native
route. This retry is bounded per pinned source/seek. Range, source, network and
policy failures skip repeating the same original. Exhaustion requests the
advertised on-demand Ether HLS path through the authorized switch command, at the
preserved absolute position and pinned edition. If the server or network cannot
supply any path, the bounded failure state and Retry remain honest; beta does not
promise playback of unavailable content. The local retry code is compiled but
has not yet been fault-driven end to end. Native H.264/VP9 have no alternative
video package in the reviewed release and therefore cannot gain an invented
software-video retry.

Installed0.1.25 was checked by the packager: it contains no universal/runtime
assets. A lab qualification therefore needs a complete matching same-origin
host+runtime+workers+decoder/source payload before opening the first original
stream. No Playwright page routing overlay is used for those assets. Common SDR
qualification precedes beta packaging; HDR/DV7, subtitle overlays, rotation
rendering and live are follow-up gates, not claims of this beta.

### First real original beta attempt — lab HTTPS, 2026-11-14

One owner-idle Street Fighter (2026) session used the standalone same-origin
host/runtime; installed app shell0.1.25 stayed unchanged. The diagnostic used
normal authenticated negotiate/playback/observation/command endpoints. An initial
non-semver diagnostic version failed negotiate;0.1.25 negotiated successfully.
No second playback session was opened.

| Measurement | Result |
|---|---|
| Broker plan from trusted Start | 7,327.2 ms |
| Original offered | Direct/ranged MP4; H.264 High/L40,1920x1012,8bit BT.709 limited; AAC stereo/source stream1 |
| Original delivery | 19 HTTPS206 reads; browser-reported4,723,992 transferred bytes in60.1 ms |
| Direct GPU first frame, sync lag, seek | FAIL: no GPU frame; sync and seek unqualified |
| Automatic fallback | Authorized same-session switch200, remux HLS playing natively |
| Fallback sample | Position72.347225 s,1,740 video frames,0 dropped; observations200 |
| Cleanup | Stop200/ended, current revoke200, video removed, Chrome closed; coordinator subsequently signed out test-only viewer to retire stale auth families |

Client admission failed after successful original delivery. Snapshot coalescing
lost the exception before replacement playback cleared it. There is no cached
moov capture to prove which admission check failed; persisted probe facts report
one English48k AAC stereo track, but do not prove its actual container language.
The independently proven unknown-language defect is fixed by790fa13: only two
known unequal languages reject; actual unknown language is retained, not relabelled.
The first attempt is therefore not claimed as an original-play success.

Recovery now forces its first failure snapshot through the250ms coalescer. A new
failure fingerprint can send one error observation despite the ordinary1s rate.
A local no-media native-view drive preserved a missing audio identity at28.8ms
(recovering) and330.6ms (failed), with one error observation and zero media fetches.
The same drive advertised with a matching same-origin shared asset descriptor
and omitted original capability for a cross-origin descriptor.

Production uses `window.velaUniversalAssets={baseURL,assetKey}` and validates the
exact same-origin `/vela/universal/<key>/` path plus manifest identity. Explicitly
invalid descriptors fail closed; only an absent descriptor uses diagnostic-relative
assets. `prepare-upstream.ts --reuse-assets=<verified-payload>` restores validated
WASM/libraries while rebundling current host/workers from the pinned sources;
it does not rebuild the compiler toolchain or fetch media. This recovered the
build after the external scratch drive disconnected. The diagnostic screenshot
was on that disconnected drive and is unavailable; the measured results above
were retained independently in the drive transcript.

### Second cleared lab attempt and relative-URL correction

The corrected diagnostic retained the actual failure: `Failed to construct 'URL':
Invalid URL`, before any GPU frame. Its original broker URL was origin-relative.
The manual diagnostic bypassed the normal data adapter's `mediaPlan` URL
normalization: demux accepted the relative URL, then audio preparation's strict
`new URL(url)` rejected it. This is a diagnostic/runtime boundary defect, not
proof that the normal app adapter fails. Runtime `open` now resolves a nonempty
URL against `document.baseURI` once before every demux/audio consumer, rejecting
non-HTTP schemes and embedded credentials.

| Second lab attempt | Result |
|---|---|
| Plan response |99.3 ms |
| Original first frame, sync and seek |No GPU frame; sync/seek unqualified; exact URL-construction failure captured |
| Automatic fallback |Same-session remux HLS playing;52.418297 s,1,261 frames,0 dropped |
| Cleanup |Stop200/ended, revoke200, native view removed, dedicated Chrome closed |

One local drive then supplied the **relative** path
`/diagnostic/universal-avc.mp4` through the real native view: eight-second tagged
BT.709 AVC/AAC fixture, stereo44,100Hz source. The runtime resolved the expected
same-origin absolute URL. First GPU frame757.3ms; measured sample37 decoded/
33 presented frames at1.342251s,0 dropped frames,0 PCM underrun/overflow/drop,
late-frame count0, worst video/audio-master lag8.416ms. Native view and browser
were closed afterward. This qualifies the relative-URL fix locally; a further
real original attempt still requires fresh owner-idle clearance. No HDR, physical
lip-sync, real-title seek or production beta pass is claimed.

### Real original-file qualification — Street Fighter, successful cleared run

A single owner-idle HTTPS lab session used the same-origin verified runtime
`01f921f13df02482`, normal viewer authentication/negotiate and the broker's
original-file grant. This was a diagnostic native-view host, not a packaged
`/watch` UI drive. It stayed on `primary`, original direct/file, WebGPU, with
WebCodecs H.264 and decoded AAC PCM. No fallback switch occurred.

| Measurement | Result |
|---|---|
| Broker plan |190.5ms from Start |
| First GPU-presented frame |1,154.3ms from trusted Start |
| Pre-seek sample |63 decoded/59 presented,0 dropped, position2.433833s |
| Video vs audio-master timing |Worst lag8.917ms before seek;7.963ms after; late count0, clock resets0 |
| Audio |AAC PCM output, physical clock correlation present,0 underflow/overflow/dropped PCM frames |
| Authorized seek |Target60s/buffering immediate; broker command200; first new GPU frame175.8ms; source generation1 retained, seek generation2 |
| Resumed sample |61.208627s,33 decoded/29 presented,0 dropped, fallback count0 |
| Final sample |97.442635s,903 frames in seek generation2,0 dropped; original/direct/WebGPU retained |
| Observations and cleanup |144 observations200; stop200/ended; revoke200; videos removed; dedicated Chrome closed |

These are software queue/clock measurements, not physical lip-sync, CPU/GPU power,
HDR or surround qualification. Screenshot `client/.exact/lab-27-universal-direct.png`
retains actual decoded imagery but exposed a canvas-position integration defect:
the upstream canvas CSS was outside the native view's shadow root. Vela now
supplies scoped absolute-overlay/visibility rules inside that root; this keeps
the custom renderer above the HTML video rather than below it in normal flow.

### One player, default universal admission

The earlier opt-in beta policy is superseded. There is no player toggle or active
persisted choice. The host removes the obsolete `vela.player.beta` key and always
runs the exact secure-device/installed-assets probe. Capable devices advertise
`originalPlayback`; `/watch` passes the negotiated plan to the same `vela-player`
view, which chooses the original backend when offered. HTTP, unsupported device,
unsupported source, or failed universal start uses internal automatic fallback;
there is no user-facing old/new backend selector. Data negotiation serializes
capability changes before playback requests. Production packaging requires the
verified shared runtime payload; the qualified runtime key remains
`01f921f13df02482` because this policy/layout change affects the host only.

Ether independently confirmed the successful Street Fighter delivery from lab
logs: the test device's session ran16:23:42–16:26 with candidate opens and media
preparation, and **zero** `transcode session starting` or `ffmpeg started` entries.
The direct/original client result therefore also has server-side evidence of no
FFmpeg encode or remux.

Next HEVC candidates were selected from persisted probe facts only, with no new
source fetch: The Mummy (1999), HEVC Main8-bit816p BT.709 + E-AC-3 English5.1;
The Mummy (1959), HEVC Main10/1080p SDR + E-AC-3 mono; and Model Citizen (2026),
HEVC Main10/2160p SDR + AAC5.1. Probe factsVersion6 omitted field order, so these
are not evidence of progressive scan. No HEVC, HDR/DV7, or new live qualification
has yet occurred; each lab stream still needs fresh owner-idle clearance.

### The Mummy (1999) lab qualification — source/admission blocked

Standing owner authorization permits polite sequential lab drives. A conservative
HEVC/E-AC-3 declaration first returned a remux plan: the selected default audio
was Italian AC-3, outside that deliberately narrowed audio declaration. That
unused session was stopped200/ended with **zero media reads**.

After restoring the full detected audio declarations and explicitly requesting
the offered English E-AC-3 track2, the broker selected a different best release:
4K HEVC Main10,23.976fps,10-bit BT.2020/PQ/DV8 compatibility1. Its selected track2
was now reported as English AAC7-channel, not the earlier SDR/E-AC-3 source.
The plan returned in137.3ms; the original probe rejected a channel-count mismatch
before any GPU frame. The old generic message did not retain the actual container
count, so a value such as8 must not be inferred. The diagnostic now includes
both `broker=<count>` and `container=<count>` in future ordinary playback errors.
No HEVC SDR, DV8, E-AC-3, seek or sync pass is claimed for this drive.

Automatic fallback ran. A proposed64KiB private-header artifact was rejected by
automatic approval review because capture/storage was not explicitly authorized;
no capture occurred and no indirect capture was attempted. The browser session
subsequently vanished before cleanup commands could run; no client stop/revoke
ACK is claimed. Ether independently confirmed the transcode closed16:42:06,
broker playback ended16:42:06.658, lease released and zero FFmpeg children; the
owner signed out the test-only viewer, revoking6 auth records. Only then was
Vela0.1.27 installed,1013/1013 files verified.

The broker chooses a best release for the declared profile. Persisted probe
candidates do not pin the source used by a later session. A controlled real-title
HEVC SDR result therefore needs a supported release-pinning mechanism, or must
qualify the actual returned release and codec facts honestly. The metadata
mismatch was handed to Ether with exact broker facts; its container-side count
remains unavailable for this stopped session.

### 0.1.28 startup hotfix and qualification policy

Original admission now intersects installed modules with **qualified** families:
H.264 video only until another family passes its real playback gate. Native video
advertisement is also H.264 only: the owner's1917 evidence was HEVC-copy HLS,
so merely restricting original admission would still permit that unqualified
copy route. HEVC/AV1/DV sources must receive compatible H.264 HLS for now. There is
one player, no toggle; modules on disk do not establish qualification. Runtime
admission independently checks the actual container codec, not just the broker
label. Qualified audio families remain available.

Every original start has an independent8s first-**presented**-frame watchdog.
Audio-clock movement, a playing label or decoded-but-unpresented frames cannot
satisfy it. Startup owns a cancellation controller; caller-scoped abortable waits
cover demux/browser config, audio preparation, shared capability promises,
presentation setup and controller start. Cancellation does not reset shared page
probes. Old-renderer teardown is bounded3.5s. Actual decoder failures may try the
local software/package route once, then the authorized compatible backend.
Unavailable startup input bypasses pointless decoder retry. All attempts remain
bounded and errors are reported rather than leaving a spinner indefinitely.

Local same-origin native-view verification, no lab/media provider involved:

| Case | Measured result |
|---|---|
| Actual HEVC/E-AC-3 fixture |Unqualified actual HEVC rejected into internal fallback; H.264/AAC file playing by2680.9ms,16 frames/0 dropped,position0.50542s |
| Local media promise deliberately never resolves |Timeout reported8003.3ms; compatible fallback playing8947.8ms,17 frames/0 dropped,position0.503214s |

Metadata descriptions are now advisory: actual selected container facts drive
codec, channels/rate/layout/language, dimensions, profile/level, scan/rotation,
colour and timeline. Differences enter bounded `snapshot.diagnostics` rather than
rejecting playback. Only selected actual audio is inspected; description inventory
mismatches map by source order, audio ordinal or first actual audio, with the
mapping recorded. Unsupported decoder/output configurations, unsafe unknown
multichannel PCM positions, corrupt or changed sources and HTTP/range violations
still take automatic fallback. HEVC/DV presentation expansion remains gated.

### HEVC local qualification candidate (production admission still H.264 only)

The coordinator corrected the owner-session analysis: **both** 1917 and End of
Oak Street used HEVC-copy fMP4 HLS with TrueHD converted to AAC. Oak Street was
not original-file playback. Neither run qualifies original HEVC; 0.1.28's native
and original H.264-only declarations remain necessary until this gate passes.

An isolated, non-production candidate enabled HEVC only for these local native-view
drives. Real same-origin assets, installed Chrome, synthetic 640×360/24fps files,
one source at a time. SDR used the exact-config-supported native WebCodecs route
with hardware preference; API support and route choice do not prove the silicon
actually used. PQ used the separately loaded HEVC WASM-parser/GPU decoder package
and WebGPU HDR-to-SDR presentation. The forced-package case bypassed native route
selection without changing the fixture.

| Fixture / actual route | First presented frame, warm | Before seek: decoded / presented / dropped | Position after seek to 4s (~700ms observation delay) | Worst post-seek frame lag | PCM underruns |
|---|---:|---:|---:|---:|---:|
| Main8 BT.709 + E-AC-3 5.1 / native |197.6ms|20 /16 /0|4.632s|13.800ms|0|
| Main10 BT.709 + AAC / native |116.7ms|20 /16 /0|4.625s|11.848ms|0|
| Main10 actual PQ/BT.2020 + E-AC-3 / package |167.5ms|43 /16 /0|4.638s|15.996ms|0|
| Main10 BT.709 + AAC / forced package |109.6ms|43 /16 /0|4.639s|12.017ms|0|

Initial cold Main8 first frame was2702.3ms. Stereo output/downmix was used;
physical surround and human-perceived lipsync were not measured. PQ input was
actual ST2084 neutral steps0–203nits plus a moving bar, not relabelled SDR.
A never-settling `VideoDecoder.isConfigSupported` call was cancelled at150ms:
startup rejected `AbortError` at155.6ms, runtime disposed, zero remaining canvas.
Shared capability promises are raced per caller, never globally cancelled; audio
package, video package and GPU-device offer preparation now use that same wait.

The drive found and fixed two integration defects. GPU decode must consume seek
preroll to reconstruct references, but frames ending before the requested start
must be released before presentation readiness/queueing. Otherwise a seek to4s
presented old pictures, counted92 drops and recorded up to1.795s lag. The pinned
build-time adaptation drops only those decoded output frames and returns their
slots; compressed packets and dependencies remain intact. Afterward both package
seek cases had zero drops. Native VideoFrame GPU completions can outlive decoder
retirement; seeks and audio switches now advance the presenter's/frame loop's
presentation generation so old completion acknowledgements cannot fail the new
playback. All four final cases completed without playback failure. No lab HEVC
pass, 4K/DV8 pass, DV7 reconstruction or production HEVC enablement is claimed here.

### Real HTTPS HEVC candidate drives (2026-11-14)

The Ether coordinator confirmed the owner idle immediately before each drive.
The isolated native-view candidate used the normal password auth/negotiate,
playback broker, commands and observations. It did not replace the installed
0.1.28 app shell. One stream at a time; each finished with stop200/ended,
current-family revoke200/accepted, zero video/canvas, and the dedicated Chrome
closed. No original file bytes were captured to disk.

| Actual selected source | First GPU incl. plan | Broker plan | Seek → first new GPU | Frames / dropped after seek | Worst post-seek lag | Audio |
|---|---:|---:|---:|---:|---:|---|
| The Mummy (1959), original HEVC Main10,1800×1080 BT.709; native WebCodecs |4364.1ms|3672.1ms|60s:6458.0ms|32 decoded /28 presented /0 dropped|16.989ms|PCM underruns0|
| Requested The Mummy (1999); actually The Mummy Returns (server pack-selection defect), original HEVC Main10,3840×2160 PQ/BT.2020 + DTS8ch; package GPU decode and SDR tone map |4609.3ms|3392.6ms|120s:3155.3ms|43 decoded /35 presented /0 dropped|16.625ms|PCM underruns0|

The SDR run initially decoded64/presented60/drop0; Ether independently confirmed
zero FFmpeg/transcode starts during that session. The 4K run initially decoded88,
presented59/drop0. Its broker facts contained HDR10 colour but no Dolby Vision
profile/compatibility facts, so this is **not** a DV8 qualification. The rendered
post-seek film frame is `client/.exact/lab-29-hevc-4k-hdr.png`; the SDR opening
capture `lab-28-hevc-sdr.png` is black at2.506s and is not claimed as visible film
content. These are short decoder/presentation/clock measurements, not physical
lipsync, HDR-display output, CPU/GPU utilization or long-film reliability results.

Broker metadata remained advisory: frame-rate differences and eng/en language
spelling differences were recorded without preventing decoding. The first Model
Citizen request selected H.264 despite its persisted HEVC probes and was stopped
unused. An isolated-candidate setup error then inherited production's H.264-only
shared runtime descriptor: HEVC rejection automatically selected authorized HLS,
which played88 frames/drop0 by3.514s media time; stop200/ended followed. This
proves the production native-view runtime's internal handoff in that drive, not
a separate real `/watch` UI acceptance pass. The diagnostic driver now removes
that inherited descriptor before loading its explicitly staged candidate.

The explicit DV8 candidate then reached the runtime and fell back promptly with
`video-track-unavailable`; authorized HLS advanced6.466s with159 frames/drop0.
Stop/revoke both200, resources zero, Chrome closed. Offline reproduction identified
an adapter defect: removing the DV profile to use its HDR10-compatible base left
`dvBlSignalCompatibilityId=1`. Upstream treats any surviving DV field as a DV
selection; with no profile its selected video ordinal was null. Clearing the
compatibility field as well yields ordinal0. Both SDR-conflict and compatible-base
normalization now remove that field. Remaining DV reconstruction profiles are
explicitly unqualified and immediately take the compatible backend; DV7 is not
silently advertised as reconstructed playback. The corrected DV8 drive follows.

### HEVC original admission enabled after corrected DV8 pass

The final corrected Model Citizen (2026) source was original HEVC Main10,
3840×2160, PQ/BT.2020, DV8 compatibility1, RPU present, enhancement layer absent.
The same pinned runtime decoded its HDR10-compatible base into the SDR renderer;
RPU reconstruction was explicitly disabled and recorded in the snapshot.

| Final DV8-base measurement | Result |
|---|---:|
| Broker plan (cached source resolution) |79.7ms|
| First presented GPU frame from click |957.8ms|
| Initial decoded / presented / dropped |86 /59 /0|
| Authorized seek120s → first new GPU frame |1022.4ms|
| Resumed position |121.236111s|
| Post-seek decoded / presented / dropped |55 /31 /0|
| Worst post-seek frame lag / late frames |16.659ms /0|
| PCM underruns |0|
| Observations, stop, revoke |200; ended; accepted|

`client/.exact/lab-30-hevc-dv8-base.png` was visually inspected after the seek.
The session ended, current authorization family was revoked, video/canvas counts
were zero, and Chrome was closed. The coordinator's fresh idle check preceded
this one retry. No further source was opened afterward. These cached-startup
numbers are not cold-provider resolution latency or physical lipsync measurements.

Original negotiation now admits H.264 and HEVC, backed by the exact per-source
native probe and installed package fallback. **Native HLS negotiation remains
H.264-only** so an internal handoff cannot reproduce the unqualified HEVC-copy
HLS path from0.1.27. DV7 and other full Dolby Vision reconstruction remain outside
admission: after actual-container inspection, only normalized compatible DV8
HDR10-base playback proceeds; remaining DV profiles immediately use the authorized
fallback. This qualification adds neither full RPU/FEL reconstruction, PGS/ASS,
nor universal live TS decoding. Those remain subsequent work.


### Title-attribution correction from Ether's resolver audit

The coordinator subsequently traced the 4K HDR10 request labelled The Mummy
(1999) to a pack whose acquired file was **The Mummy Returns.mkv**. Its codec,
decoder, frame, seek, timing and no-FFmpeg measurements remain valid for that
actual file; it is **not a correct-title playback pass**. Ether owns the pack-file
identity defect and is fixing it before plan-latency optimization. No client-side
permission to substitute a film or edition is implied by these results.

### 0.1.30 overlay hotfix: real app watch verification

A real `/vela/watch/...` route reproduced the missing chrome on an original H.264
1800×1080 source. The Contract chrome and all children had opacity1, but the
shadow canvas's z-index1 escaped its media surface (isolation/z-index both auto)
and painted above it. A shadow root is not a CSS stacking context. The native
view now isolates its media surface at z-index0 and disables all media pointer
targets. The shared Contract wrapper gives chrome z-index1 and focuses the watch
stage on entry. UI state continues to come from engine snapshots, not the unused
video element's paused property.

Exact committed/proposed styles and focus were applied on that same installed
0.1.29 stream before packaging30. One manual drive measured idle chrome opacity0;
pointer movement0.995, centre tap0.995 and an otherwise unhandled key0.997 during
fade-in; after Space paused playback, opacity remained1 and the transport label
was Play. Playing/paused observations returned200,1825 frames/drop0. Before/after
images `lab-31-overlay-before.png` and `lab-32-overlay-fixed.png` were inspected.
Real Close player returned broker stop200/ended, own-family revoke200/accepted;
the test Chrome was closed. Native fix3ec6089 and UI a549994/8bdb8d0 are paired;
the universal runtime e2e583f40c93c9f6 is unchanged. No extra stream was opened.

### Lab.14 fallback track verification

One installed0.1.30 session requested1917 at120s with H.264/AAC fallback
capabilities. The broker selected an H.264 remux with three audio tracks and one
external WebVTT subtitle, rather than the FraMeSToR/PGS source. Audio1→2 returned
200 with source/seek generations2/2. Subtitle4 on/off returned200 at a nonzero
position. Final playback reached169.901s,360frames,0drops; playing observations
returned200. Stop returned200/ended, own-family revoke200/accepted, Chrome closed.

| Requested check | Measured result |
| --- | --- |
| Audio switch | Pass: server command200 and playback resumed |
| Offered subtitle on/off | Selection pass: both commands200; glyph appearance not qualified |
| Ladder, rung and Auto | Unqualified: selected remux qualities were empty |
| PGS burn-in | Unqualified: selected source offered WebVTT only |
| Prepare lower fallback |403 feature_unavailable; sent to Ether owner |

The engine projection now preserves typed subtitle delivery and all offered audio
tracks. Burn-in and server-managed audio use authorized tracks commands; embedded
subtitle rendering remains a separate subsystem under construction. Pending codec
qualities start their selected init and wait for exact codec verification before
SourceBuffer creation. New speed support is advertised only when the installed
runtime/backend implements it. No PGS rendering or nonexistent quality is implied
by listing an actually offered server track/path.

### Lab.15 quality-everywhere verification

One installed0.1.30 session of1917 offered primary H.264 remux plus source-capped
480p/1.8Mbps and360p/0.96Mbps lazy conversion paths. Here Original means the
primary starting quality; the delivery readout correctly remains remux. An
untouched original file is separately identified by the wire's original flag.

| Check | Measured result |
| --- | --- |
| Original plus lower choices | Pass: primary,480p,360p;720p absent and unqualified |
| Lower path at nonzero position | Switch200, generations2/2;480p playing170.441s,562frames,0drops |
| Return to Original | Switch200, generations3/3; final primary playing229.872s,1419frames,0drops |
| Prepare≤2Mbps without switching |200, ready480p in1112.7ms; primary remained playing209.005→210.119s |
| Encoder bound | Ether independently observed one h264_videotoolbox encoder; separate Matroska helper was not an encoder |
| Cleanup | Stop200/ended, own-family revoke200/accepted; Chrome closed |

The matching controls payload2da664809bbc2c82 also passed one local AVC/AAC
native-view drive at1.25×:0.984571s of media advanced over803ms,34frames,
0drops and no failure. Local canonical audio and PGS burn-in commands carried the
offered track IDs and current generations. That command check does not claim PGS
glyph rendering. Core TypeScript and host builds passed; the redundant full
Contract build was stopped after10minutes without a result, with UI integration
compile delegated to the UI owner. No new core code is in this shipping payload.

### Startup latency audit: client marks and detail prewarm

The existing data source retains successful negotiation by authentication version
and exact serialized capability declaration. Reopening a title does not send
another negotiate request unless authentication or that declaration changed.
The root media-context probe runs before authentication and detail Play becomes
available. It is not newly started by each playback request.

The host now retains one page-local capability result per immutable asset
identity. GPU-adapter discovery, manifest fetch and subtitle capability checks
run concurrently, and probing/runtime loading share one manifest promise. Caller
cancellation detaches from shared work; bounded shared requests continue for
other consumers. Failed manifest loads clear their cache entry. No session or
original-file grant is prefetched from detail: POST/playback allocates playback
resources, and the protocol currently has no read-only prepare token endpoint.

`window.velaPlaybackTimings()` exposes copies of at most200content-free native
marks: Play, probe/assets start and completion, plan arrival, source open, runtime
import, metadata/audio/decode preparation, first successful frame presentation
and recovery. Attempt/source counters distinguish retries. It contains no title,
session ID, URL, grant or credential. GPU first-frame marks come from successful
presentation, not the later250ms snapshot sample. Native uses its video frame
callback. Browser network timing must be collected separately, including the
data worker's negotiate, POST/playback, snapshot and SSE requests; main-window
resource entries alone do not include all worker requests.

One local generated AVC/AAC drive of the qualified wrapper measured:

| Stage | Measured duration |
| --- | ---: |
| Root capability probe, before Play |3.0ms |
| Second media-context probe |cached identical result |
| Manifest requests across both probes and playback |1 |
| Play → first GPU-presented frame |714.8ms |
| Runtime import |32.4ms |
| Original metadata probe |17.3ms |
| Selected audio preparation |3.2ms |
| Capability/presentation/decode setup |121.9ms |
| Setup complete → first presented frame |456.2ms |

The plan in this loopback drive was supplied locally, so it does not measure
negotiation, server resolution or SSE latency. This is not a before/after LAN
startup comparison. Chrome and the owned local server were closed.

Ether's read-only comparison explains a likely server-side gap: Vela detail does
not call the owner-setting-gated prewarmer that Plex detail uses. The previously
captured Vela cold plan took3.39s, including a1.21s uncached probe, provider
acquisition and losing-candidate waits. The owner's latest AppleTV session had
resolved on detail beforehand; candidate open took2.2ms, native probe452.6ms,
augment0.6ms, and session start roughly0.46s after candidate open. That is a
Plex measurement, not a Vela POST measurement. Ether worker's detail-prewarm
change and one actual Vela click-to-frame lab breakdown are pending; the lab is
held while the owner is watching. No under1.5s cold-LAN claim is made.

### Installed0.1.32 startup attempt: capacity and resource failure

The real app was driven over HTTPS with fresh viewer authentication. This did
not produce a valid first-frame timing comparison:

| Phase | Measured result |
| --- | --- |
| Root media probe, before sign-in/Play |45.2ms |
| Negotiate, before Play |200 /9.589ms; exactly one, no renegotiation on Play |
| Movie detail |200 /933.844ms initially |
| First POST/playback after one Play |503 /609.485ms; first byte607.635ms |
| Plan, SSE, source open, first frame |Never started; no plan/source marks |
| Server refusal |Coordinator confirmed capacity/playback_capacity, retry.allowed=false, two slots occupied |
| Cleanup |No broker session created; coordinator revoked this exact test device200; Chrome closed |

The app incorrectly repeated the typed, nonretryable playback refusal and detail
reads. This was handed to the data owner with the stable watch-stage key2 and
single native Play mark; request argument/idempotency values were not captured.
No successful stop is claimed for a session that never existed. Screenshot
`lab-33-startup-failed-032.png` retains the failure state.

A later lab.16 comparison attempt made zero playback requests: Home initially
loaded, then bootstrap409 and repeated503 removed the hero before a Play could
be issued. The exact bootstrap ProtocolError body was not retained, and no class
or retry policy is inferred from its HTTP status. Own-family revoke returned200;
Chrome closed. `lab-34-home-failure-032.png` records that separate blocker. The
data owner is adding bounded memo/retry handling; Ether is correlating the server
errors. No cold-versus-prewarmed first-frame result is claimed from these attempts.

### Quality diagnostics and bandwidth policy

Both the qualified wrapper and the Vela core now populate the same snapshot
fields: `video:{width,height,codec,dynamicRange}`, `currentBitrateBps`,
`requiredBandwidthBps`, `bufferAheadSeconds`, `throughputBps`,
`throughputHistory`, and existing decoded/dropped frame counts and path strategy.
Each URL-free rendition carries `bitrateBps` and `requiredBandwidthBps` alongside
its dimensions/codec/range and pending/verified status. Lazy-path menu metadata
comes from the authoritative plan; it does not manufacture an initialized rung.

The active bitrate is a declared rendition peak/target, not a measured encoder
output rate. The menu's `needs ~` recommendation is that rate times1.25, a
conservative client margin rather than a no-stall guarantee. Actual resolution,
codec and input HDR classification come from the container/decode route. HDR10
here identifies the input; it does not claim HDR-display output or DV processing.

Throughput is the lower of3s/10s EWMAs. Cached responses, samples under16KiB and
under50ms are excluded. The wrapper's pinned-library adaptation reports only
completed browser ResourceTiming byte/time samples through a generation-checked
message; private response bodies are not cloned or intercepted and URLs do not
leave that measurement scope. Core readers use their own completed acquisitions.
Native/MSE retains its existing measurements; a browser-managed path without a
measurement reports unknown. History retains at most30samples.

Universal buffer ahead is conservative decoded-video coverage intersected with
queued PCM or actual native-audio buffered ranges. It does not guess time from
original-file byte-cache size. Native/MSE uses actual media ranges. The future
core encoded read-ahead queue must expose indexed packet coverage separately.

The display-ready `PlayerView.stats` record supplies localized labels, raw
buffer seconds, measured/required headroom, and history normalized0..1 against
its own maximum. Unknown labels are empty, numeric buffer/drop counts are-1,
headroom0 and historyempty. Original and lower choices include actual offered
resolution/range, declared bitrate and the client-margin recommendation; duplicate
Original entries are removed. Pending codec descriptors remain marked Starting.

A local generated AVC/AAC fixture with80ms delayed range responses reached
playing with actual640×360H.264/SDR, decoded buffer0.180785s, measured worker
throughput91.939Mbps, normalized history[1], and0drops/15decoded frames. Its
synthetic declared target1Mbps projected as1Mbps / needs~1.3Mbps (1.25Mbps before
rounding), distinct from that transfer-rate measurement. Only one Original choice
was produced. Chrome and the owned asset server were closed. This validates the
pipeline/labels locally, not the lab's current throughput or available ladder.

## Vela-owned core: lab.18 qualification, 14 November 2026

Candidate `2b2928f8077c298f`, source `0b9b3d2`, ran behind the real native-view
module over lab HTTPS. It uses Vela's reader/demux/decode scheduler and physical
AudioWorklet clock, with library components instead of the upstream controller.
Production remains the qualified wrapper: **the parity gate has not passed**.
Each drive used one stream, real broker plans/commands/observations/SSE, Stop
returning `ended`, auth revocation, and a completely closed dedicated Chrome.
The wrapper baselines below are historical measurements, not simultaneous runs.

| Actual source family | Wrapper plan → frame / seek | Core plan → frame / seek | Core Play → frame (plan portion) | Drops, wrapper → core |
| --- | --- | --- | --- | --- |
| Street Fighter, H.264 1920×1012 / AAC | 964 / 176 ms | **386 / 97 ms** | 1,853 ms (1,467 ms) | 0 → **0** |
| Mummy 1959, HEVC Main10 SDR 1776×1080 / E-AC-3 | 692 / 6,458 ms | **362 / 296 ms** | 7,212 ms (6,850 ms) | 0 → **1** |
| Mummy 1999, 4K HDR10 / DTS | 1,217 / 3,155 ms | **Coverage unavailable** | Constrained profile returned non-retryable plan 503; no media opened | — |
| Model Citizen, 4K DV8 compatibility-1 / E-AC-3 | 878 / 1,022 ms | **1,535 / 1,355 ms** | 3,638 ms (2,103 ms) | 0 → **0** |
| 1917, H.264-copy / AAC fMP4 HLS | Old native TS: 13,960 ms including plan; not equivalent | **Failed before frame** | 219 ms plan; first segment ready in about 0.8 s | — |

Seeks were authorized at 60 s (Street Fighter, Mummy 1959, 1917) or 120 s
(Model Citizen, Mummy 1999). Successful direct seeks retained the same core and
byte reader. All measured successful drives reported **zero audio underruns**.
Street Fighter's maximum frame age against the physical audio clock was 8.18 ms;
HEVC SDR was 23 ms. DV8's raw maximum was 47 ms at the paused seek preview,
while the final playing sample was 4.76 ms. These are presentation-clock metrics,
not a physical speaker/display lipsync measurement. DV8 used HDR10 base-layer
SDR tone mapping; RPU enhancement reconstruction is not claimed.

Source selection changed. The default profile selected H.264 for Mummy 1959 and
Model Citizen; their actual H.264 drives also played and were not misreported as
HEVC/DV coverage. The HEVC rows use the same conservative HEVC-only test subset
as the earlier wrapper qualification. The default 4K Mummy 1999 source was SDR
with E-AC-3, not HDR/DTS: 298 ms after plan, 2,497 ms seek, one drop. Ether
confirmed the historical HDR/DTS result was **The Mummy Returns from a wrongly
matched pack**, stored under Mummy 1999. The corrected resolver rejects that
wrong film. No genuine current HDR/DTS candidate has been established for either
title; that row cannot pass by relabelling a different source.

The separate default-profile Mummy 1959 drive spent 9.56 s in plan and 5 s on
seek. Ether correlated this with blocking Usenet health sampling, a missing
article, and source failover/probing; it is not attributed to decoder configure.
Street Fighter's cold plan walked four candidates, including an 810 ms probe.
The actual DV8 core startup spent **1,102 ms in decoder/pipeline configure**.
Its seek spent only 1.1 ms in metadata and 10.1 ms in configure; the remaining
~1.32 s is acquisition/preroll/presentation, not a cold configure.

### Blockers and corrective work

- HLS AAC packet timestamp was `384307168202282300000` µs, with 21,333 µs
  duration and 401 bytes. A generated local FFmpeg reproduction proves raw AAC
  `tfdt = 18446744073709550592 = 2^64 − 1024`. Negative priming was encoded as
  unsigned time. Ether's producer correction is `020048997`; the core also needs
  a source-scoped, exact-word repair before floating-point conversion, followed
  by normal decoder preroll trimming. Other garbage timestamps stay rejected.
- One native HEVC startup drop needs its bounded scheduler trace resolved.
- Cold GPU decoder/colour pipeline compilation must move to idle/preparation;
  seek work must target indexed reads and preroll. Retaining an already-hot
  decoder alone does not address the measured 1.32 s seek phase.

Screenshots are `client/.exact/lab-core-*.png`; content-free numeric drive records
are `client/.exact/core-lab18-results.json`. No original source bytes, credentials,
grants or private request headers were captured. The local generated wrapped-AAC fixture subsequently played through the core
(635 ms first frame, 482 ms authorized seek) and reported the exact correction.
That drive exposed four drops from a separate idle-warmup/active-playback race;
its guard and performance work remain separate qualification gates. The 0.1.33
release hold is now lifted; no production core switch is claimed.

### Idle GPU reuse and bounded preroll candidate

Core candidate `39a841e9b754f1e0` moves HEVC shader/colour-route compilation to
idle after first paint or title intent. One idle GPU device/package cache is
retained for two minutes; an active playback lease prevents a competing warmup
from creating another device. If Play claims a warming device, remaining warm
stages yield instead of competing with playback. Media, audio and byte caches
are not retained across sessions. The qualified wrapper payload does no core
warmup. Seeks keep the same source/reader and device; ordered encoded read-ahead
is bounded by 64 packets, 12 MiB and six seconds plus one in-flight packet.

Native HEVC HDR is admitted only through the library's validated external-HDR
route. Decoder configuration and in-band SPS colour are neutralized before the
browser decode, preventing double colour conversion; original PQ/HLG facts
still drive Vela's SDR tone mapper. A route/frame-contract mismatch falls back
to the package decoder. This is base-layer tone mapping, not DV RPU rendering.

One local native-view drive per fixture, generated media and real same-origin
assets, Chrome on this Mac:

| Fixture | First frame | Authorized seek | Dropped | Outcome |
| --- | --- | --- | --- | --- |
| Old muxed H.264/AAC HLS with raw unsigned `tfdt = 2^64 - 1024` | 347 ms | 70 ms at 6 s | 0 | Playing, exact `-1024/48000` correction recorded |
| HEVC Main10 PQ / E-AC-3 5.1, 640×360 | 47 ms after idle warmup | 86 ms at 4 s | 0 | Native hardware route, SDR tone-map picture, true EOF at 7.995 s |

The HDR idle warmup took 551 ms before Play. Both seeks retained the runtime
and reader. The HLS maximum observed frame age was 9.12 ms; no stale/drop events
were recorded. Audio preroll preserves negative AAC priming at the start and
reads up to 100 ms before a seek target for decoder/output trimming. These small
fixtures establish mechanism and cleanup, **not 4K lab parity or physical A/V
lipsync**. The earlier four-drop warmup race did not recur. Dedicated Chrome and
the owned local fixture server were closed after the drive.

### Lab.20 HLS requalification: startup pass, seek blocked

Core39a841 on real 1917 H.264-copy/AAC fMP4 started in **1,400 ms**
including a71 ms plan. Native AVC/AAC decode presented72frames/drop0 with
zero audio underruns after3s; maximum physical-clock frame age5.59ms.
The first4.2MB segment waited661ms for its first byte. No priming failure
occurred. Idle warmup was claimed before completion and yielded, taking
416ms of the startup window before metadata acquisition.

The authorized60s seek returned HTTP200 in28ms and a new source generation,
so the core correctly opened the new HLS source. It presented a preview, but
subsequent segment acquisition failed with `Invalid segment byte request`.
Automatic fallback recovered playback near the beginning (6.31s), not the
requested60s. **Seek fails parity; no production core switch.** The successful
local same-source seek does not establish offset-HLS seek support. This run
needs numeric segment-length/read-bound diagnostics before a new qualification.
Ether correlated this same playback and confirmed a60s encoder restart reused
`00000.m4s` and `init.mp4` from the preceding epoch with different bytes. Segment0
was ready640ms after fetch. The public timeline is60s plus the plan's segment
start, not a segment number inferred from a fixed duration. The confirmed mux
target was250ms;4s was a code default, not a captured playlist measurement.
Its worker is adding generation-unique media URLs.
The measured HTTP seek was28.4ms; the earlier proposed20s authorization diagnosis
was withdrawn. The driver's15s wait used a too-strict local-epoch comparison
across replaced runtimes, so it is not a seek-latency measurement.

Session7OV3767GLKYOJSRTTUDXL7GM7F, test device9f2c223b-171d-4df1-9acb-919ae33ff42e:
Stop returned ended, auth revoke accepted, native view removed all video/canvas
nodes, and the dedicated Chrome was closed. One stream, no captured media bytes
or headers.

The follow-up HLS guard explicitly disallows retained HLS readers/demux indexes
across authoritative seek generations. Every segment cache/in-flight entry is
keyed by `(sourceGeneration,seekGeneration,url)` inside a newly scoped reader;
HTTP reads use `cache:no-store`. A repeated filename changing length within one
generation fails with numeric requested/indexed/available sizes, with no URL or
headers. Immutable original-file readers still validate ranges/revisions and
retain their same-source cache for direct seeks. This is client containment;
it cannot turn a reused server resource into the correct seek-generation bytes.
A new 1917 seek qualification waits for Ether's generation-unique producer fix.

### Local offset-HLS generation check

Candidate `9e1e4578186740d8` passed one generated local native-view transition
from the old wrapped-AAC HLS fixture to a new source/seek generation whose
`timelineOriginSeconds` is 4. Real FFmpeg output had first video PTS/DTS 4.000 s
and two 2 s fMP4 segments with distinct generation-prefixed names. The new core
runtime presented the target at title time 4.000 s in **86 ms**, zero drops and
no failure. The initial wrapped-AAC source started in 288 ms, zero drops, and
reported its exact priming correction. Seek intent immediately showed target 4
and buffering. This establishes local offset mapping with a genuinely replaced
HLS source; the earlier same-source cached seek was a different case.

The first fixture construction was discarded before playback because its only
video keyframe preceded the requested offset: stream copy kept the whole 8 s
video while audio started at 4 s. The corrected fixture explicitly has 2 s video
keyframes and its raw packet timestamps were checked before the single drive.
No lab media or credentials were used. The native view, named Chrome and owned
local server were disposed/closed. Lab.21 requalification remains pending the
packager's first slot.

### Lab.21 1917 HLS seek identity passes

Core `9e1e4578186740d8`, H.264-copy/AAC fMP4 through the real native view,
with Ether's generation-unique media names installed:

| Measurement | Result |
| --- | --- |
| Play → first frame | **1,446.8 ms**, including **61.1 ms** plan |
| First segment | 4.2 MB; **780 ms** first-byte wait |
| Seek intent | Immediate target 60 s and buffering |
| Authorized seek command | HTTP 200 in **168.9 ms** |
| Seek → target frame/playing | **1,081.5 ms**, at **60.010 s** |
| Seek segment acquisition | 10.9 MB; **795 ms** first-byte wait |
| Continued play | **62.946 s**, 71 presented frames, **0 drops / 0 audio underruns** |
| Maximum physical-clock frame age | **12.10 ms**; not a speaker/display lipsync measurement |
| Recovery | None; no invalid-segment read or return to the beginning |

The plan advanced source/seek `(1,1)` → `(1,2)` and reported origin 60. The HLS
runtime was replaced with a new reader/demux; frame counters therefore restart
per generation. The driver now correctly recognizes a replacement runtime plus
an actual presented target frame, rather than comparing local epoch numbers
between different instances. HLS has no original-file `byteReader`; an equality
of two absent byteReader values is not retained-cache evidence.

This fixes the lab.20 cached-byte failure. The historical native-TS wrapper
startup was 13.96 s, but it has no equivalent measured seek baseline. A paired
wrapper seek win is **not established**. The seek is close to the 1 s LAN target
and most time is command/producer readiness, not the 5 ms decoder configure.

The copy-keyframe-origin fix is **not installed** in this run. A reported target
position proves transport/control progress, not exact picture mapping when a
copy seek retains preceding-keyframe preroll. Ether's worker is making the actual
source/keyframe origin truthful while retaining the requested `positionSeconds`.
Raw output PTS may also include a common mux/B-frame shift; it must not be
confused with the source/title keyframe origin. That separate clock gate, the
refreshed 4K/HDR set and track/subtitle/live/recovery parity remain before a core
production-default claim.

Public session `V25AYLG4TOJABFC5JN4QKQCTGY`, test device
`3425a4e1-279b-4cb5-a358-fcdf05b90d17`: Stop returned `ended`, auth revoke was
accepted, all native-view video/canvas nodes were removed, and dedicated Chrome
was closed before the slot was returned to packaging. Screenshot:
`client/.exact/lab-core-1917-hls-lab21.png`; numeric-only record:
`client/.exact/core-lab21-result.json`. No media bytes or private headers captured.

### Lab.22 correction: published origin still blocks content-seek proof

The next bounded 1917 run measured 1,223.5 ms Play → first frame (717.3 ms
plan), and a target-labelled frame at 60 s after 639.3 ms (95.6 ms command,
390 KB opening segment with 490 ms first-byte wait). It continued to label
62.961 s, zero dropped frames/audio underruns and 9.32 ms maximum clock-frame
age. Stop returned ended, auth revoke succeeded, and Chrome was closed before
returning the slot. Session `XHUAT4I64W3TN2645VHBEPBV3P`, test device
`90866c52-a0b5-446f-807a-597d2a86275a`.

**This is not a correct-content seek pass.** Ether's read-only log established
that the copied source actually restarted at preceding keyframe **50.05 s**.
The seek reply revision 5 and subsequent SSE revisions 6, 7 and 8 all published
origin **60 s**. The core therefore labelled an earlier picture as 60 s. The
numeric presentation latency and zero-drop counters remain measured, but cannot
prove that the requested picture was shown. The publication fix is Ether branch
`w0312/vela-origin-publish`, commit `444b07e3a`: resolve the public session binding,
publish the known origin in the seek reply, retain it in following revisions,
or publish the first later-known value on the next changed revision.

The host now treats a changed URL, source revision, timeline or measured origin
in a same-generation plan as a material source update: reopen at the pending
seek/current intended title position. It does not relabel an already-running
native/demux clock in place. One generated local Chrome check published a
corrected origin 4 → 0 with source/seek generations unchanged at (2,2). The
backend was replaced, kept intended position 4 s, discarded **96 preroll frames**
and presented the corrected target in **78 ms**, zero drops/failure. This checks
the late-publication mechanism; sustained audio-clock progress was not measured
in that short correction sample.

The core-only overlap candidate also moved source/index acquisition and exact
native decoder configuration ahead of the exclusive GPU-ready barrier. In the
same local trace metadata started at 199 ms and was ready at 218 ms, before the
claimed idle warmup yielded at 372 ms. GPU presentation/package creation still
waits for device ownership and surface binding. First frame was 638 ms in that
run; no speed improvement or 4K sustained-play claim is inferred from it. The
named Chrome and local server were closed. Real 4K/HDR and correctly published
copy-origin qualification remain required before changing the production default.

### lab.23: off-grid copy seek and refreshed HEVC qualification

Core candidate `7f4a1f394fe50290` (implementation `79f11c9`, full payload manifest
`5823df3c…6e29`) ran through the native view on lab.23, which includes Ether
`444b07e3a`. Production remained on the qualified wrapper. Each title had one
session, an acknowledged Stop (`ended`), accepted auth revoke, and no remaining
video/canvas nodes. The dedicated Chrome was closed and the shared slot released.

| Actual source | Historical wrapper Play / post-plan / seek | Current core Play / plan / post-plan / seek |
| --- | --- | --- |
| 1917 H.264-copy fMP4 HLS + AAC | 13,960 ms old native TS start; no equivalent seek baseline | 1,736 / 1,051 / 686 / **817 ms** to 61.370 s |
| Mummy (1959), HEVC Main10 SDR 1776×1080 + EAC3 mono | 4,364 / 692 / 6,458 ms | **243 / 91 / 153 / 206 ms** to 60 s |
| Mummy (1999), HEVC Main10 SDR 3840×2160 + EAC3 5.1 | No same-source baseline; historical HDR+DTS run was a wrong-film pack member | **173 / 46 / 128 / 270 ms** to 120 s |
| Model Citizen, HEVC Main10 3840×2160 PQ, DV8 compatibility 1 + EAC3 5.1 | 958 / 878 / 1,022 ms | **334 / 145 / 189 / 261 ms** to 120 s |

Times are milliseconds. These are short sequential LAN/HTTPS measurements, not
controlled cold-cache paired benchmarks: browser assets/shaders and server source
resolution can already be cached. Each page starts its normal idle warmup before
Play, approximately 75–150 ms before the click in these traces. The historical
wrapper's plan costs and sometimes source releases differ. No same-source HLS
wrapper seek win is claimed. All current samples had **zero dropped frames and
zero AudioWorklet underruns**, including continued playing after seek. Counters
following seek were respectively 107/69 decoded/presented for 1917, 248/144 for
1959, 203/146 for 1999, and 202/146 for Model Citizen. Preroll is discarded rather
than counted as a presentation drop.

The off-grid 1917 seek now proves the source/title mapping rather than just a
label: requested **61.370 s**, HTTP seek reply revision 7 **origin 60.018 s**,
retained through revision 13. Ether's independent producer log confirms restart
**60.018 s**. The first presented title timestamp was **61.354 s** at clock
**61.370 s**; this is the frame spanning the target, 16 ms before it at 24 fps.
**32 earlier preroll frames were discarded.** The reply took 240 ms, followed by
approximately 574 ms to the target frame. Initial segment acquisition was
527 ms (518 ms first-byte wait); seek metadata acquisition was 518 ms; exact
native decoder configure was 5.7/3.6 ms on start/seek. Authoritative seek-generation changes
replaced the HLS runtime and index; immutable original sources retained the same
runtime and byte reader across their seeks.

Maximum absolute physical-audio-clock/frame age was 16 ms for 1917, 23 ms for
1959, 7.4 ms for 1999, and 47 ms for Model Citizen (includes the initial seek
preview; final playing sample 4.5 ms). These are scheduler measurements, **not a
physical lip-sync measurement**. Original HEVC decoder configuration took
14.2/8.8/12.4 ms on the three starts and approximately 0.9/1.2/1.0 ms on seeks.
All used native video decode and software EAC3 output. Model Citizen rendered
real programme pictures from the HDR10-compatible base layer; RPU enhancement,
Dolby Vision certification and physical HDR output are not established.

Ether independently confirmed **no FFmpeg or transcode session** for any of the
three originals. The selected 1999 source was the genuine PandaQT SDR cut, not
The Mummy Returns. Thus this set proves 4K SDR and DV8/PQ base-layer playback,
but does not establish a genuine HDR10+DTS source. Session identifiers for
correlation: 1917 `OCSOP5NXX6VHFG6ADDTQIHFKHU`; original public sessions
`SYH7LWCQL2PJTR6ZECGOWV6IWE`, `T2FFG2UR3C4JSKKGAV5ME4LYRT`,
`JRSTDCIE4CGIBABW6LG5DASWV7`. Broker original session prefixes from the server
were `384205bf`, `bf27b325`, `4cf5389e` respectively.

Direct H.264/HEVC and finite muxed HLS startup/seek now have measured core passes;
the prior origin-publication blocker is closed. Before replacing the production
wrapper entirely, remaining migration coverage is the real-app `/watch` with
this candidate, audio/subtitle selection and original↔converted quality changes
through the core, and moving live HLS/TS (the current core segment reader is
finite VOD only). Real native-server header-auth integration is also pending
installed foundation wiring. The current production wrapper and narrow internal
native/MSE fallback remain available while those paths migrate. DV7 enhancement,
a genuine HDR10+DTS sample, long-run/physical lip-sync and network-interruption
qualification are not claimed by this run.

### lab.24: self-contained real-app core qualification (not production ready)

The combined run used the **actual cinematic app**, not the diagnostic playback
harness: clean source `89bed67`, candidate `0.1.37-core-89bed67`, matching compiled
data realm/native host, and verified core payload `a33b87aee7e61aa9`. The additive
bootstrap and engine assets were staged beside production. Its descriptor was
set before app import; no service worker controlled the candidate. Production
0.1.37 and its qualified wrapper `3c579f70de6e1cfe` remained unchanged.

All actions below were actual Play/scrubber/audio/quality/subtitle controls through
the foundation, normal negotiation, commands, SSE and observations. Pins were set
and independently GET-confirmed by the authorized Ether operator, then removed
and independently checked after each case. The candidate's bounded audit retained
scalar plans, snapshots and command kinds; it did not retain media bodies,
credentials, grants or private headers.

| Target actually requested | Result through the real watch view | Verdict |
| --- | --- | --- |
| Pinned 1917 FraMeSToR 2160p DV7 / TrueHD Atmos 7.1, `dcec927c…` | No plan or media: `503 capacity/preparation_pending`, first request 8,033 ms, two bounded retries 19/7 ms, then error chrome with Try again | Source preparation blocked; no core/TrueHD qualification |
| Pinned Inception jennaortegaUHD, `525f3640…`, HEVC Main10 3840×2160 PQ / DV8 compatibility 1, DTS-HD MA 5.1 | UI Play → first core frame **348.5 ms**; plan received 131.2 ms, metadata ready 295.9 ms, decoder ready 318.4 ms. Direct original confirmed independently; no FFmpeg until a lower quality was requested | Real-app startup works, sustained parity fails |
| Same Inception original, scrub to 61.4 s | Scrubber immediately displayed 61.4; target resumed after **2,683.9 ms**. Seek authorization 35 ms; 19 preroll frames discarded. No video drops | Slower than the short harness proofs; investigate source acquisition/scheduling |
| Same original, audio DTS-HD MA → AC-3 | Selected actual audio id 3 with no pending selection after **156.9 ms**, same source/seek generation | Local track switch works; not a sustained audio pass |
| Same title, 720p 4 Mbps lower path | Real tracks authorization followed by path switch; first core 1280×720 H.264 frame after **1,460.7 ms**. About 1.6 s later core reports `Input has an unsupported or unrecognizable format.`; internal MSE resumes ~104 ms after recovery starts | Automatic fallback works; core HLS transition fails |
| Pinned Inception DDB, `a7e6928e…`, VC-1 1080p / DTS-HD MA | Ether converts VC-1 to H.264 1080p with AAC. First core frame **723.2 ms**; same format error at 2,374 ms; first MSE frame at **2,476.1 ms** and playback continues | Honest conversion + internal fallback, **no client VC-1 decoder** |
| DDB English PGS on / Off at nonzero position | Server tracks commands advance generations; selected PGS returns to playing in **2,575 ms**, Off in **8,986.6 ms**. Both routes end on MSE after core demux failure | Selection/burn authorization works; no core subtitle parity or visible-caption claim |
| CHROMA 80 through actual Live TV → Watch live | Core fails configure with `Actual video colour needs a qualified presentation route`. Native fallback shows five frames, then `PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE`; terminal error, not endless loading | Live parity fails; no moving-edge/catch-up pass |

These are sequential LAN/HTTPS numbers with already-loaded app/runtime assets and
potentially warmed source resolution, not controlled cold-cache comparisons.
Inception's Dolby Vision source is rendered through its HDR10-compatible base
layer; no RPU enhancement, HDR10+ dynamic metadata application, Atmos object
rendering or physical HDR/7.1/lip-sync qualification is claimed.

The short initial Inception sample had 54 decoded / 49 presented frames, zero
video drops and zero AudioWorklet underruns. **That is not a sustained pass**:
the following real-app interval repeatedly alternated playing/buffering. By title
position 67.4 s the counter reached **19 underruns**, 513 decoded / 458 presented
frames, still zero video drops. Maximum scheduler clock/frame age reached 172 ms
including seek preview. The 720p MSE recovery sample later reported 321 frames and
seven drops. Metrics reset with backend replacement, so they cannot be summed as
one continuous core counter. Audio underruns and buffering must be resolved before
using the startup number to justify a production switch.

Ether independently confirmed the exact two Inception releases. VC-1 conversion
used VideoToolbox H.264 plus AAC; no unsupported client decoding is implied. The
1917 pin was honored but its Usenet pre-play health sampling hit the ~8 s deadline
on slow article bodies before admission. That was routed to Ether; substituting
another film/release would not prove this target. The opening PGS screenshot shows
normal programme/logo pictures and the checked English PGS choice, **no caption
pixels**, so it proves the menu state only. Auto and return-to-Original were not
completed in this batch; they remain required coverage.

Cleanup was explicit: DDB and live Stop each returned HTTP 200 / `ended`; all
three admitted/failed watch cases were unmounted and UI auth revoke returned
HTTP 200 / `accepted: true`. Ether confirmed zero sessions/encoders after the
Inception cases; live cleanup was reported for independent confirmation. The pin
operator confirmed no remaining 1917 or Inception pins. The dedicated
`vela-core-app` Chrome was closed; no candidate server or build remained running.

Safe local evidence: `client/.exact/core-real-inception-uhd-{start,seek,audio,quality}-output.txt`,
`core-real-inception-uhd-transition-errors.txt`,
`core-real-inception-vc1-{start,pgs,pgs-off,cleanup}-output.txt`, and
`core-real-live-{output,cleanup-output}.txt`. These ignored qualification artifacts
are not release assets. The core **must stay gated**. Next blockers are sustained
original audio/read scheduling, the HLS subsequent-fragment format failure,
qualified live colour admission and live fallback parsing, then completed
Original/Auto/PGS/TrueHD transitions through this same real-app path.

Follow-up source correlation for the real-app Inception UHD interval: Ether
measured **662,225,778 delivered bytes over 105.1 s (50.4 Mbps)** against the
selected title's **65.6 Mbps average**. Its shared Real-Debrid host cap of four
connections incurred 272 waits (median 0.77 s, p90 1.98 s, maximum 2.76 s).
Background warm/resume jobs and the broadcast competed with playhead reads.
Ether is addressing foreground priority and background yielding. Therefore the
observed underruns are **not evidence of a faulty DTS decoder**, and the core's
three-request range reader is not being widened speculatively. The second HLS
encoder in that interval was the explicit UI lower-quality request, including
authorization of the locally selected AC-3 track; it was not an unsolicited
parallel fallback.

The HLS error also needs narrower evidence: Ether's real-FFmpeg fixture has one
0.5 s opening fragment, then segments containing four `moof/mdat` pairs. All
156 video / 281 AAC packets demux correctly through the current Vela reader in
an offline metadata run. A generated tagged equivalent also plays to EOS through
the current core in local Chrome (156 frames, zero video drops, no failure).
Thus multiple fragments per object alone do **not** reproduce the lab failure.
A bounded fragment-index/object-shape diagnostic is being added before changing
parsing semantics. Both local browser and fixture server were closed; the
production gate remains unchanged.

### lab.25: padded-fragment root cause and remaining source admission work

The same real-app baseline `89bed67` with context-only core `0865e3b`
(`233780e307081d61`) repeated pinned Inception UHD on lab.25. First frame was
349.8 ms (plan received 111.3 ms). The 30 s sample reached title position
26.746 s with 649 decoded / 637 presented frames, five drops and two underruns;
one buffering interval lasted wall 20.11–23.10 s. This improved the previous
source-starved sample but remains **not a clean sustained-play pass**.

At about wall 70.7 s / title 55.153 s, the original route aborted and automatically
requested Ether HLS in the same app session. Ether independently found three
upstream reads waiting 8.5 s without obtaining a connection: an admission
regression, subsequently fixed for lab.26. The core's bounded source wait was
not widened. Lab.26 also joins overlapping forward read-ahead instead of
cancelling/redialing it and suppresses resume warming beside active playback.
These producer changes require another measured run; no result is inferred.

The new diagnostic established the HLS failure precisely. Both the automatic
fallback and the later explicit 720p switch rejected **fragment 0**:

- fallback: 1,680,537 bytes, `free,free,styp,moof,mdat`;
- 720p: 181,550 bytes, `free,styp,moof,mdat`.

These are valid padded MP4 objects. The pinned library's MP4 probe checks for
`styp` at byte zero, then uses a separate bounded box walk that skips `free` but
only recognizes `moof/sidx/moov/mdat`. A `styp` following the skipped padding
therefore incorrectly becomes `UnsupportedInputFormatError`. The earlier
multi-`moof` hypothesis was disproved by the unpadded local EOS pass.

Vela's source-complete build adaptation now recognizes `styp` in that existing
bounded walk. It preserves box-size validation and all later demux/decoder
checks; it neither rewrites received bytes nor edits the pinned vendor checkout.
A generated exact before/after reproduction fails with the unmodified probe and
then reads **156 video / 281 AAC packets** with the adaptation. Its segments cover
single `free`, consecutive `free`, extended-size `free`, and an unpadded control.
Full browser EOS/seek and a fresh real-app candidate including the PGS compression
fix remain the next gates before declaring this repaired on the lab.

The lab.25 test ended with UI Stop 200 / `ended`, auth revoke 200 / accepted,
unmounted player and closed dedicated Chrome. The coordinator removed the pin
(DELETE 204, independent GET empty) and confirmed zero sessions/FFmpeg processes.
Production remained on the wrapper. Scalar evidence is in
`client/.exact/core-lab25-{direct-output,hls-output,all-failures,cleanup-output}.txt`;
no provider media bytes or private headers were captured.

The padded-fragment repair subsequently passed the broad player TypeScript check
(including PGS `02f841e` and its final annotation) and produced core payload
`8758a83c20733c08`. In local headed Chrome, the padded single/multi-fragment
fixture remained on `vela-core`/WebGPU, sought to 3.25 s in **14.1 ms** with warm
local bytes, and reached 6.5 s EOS with **zero video drops, zero sampled audio
underruns and no fallback/error**. Player destruction left zero video/canvas
nodes; its dedicated browser and fixture server were closed. This is a generated
local reproduction, not a lab throughput result.

A separately reported ambient freeze did not reproduce in the native module:
normal-motion headed Chrome advanced ambient core frames 77→91 and native preview
frames 75→89 while RAF advanced 365→435; HeadlessChrome 157 with a real clock
advanced 75→89 / 71→85 and RAF 181→215. Both screenshots and a button click
succeeded, followed by zero-node cleanup and browser closure. This clears the
module-level comparison only. The reported Exact document/Broadcast drive with
its virtual clock is a different boundary; cinematic's normal-motion headless
Home drive also rendered/tapped successfully but never mounted a preview because
its deferred timer awaited another clock commit. No user-agent or GPU-disable
workaround was added to playback.

### Browser host and core responsibility split (2026-11-16)

The web core remains independent of Exact and React. `core/runtime.ts` is a public
facade; source/session lifetime, decode epochs and packet delivery, clock admission,
live-window handling, transport, and telemetry have separate modules with typed
state. `engine.ts` is the browser host facade, with browser events, source activation,
track commands, recovery, startup watchdogs, observations and lifecycle in `host/`.
`browser-view.ts` owns the DOM surface and the existing props/event adaptation;
`web-module.ts` temporarily registers it with Exact. Expo will mount the same host
through a typed React view, and Metro will bundle its JavaScript. Only decoder,
worker, worklet, subtitle and other static assets need the separate immutable export.
The old runtime loader is still present until the approved excision; this refactor
has not selected a new production default.

A generated 640×360 H.264 Matroska fixture with two AAC tracks and embedded PGS
was driven before and after the structural split in dedicated headed Chrome contexts.
Both started, paused, sought to 1.5 and 4.5 seconds, painted 3,168 opaque subtitle
pixels at each target, switched to the second audio track, cleared subtitles, and
resumed. Both reported zero audio underflows, video drops, recoveries and repeated
source pages; both requested 1,941,345 physical bytes. The scoped TypeScript compile,
core asset assembly and browser host build passed. These are local correctness
proofs, not the pending real-title matrix or a controlled speed comparison: Ballast
rose from WARNING to CRITICAL during the proof window. Every owned context and the
fixture server was closed afterwards.

Readability inventory over the same surviving source scope, including new modules:

| Stage | Files | Lines >120 columns | Lines >200 columns |
| --- | ---: | ---: | ---: |
| Before formatting | 77 | 1,210 | 247 |
| Mechanical formatting | 77 | 35 | 7 |
| Responsibility split | 112 | 32 | 6 |

The browser engine class changed from 61 fields in 843 compressed lines (2,035
formatted lines) to one context field behind a small public facade. The former
718-line formatted core class likewise has one context field. The largest remaining
file is `core/demux/matroska-stream.ts` (934 lines); the largest remaining class is
`RangeReader` (864 formatted lines, 34 fields). The remaining long lines are mostly
literal dependency-source transforms and imports that the direct-dependency cutover
must replace, not compressed playback control flow.

### Expo browser seam

`createWebPlayerHost` in `client/player/host.ts` implements the runtime-neutral
`packages/player-api/src/types.ts` contract. React Native's view style is added only
by the package's `index.ts`. The DOM host accepts typed plans/sessions, consumes each
command id once, publishes snapshots and observations, and separates server command
requests from local command completion. An ambient change requires a remount.

The trusted controller provides `options.access()`, not a credential prop. It must
replace that object and update the host on a server, principal or credential change.
The host retires the old request scope, rejects stale async replies, constrains every
media request to the origin/path, refuses redirects, and confines native URL
credentials to element attachment. The scoped header snapshot needed by dedicated
workers remains private and is dropped on disposal.

The Expo host injects core and subtitle constructors imported into the application
JavaScript graph. It does not import a remote `runtime.js`. Its asset base is a
same-origin `player/<64-hex-digest>/` directory containing decoder, worklet, subtitle
and other static assets. The agreed `PLAYER-ASSETS-MANIFEST.json` digest is SHA-256
of bytewise-path-sorted records `path + NUL + bytes + NUL + sha256 + newline`,
excluding the manifest itself. The final release inventories and signs the manifest.
The source-complete static builder and direct-dependency excision are still pending;
the current local proof bundle uses the existing pinned dependency adaptations.

The typed host was bundled locally and driven in headed Chrome against the same
short two-audio/PGS fixture: start, both seeks, 3,168 caption pixels, audio switching,
command deduplication and a truthful invalid-command acknowledgment passed. Scoped
header fetches succeeded; redirect/cross-scope requests were refused with zero
requests reaching the outside route; credential query parameters were stripped
from header-authenticated fetches. Native query credentials remained attachment-only.
No `runtime.js` was requested, and disposal left zero media nodes. This is a DOM-host
proof, not yet an Expo export or real-app release qualification.

### Expo web module (modules/vela-player, web)

`modules/vela-player/src/VelaPlayerView.web.tsx` mounts `createWebPlayerHost` into the
DOM node react-native-web draws for a `View`. `VelaPlayer.setMediaAccess` keeps the
trusted controller's access in `web/media-access.ts`; a change re-applies the view's
props so the host retires the old request scope. `VelaPlayer.capabilities()` (now part
of the contract) is the browser probe in `web/capabilities.ts`: the payload's
`capabilities.json` says what was installed, the browser and the qualified lists decide
what is advertised.

The upstream player and its Mediabunny fork are pinned package dependencies of
`modules/vela-player` (`webgpu-player` at a7a95ef, `mediabunny` at e9303e8, from GitHub
through bun.lock); there are no submodules, and `bun install` is the only setup. Metro
bundles the core and the upstream modules it imports from their TypeScript sources
(`web/metro.js`, applied by `apps/vela/metro.config.js`); the core is an async chunk
loaded on first playback. The wrapper controller, the runtime.js loader and the frozen
wrapper payload are not reachable from the Expo app. `web/metro-transformer.js` applies the same source
adaptations the qualified core build used (`web/source-transform.ts`) and strips the
upstream TypeScript (Expo's preset refuses `declare` fields). The transformer loads the
adaptation modules in Node, which needs Node 23.6 or newer. The old player is not in
this graph: host runtime services are required, and only the Exact host still passes
`loadedRuntimeServices` (runtime.js by URL), which goes with the Exact app.

The payload is built by

    bun modules/vela-player/web/assets/export-assets.ts --libraries=<prepared libraries> --out=<dir>

It writes `<dir>/player/<digest>/` and prints the digest. Export the app with
`EXPO_PUBLIC_VELA_PLAYER_ASSETS=<digest>` and copy `<dir>/player/` to the export root;
for `expo start --web`, set `VELA_PLAYER_ASSETS_DIR=<dir>` and the dev server serves it.
The builder refuses a dirty tree (`--allow-dirty` records `sourceDirty:true`) and a
bun.lock that does not pin both packages. It verifies every decoder and subtitle
file with a Vela pin, rebuilds the four decoder workers from source with the same
adaptations as the page, and ships Mediabunny's compiled sources as a reproducible
archive, the licences and every Vela file compiled into a worker. Two builds of one revision give the same digest.

Open: the libraries input is still a prepared tree. Decoder packages and subtitle
assets are pinned, but the Dolby Vision parser, audio output stage and range-extension
vectors (built by the upstream WASM toolchain) are accepted by hash and listed under
`prebuilt` in the manifest until that build runs from source here.

### Expo web app: first lab drive (2026-11-16)

Expo web export (player payload `245e0c03…`) served at `/vela` with the API and media
proxied same-origin to the lab Ether, real watch route (`/watch/<id>`), headed Chrome.
1917 (2019): Ether selected the **1080p AVC BluRay remux** (TrueHD Atmos 7.1, PGS) as
an original file, not the title's 2160p HEVC Dolby Vision 7 release; the client cannot
choose a version, so this is **not** the 4K HDR proof. On that file, the core reached
`playing` from ranged original reads; Forward 10 s sought locally and reported the seek
to the server (200); English PGS drew captions (up to 67,466 opaque overlay pixels,
seen on screen); the audio switch from TrueHD 7.1 to English AC-3 5.1 applied locally.
Close sent Stop (200) and left no media elements; the app's and the probe's tokens were
revoked (200). The 4K HDR10/TrueHD/PGS row still needs a title Ether serves as 2160p
HDR to this client. Finding for the app: the spike route `(spike)/player` mounted three
times during sign-in and opened three playback sessions; the watch route opened one.

**4K HDR proof (same day, after Ether pinned 1917 to the 2160p release).** Ether served
`1917.2019.UHD.BluRay.2160p.TrueHD.Atmos.7.1.DV.HEVC.REMUX-FraMeSToR` to the web client
as an original direct file. The core played it as HEVC HDR10 (the Dolby Vision 7 base
layer) at 4K with **0 dropped of 9,096 frames**. Forward and back 10 s sought through the
server (seek commands 200, local resume). English SDH PGS drew on screen (44,249 overlay
pixels at the capture). The TrueHD Atmos 7.1 to English AC-3 5.1 switch applied while
playing. Close sent Stop (200), the token was revoked (200) and Ether was asked to
unpin. Connection measured 16–25 Mbps against the release's 48 Mbps average, with
about 0.3 s of buffer and no stall during the ~7 minutes driven. Open: a seek issued
while the previous server seek was still in flight was dropped (no command sent); the
watch route's remount during sign-in re-posted /playback twice (404 after the first 200).
