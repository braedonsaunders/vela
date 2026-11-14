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
