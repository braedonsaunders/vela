# Vela v0 / Ether conformance read

Read-only source comparison, 2026-11-13. Ether branch `w0311/vela-frontend`,
fetched commit `4f9559d80713149170e9855826748fed9b4314bf`; every Ether line below
refers to that commit, inspected with git show/git grep. No Ether checkout, edits,
builds or tests. This is a contract review, not an E2E qualification.

Vela corrections landed in `002b710`. Protocol types remain the schema authority.
`E` paths below are relative to Ether `internal/frontends/vela/`; `V` paths are
relative to this repository. The numbered entries below are proposals for Ether, with F3 withdrawn as a current-client defect after checking its native-only probe,
not claims that remediation has landed.

## Shared request/response fields

- Device: id/name/platform/appVersion match `E/frontend.go:143` and
  `V/protocol/v0/types.ts:8`. Authenticated JSON calls require bearer plus
  X-Vela-Device-Id (`E/frontend.go:156`, V README:9); missing/wrong device is 401.
  Optional name/platform/version headers exist on Ether but are not required by v0.
- ClientCapabilities: device, protocolVersions, containers, videoCodecs, audioCodecs,
  subtitleFormats, hls, mse, maxWidth, maxHeight, maxBitrate and hdr are declared in
  `E/playback.go:18`; V types:9. The optional hdr null mismatch is F2 below.
- Viewer id/name/policyRevision and Tokens accessToken/refreshToken/expiresAt/viewer
  match `E/auth.go:15,20,39`; V types:23,24. Optional avatar is omitted legitimately.
- Title id/kind/name/summary/genres/artwork, optional year/durationSeconds/rating/
  showId/seasonNumber/episodeNumber, and watch position/played/favorite/watchlisted
  match `E/catalog.go:34,65,68`; V types:40. seasonId is omitted; it is optional.
- Artwork id/kind/tag/sizes(width,height,url), blurHash/thumbHash match
  `E/catalog.go:85`; V types:35. URLs are image grants, not provider URLs. Only one
  source-size image is offered; no unprobed dimensions or resizes are promised.
- Rows preserve server entry order and title/channel/collection/playlist/directory
  tagged payloads (`E/catalog.go:173`, V types:54). Row id/name/purpose/receiptToken/
  style/items/continuation/nextCursor match. Empty receipts in the neutral legacy
  fallback cannot attribute feedback; clients must not manufacture them.
- Detail title/canPlay/seasons/episodes/extras/chapters/cast/crew/mediaSummary match
  `E/catalog.go:290`, `E/detail.go:12,68,101`; V types:47–53. Unknown optional fields
  are omitted. Show detail includes first-season episodes; season detail omits the
  sibling season list, which is a UI limitation but allowed by the optional schema.
- PlaybackPlan sessionId/revision/generations/state/position/duration/target/paths/
  selectedPathId/tracks/selected-track IDs/chapters/fallback match names and units
  (`E/playback.go:194,223`, V types:71–100). Source identity is omitted when unknown;
  empty boundaries and unsupported fallback correctly avoid fabricating continuity.
  Delivered subtitle format and live mode need F4/F9. F3 records the native-HLS clarification.
- Snapshot cursor/revision/plan/publishedRanges/lastObservationSequence and event
  cursor/revision/sessionId/type plus snapshot/plan/reason match
  `E/playback.go:262,275,473`, V types:101–106. Empty publishedRanges is no proof of
  publication, not evidence of an outage. No server error events are currently sent.
- Channel id/number/name/kind/artwork/favorite/rating and Programme id/channelId/
  name/summary/start/end/episodeTitle/seasonNumber/episodeNumber/artwork/rating match
  `E/live.go:28,71`, V types:111. Optional programme titleId is omitted.

## Endpoint coverage

All POST rows below pass the common idempotency envelope first. Success responses
are 200 JSON with no-store unless marked ETag. Generic failure mapping is F6;
rotation/replay lifetime is F7/F8. Common authorization is checked before metadata
and cached-response selection, apart from the explicitly public JSON routes and F10.

