# Playback engine

Decision: use Exact's **app web native-view module**, with a `vela-player`
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
recovery requires the same media and edition/timeline identity. Native HLS is
preferred for Safari; MSE/ManagedMediaSource are detected for other streams.
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
