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