| Method and path under /vela/v0 | Request / field behavior | Response, cache and pagination | Ether source / finding |
|---|---|---|---|
| GET /capabilities | Public; no body | ServerCapabilities; ETag; optional features explicitly false for AI/fallback/extra playback | frontend.go:299,335; F13 |
| POST /negotiate | client declaration; validates protocolVersions and device.appVersion compatibility | NegotiateResponse echo; no-store; public | frontend.go:199,340; F2; V clarification C4 |
| POST /auth/sign-in | username/password/device; Device fields map to neutral identity | Tokens; no-store | auth.go:54 |
| POST /auth/refresh | refreshToken/device; rotates through identity service | Tokens; same serialized request can replay durable response | auth.go:61; F7/F8 |
| POST /auth/revoke | bearer/device authoritative; refreshToken body is not used to choose another grant | Ack; current access revoked; refresh service requires its current access to remain live | auth.go:68; identity/refresh.go:127 |
| POST /auth/web-code/redeem | code/device; scope-specific neutral one-time redemption | Tokens; no-store | auth.go:79 |
| POST /auth/device | device; neutral pairing grant, portal URL | deviceCode/userCode/verificationUrl/expiresAt/pollIntervalSeconds | auth.go:93,108,117; F13 |
| POST /auth/device/poll | deviceCode/device | pending or approved+Tokens; invalid/expired secrets can return auth/401 | auth.go:118; see terminal poll note below |
| POST /auth/device/approve | userCode; authenticated approving viewer/device | Ack | auth.go:149 |
| POST /auth/quick-connect | device | secret/code/expiresAt/pollIntervalSeconds | auth.go:93,104 |
| POST /auth/quick-connect/poll | secret/device | pending or approved+Tokens; same terminal-status caveat | auth.go:118 |
| POST /auth/quick-connect/approve | code; authenticated approving viewer/device | Ack | auth.go:149 |
| GET /bootstrap | viewer/device; placement defaults home | viewer/capabilities/defaultSkinId/rows; hero and top-level nextCursor absent; ETag | catalog.go:251 |
| GET /rows | placement/titleId accepted and passed to experience; cursor rejected; limit affects inner rows | Page<Row>, exhausted outer page; ETag; actual rows may exceed requested outer limit | catalog.go:104,264; F11 |
| GET /rows/:id | id/cursor/limit; signed row token validates row/viewer/device/policy/expiry/offset | Row; more+nextCursor with RowViews, otherwise unknown on truncation; ETag | catalog.go:122,237; rows.go:18–54 |
| GET /collections/:id | cursor/limit expected | CollectionContents missing; falls through to 404 | frontend.go:304–330; F1 |
| GET /titles/:id | policy-checked item id | TitleDetail, ETag | catalog.go:290; detail.go:101 |
| GET /titles/:id/children | id/limit; nonempty cursor rejected | Page<Title>, unknown when bounded page fills, no invented nextCursor; ETag | catalog.go:337 |
| GET /titles/:id/extras | policy-checked parent id | items of Extra metadata, unavailable playback, no cachedPlayback; ETag | catalog.go:306 |
| POST /titles/:id/watch | played/favorite/watchlisted optional booleans; authorizes parent before writes | Ack | catalog.go:444 |
| POST /search | query/generation/limit used; cursor rejected; mode shares the same neutral search | query/generation/items/continuation; no receipt invented; no-store; NoProviderWait | catalog.go:367 |
| POST /search/ai | feature unavailable, so no job is created | policy/403 feature_unavailable, no-store | frontend.go:311,332 |
| GET /search/ai/:id | feature unavailable | policy/403 even without auth | frontend.go:312,332; F10 |
| POST /search/ai/:id/cancel | feature unavailable; common envelope still requires key/auth | policy/403 feature_unavailable | frontend.go:313,332 |
| POST /interactions | receiptToken/kind mapped; occurredAt parsed; visibleMilliseconds/sessionId not used by neutral reporter; max100 | Ack; handle membership and device scope checked by reporter | catalog.go:402 |
| POST /playback | titleId/channelId, client, position, allowTranscode and initial tracks map; extraId rejected; liveMode ignored | PlaybackPlan; no-store; omission resumes, explicit zero preserved | playback.go:55; F3/F4/F9/F14 |
| GET /sessions/:id | owning viewer/device | SessionSnapshot; no-store | playback.go:247,288; F12 |
| GET /sessions/:id/events | owning viewer/device, Last-Event-ID preferred over query cursor | SSE SessionEvent; no-store; replay or authoritative snapshot, heartbeat15s | playback.go:437; F8/F12 |
| POST /sessions/:id/commands | kind/generations; stop/seek/pause/resume implemented; tracks/switch/prepare unavailable | PlaybackPlan or policy/403; seek increments seek generation, stale generations409+currentGenerations | playback.go:297,304 |
| POST /sessions/:id/observations | sequence/generations/position/state/selectedPathId consumed; other observation fields ignored | Ack; old sequence ignored; non-buffering changes publish plan, ended publishes terminal event | playback.go:375; F5 |
| GET /live/channels | limit; nonempty cursor rejected | Page<Channel>, unknown when truncated; ETag; unavailable host403 | live.go:10 |
| GET /live/guide | RFC3339 from/until; positive <=24h window; comma channelIds <=100; cursor rejected; limit+1 probe | GuideResponse; original programme times preserved; unknown when truncated; ETag | live.go:38 |

Terminal poll note: the neutral identity boundary only distinguishes pending from
unauthorized; invalid, expired or consumed codes can produce 401 rather than
GrantPoll.expired/denied (`E/auth.go:130`, `internal/identity/quickconnect.go:323`).
The client already has the initiation expiresAt. This is not a malformed success
response; document/handle the auth error rather than inventing a denial reason.

## Ether divergences and proposed resolutions

| ID | Ether evidence at fetched SHA | Vela contract / consumer evidence | Proposed resolution |
|---|---|---|---|
| F1 | `frontend.go:304–330`: no collections route; catchall404 | `protocol/v0/README.md:32,157`; `types.ts:122`; adapter/ether/index.ts:104 | Implement authorized collection/playlist/directory contents with ordered RowEntry receipts and ETag/pagination. Until available, do not advertise destinations that always404. |
| F2 | `playback.go:18–30`: optional HDR slice has no omitempty; negotiate marshals struct at frontend.go:354. Omitted hdr becomes null. | `types.ts:12`: hdr is absent or string[], never null | Preserve declared optional presence with omitempty/pointers or a dedicated response mapper. Do not widen the client type to accept invalid null arrays. |
| F3 (clarified, not a current defect) | `playback.go:115,171–175,194`: non-direct plans require client.hls; otherwise decoder/422. Native HLS has qualities=[] | `client/player/media-capabilities.ts:16` declares hls from the native HLS MIME probe, independently of mse at :17; `types.ts:11` and README now explicitly document this | Current client does not declare HLS merely for MSE availability, so the originally reported MSE-only ready-plan scenario is not reached. Keep fail-closed rejection explicit; future MSE rendition support must provide actual compatible qualities, never invented codecs. |
| F4 | `playback.go:205,212,216`: t.codec keeps source codec but URL requests vtt | `types.ts:71`; README:178; player/protocol.ts:13 filters delivered VTT/WebVTT | Set wire subtitle codec to webvtt/vtt when delivering VTT; retain original codec only in source mediaSummary. |
| F5 | `playback.go:380–384,431`: observed audioTrackId/subtitleTrackId are not read; every plan keeps old selected values. Buffering also does not update/publish recovering state. | `types.ts:96–100`; README:108; player/protocol.ts:11,37 | Validate actual observed selections against offered tracks and preserve them, including null/off, without claiming broker track-command support. Publish an honest recovering state for buffering observations. Otherwise the next SSE plan resets a locally selected subtitle. |
| F6 | `frontend.go:96–111` misses ErrSessionBusy/ErrSourceGone and discards typed RetryAfter; problem():94 always denies retry. playback.go:157 uses source/503. | README:135–139; types.ts:107; neutral session_busy.go:11 and sessions/media.go:61,100 prove error classes exist | Classify admission busy as capacity, retired source as source; use source/502 consistently. When backend supplies bounded retry delay, propagate retry.allowed/afterSeconds/maxAttempts and Retry-After rather than telling clients never to retry temporary admission exhaustion. |
| F7 | `frontend.go:201,218`: authenticated idempotency namespace is raw Authorization. Refresh changes access token. | README:91–95, scope is grant and retained24h | Namespace mutations by stable authenticated login/refresh family plus method/path/key (with current auth/policy checked), not rotating bearer bytes. Otherwise retried playback after rotation misses its original replay record. |
| F8 | `events.go:11,31–37` captures original access token and ends session when it stops resolving. identity/refresh.go:152 explicitly revokes it during valid refresh. | README:94,120–125; Tokens at types.ts:24 | Distinguish refresh rotation from explicit revocation using a stable authorized grant-family binding or update session authorization on refresh. Current fresh-token SSE reconnect can succeed then be terminated by the old-token watcher within15s. Do not disable real revocation checks. |
| F9 | `playback.go:61–68` omits liveMode; :223 always sets durationSeconds, :227–231 gives channelId but no live mode | `types.ts:86,90`; README:175–177; client/player/protocol.ts:10 | For a channel, echo accepted initial buffering mode as live.mode and omit unknown live bounds and total duration. No invented live edge is required after Vela's optional-window correction. |
| F10 | `frontend.go:312,332`: GET AI job unavailable handler does not call viewer | README:9–13 (AI jobs are authenticated); types.ts:65 | Authenticate the GET before returning feature_unavailable, preserving403 for authenticated callers and401 for missing/wrong device credentials. |
| F11 | `catalog.go:146,168,288`: top-level rows returns every row; supplied limit only affects row items | README:30,52; types.ts:7,61 | Apply outer Page<Row> limit to row count, with honest unknown/more continuation. Keep item limit semantics on /rows/:id. Alternatively explicitly separate rowLimit/itemLimit in an additive contract; do not silently overload one page limit. |
| F12 | `playback.go:234–241` prunes ended entries only when another playback starts; :247 session lookup never checks ended age | README:124–125 | Enforce ended retention expiry during lookup/reconnect as well as opportunistic creation cleanup; otherwise an idle server retains and returns final sessions indefinitely. |
| F13 | `frontend.go:338` hardcodes password/device/quick features true; auth.go:108 can reject device initiation when ViewerPortalURL nil. Identity policy can reject sign-in/quick connect (app/frontend_identity.go:197). | `types.ts:14–20`; README:153–154; accepted honest-capability requirement | Derive auth feature flags from current neutral identity/portal availability or report unavailable when capability cannot be established. Conditional configuration mismatch, not evidence that the present lab has these features disabled. |
| F14 | `playback.go:69–70`: valid extraId target always request/400 invalid_target, despite its recognized schema and extraPlayback=false | `types.ts:87–90`; README:153–154 | Recognize well-formed extra target and return policy/403 feature_unavailable until neutral extra-play capability exists. Reserve400 for malformed/multiple targets. |

## Vela corrections landed

- C1: `client/src/protocol/events.ts:21` now marks plan state ended on terminal SSE;
  unknown future events at :23 await authoritative snapshot rather than failing the
  resource while merely suggesting a refresh. Snapshot cursor/revision are retained.
  Ether emits terminal events without a plan at `E/playback.go:275–279`; compatibility
  fallback is required by V README:146. Exact's existing async mapper is used.
- C2: `client/src/protocol/media.ts:4` now rejects cross-origin, userinfo and non-broker
  path URLs instead of blindly resolving them. The opposite side legitimately emits
  `/sessions/media/...` (`internal/sessions/media.go:106`, subtitles.go:51), matching
  V README:55. No media token is rewritten.
- C3: `client/player/protocol.ts:10` now recognizes channelId as live without requiring
  optional measured window facts. V types:86 now makes unknown bounds optional;
  opposite side `E/playback.go:230` supplies channelId but no window. The playback
  worker owns rebundling and safe native/MSE anchoring with unknown bounds.
- C4: README:9,169 clarifies public, declaration-only negotiation to match
  `E/frontend.go:199–216,340`, and scoped binary URL-grant authorization rather than
  impossible bearer headers on image/video elements. Mock negotiation mirrors it.
  This does not grant playback policy or loosen authenticated JSON endpoint checks.
- C5: README:172 documents identical serialized JSON for idempotent retries, matching
  `E/frontend.go:219` and the mock. README:178 clarifies delivered subtitle codec and
  no-publication-proof semantics rather than asking a backend to invent measurements.

- C6: `client/player/model.ts:11` and `protocol.ts:9` now carry authoritative
  plan state to the engine; `engine.ts:136` applies paused/playing/ended transitions
  without treating repeated telemetry plans as play commands. Terminal state cancels
  media and suppresses an observation echo in `web-module.ts:32`. This completes
  C1's native-host effect for `E/playback.go:275–279` and V types:83. Playback owner
  landed and bundled it in `ce92fd1` and `f1129f3` while retaining slice ownership.

Compile evidence: one client Contract build returned [], mock tsc and standalone
player protocol tsc passed for the corrections. No Ether checks or browser loops
were run for this source review. Later source changes, fixes and lab E2E need their
own qualification; this document deliberately pins the reviewed Ether commit.

Implementer review: Ether accepted F1/F2/F4–F14 for remediation (F1 will suppress
unsupported destinations until a neutral ordered receipt-bearing contents service
exists). F3 was corrected after checking the current client probe: it is a contract
clarification, not a current interoperability defect. Follow-up fixes are not
assumed present at the pinned SHA above.
