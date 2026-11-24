# Vela v0

`types.ts` is the wire source of truth. JSON over HTTPS, base `/vela/v0`.
Times are UTC RFC3339; positions/durations are seconds; bitrates are bits/s.
IDs, continuation cursors, receipt tokens and source identities are opaque.

## Endpoints

All endpoints require `Authorization: Bearer <accessToken>` except capabilities, appearance,
negotiation, sign-in, refresh, grant initiation/polling, quick-connect initiation/polling and
web-code redemption. Authenticated calls also require `X-Vela-Device-Id: <device.id>`.
Device identity binds credentials and sessions. All POSTs
require a nonempty body `idempotencyKey`; no tokens in URL query parameters.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | /capabilities | — | ServerCapabilities |
| GET | /appearance | — | Appearance (public, cacheable) |
| GET | /events | Last-Event-ID (header) | SSE ServerEvent (viewer-level) |
| POST | /negotiate | NegotiateRequest | NegotiateResponse |
| POST | /auth/sign-in | SignInRequest | Tokens |
| POST | /auth/refresh | RefreshRequest | Tokens |
| POST | /auth/revoke | RevokeRequest | Ack |
| POST | /auth/web-code | WebCodeIssueRequest | WebCodeIssueResponse |
| POST | /auth/web-code/redeem | WebCodeRedeemRequest | Tokens |
| POST | /auth/device | DeviceGrantRequest | DeviceGrant |
| POST | /auth/device/poll | DevicePollRequest | GrantPoll |
| POST | /auth/device/approve | GrantApproveRequest | Ack |
| POST | /auth/quick-connect | DeviceGrantRequest | QuickConnect |
| POST | /auth/quick-connect/poll | QuickPollRequest | GrantPoll |
| POST | /auth/quick-connect/approve | QuickApproveRequest | Ack |
| GET | /bootstrap | — | Bootstrap |
| GET | /libraries | LibrariesQuery (query) | Page<Library> |
| GET | /libraries/:id/items | LibraryBrowseQuery (query) | LibraryContents |
| GET | /libraries/:id/rows | cursor, limit, tab (query; tab with features.pluginLevels.tabRows) | Page<Row> |
| GET | /libraries/:id/live | LibraryLiveQuery (query) | LibraryLiveContents |
| POST | /libraries/:id/live/play | LibraryLivePlaybackRequest | PlaybackPlan |
| GET | /rows | RowsQuery (query) | Page<Row> |
| GET | /rows/:id | cursor, limit (query) | Row |
| GET | /collections/:id | cursor, limit (query) | CollectionContents |
| GET | /titles/:id | — | TitleDetail |
| GET, HEAD | /themes/:grant/theme.m4a | opaque URL grant; optional Range header | theme audio bytes |
| GET | /titles/:id/children | cursor, limit, role or level (query; role/level with features.pluginLevels.childRoles) | ChildrenPage |
| GET | /titles/:id/extras | — | ExtrasResponse |
| POST | /titles/:id/trailer-preview | TrailerPreviewRequest | TrailerPreviewResponse |
| GET | /titles/:id/trailer-preview | — | TrailerPreviewResponse |
| POST | /titles/:id/watch | WatchRequest | Ack |
| POST | /titles/:id/read | ReadingRequest | ReadingGrant (features.reading) |
| POST | /titles/:id/reading-progress | ReadingProgressRequest | Ack (features.reading) |
| GET | /titles/:id/recording | — | RecordingReleases (features.duplicates) |
| GET | /history/recap | period, at, library (query) | HistoryRecap (features.historyRecap) |
| POST | /playlists/import | PlaylistImportRequest | 202 PlaylistImportJobRef (features.playlistImport) |
| GET | /playlists/import/:id | — | PlaylistImport (features.playlistImport) |
| POST | /playlists/import/:id/save | SavePlaylistImportRequest | PlaylistCard (features.playlistImport) |
| GET | /libraries/:id/duplicates | cursor, limit (query) | DuplicateGroupsPage (features.duplicates) |
| POST | /libraries/:id/duplicates/:recordingId | DuplicatePreferenceRequest | DuplicateGroup (features.duplicates) |
| POST | /search | SearchRequest | SearchResponse |
| POST | /search/ai | AISearchRequest | AISearchJob |
| GET | /search/ai/:id | — | AISearchJob |
| POST | /search/ai/:id/cancel | CancelRequest | AISearchJob |
| POST | /interactions | InteractionsRequest | Ack |
| POST | /playback | PlaybackRequest | PlaybackPlan |
| GET | /sessions/:id | — | SessionSnapshot |
| GET | /sessions/:id/events | cursor (query), Last-Event-ID (header) | SSE SessionEvent |
| POST | /sessions/:id/commands | SessionCommand | PlaybackPlan |
| POST | /sessions/:id/observations | PlayerObservation | Ack |
| GET | /sessions/:id/subtitles/search | language (query, optional) | SubtitleSearchResponse (features.subtitleSearch) |
| POST | /sessions/:id/subtitles/:offerId | Mutation | PlaybackPlan, or 202 PlaybackPreparing (features.subtitleSearch) |
| GET | /sessions/:id/trickplay/:width/:sheet.jpg | bearer + device; optional If-None-Match | private JPEG sprite sheet or 304 |
| GET | /live/channels | cursor, limit (query) | Page<Channel> |
| GET | /live/guide | GuideQuery (query) | GuideResponse |
| GET | /screens/:id/pages/:page/document | v, r, l (query); X-Vela-Screen-Renderer | ScreenDocument (screen.ts) |
| GET | /screens/:id/pages/:page/data | sources, p.<param>, tz (query) | ScreenData |
| POST | /screens/:id/actions/:action | ScreenActionRequest; Idempotency-Key | ScreenActionAnswer |
| GET | /surfaces/:id/document, /surfaces/:id/data | as screens; context as p.<name> | ScreenDocument, ScreenData |
| POST | /surfaces/:id/actions/:action | ScreenActionRequest | ScreenActionAnswer |
| PUT | /surfaces/:id/setting | {enabled} | 204 |
| GET | /live/stream | topic (repeated), since, tz, alerts=1 (query) | SSE `records` StreamRecords, `source` StreamSource, `alert` AlertFrame, `heartbeat` (25 s) |
| POST | /multiview | MultiviewRequest | MultiviewGroup (features.multiview) |
| DELETE | /multiview/:groupId | Mutation | Ack or 204 |

Plugin screens and surfaces are in [screen.ts](screen.ts) (docs/plugin-screens.md); multiview and
the session's live event are in [live-events.ts](live-events.ts). Bootstrap `navigation` lists
plugin screens (`{kind: 'screen', id, title, icon, page, document}`) as top-level sections, and
`surfaces` the plugin surfaces this client may show.
A live-channel session's snapshot carries `liveEvent` (`{id, feed}` or null) and its event
stream sends `event: liveEvent` with `{liveEvent}` when the programme on air changes. A
multiview tile past an IPTV provider's connection cap is refused with HTTP 409
`provider_connection_cap` (class `capacity`, `details: {provider, max, inUse}`).

Plugin levels (`features.pluginLevels`): with `tabRows`, `GET /libraries/:id/rows?tab=<id>`
answers any `recommended` tab's own shelves (no tab, or the first recommended tab, is the
library's rows as before), and a tab's `card` shapes its rows and items over the library's.
With `childRoles`, a container title carries `media.childCounts` (`{album: 42, concert: 7}`)
and `GET /titles/:id/children?role=<key>` pages within one key. A video child (a concert
under an artist) is `kind: 'movie'`, `media: {class: 'video', role}`, with `parents` back to
its container, and plays as any video title.

Guide `channelIds` is a comma-separated list; window is half-open `[from,until)`;
return programmes overlapping the window, with original untrimmed times. Maximum
window 24 hours; pages default 50, maximum 100. Children returns seasons for a show
and episodes for a season. A show/season cannot itself start playback.

Media URLs are broker-owned `/sessions/media/<session>/<token>/master.m3u8`,
variant playlists, CMAF init/segments, subtitle resources (including progressive
cues) or a direct file. There is no parallel Vela media API. A plan advertises only
currently authorized paths, never provider credentials. Media grants expire and
must be revalidated against the owning device/session and current policy.

Media range responses may include `X-Ether-Media-Cap-Wait-Ms`, a nonnegative
integer number of milliseconds that the range waited for an upstream connection
slot. `0` means no connection-slot wait. An absent header means the wait is
unknown; clients must preserve that conservative unknown state rather than treat
absence as zero.

Subtitle `Track.delivery` optionally describes an external `webvtt` or
`webvtt-window` URL, an `embedded` source track, or `burn-in` delivery. Omission
makes no delivery claim. `Track.streamIndex` remains the full source stream index;
embedded/burn-in PGS retains codec `pgs`, while converted external text may report
`webvtt`. The existing `Track.url` remains available for external VTT. Windowed VTT
uses `from_ms` in absolute title milliseconds; cue timestamps also remain absolute
title time, including after seeking. These resources use the same broker grants
and policy checks as other media. This field does not change quality codec
readiness, audio selection or client capability declarations.

### Theme music

`features.themeMusic` is optional; absence means unavailable. Optional
`Title.themeMusic` supplies a ready audio grant with required `url` and
`expiresAt`. Omission makes no availability claim for that title. Optional
`durationSeconds` is omitted when unknown; `loudness` is measured integrated LUFS,
omitted when unmeasured. Neither value is estimated by the client.

The relative `/vela/v0/themes/<64hex>/theme.m4a` URL is an opaque secret
capability; do not log or persist it. Native audio GET/HEAD needs no bearer or
device headers and supports byte ranges. Grants last ten minutes, are bound to
the host, issuing grant family and device, and recheck the current viewer/item
policy on every read. Missing, expired or revoked grants return 404. Fetch title
detail again for a refreshed grant. Responses use `Cache-Control: private,
no-store`; service workers and API/media caches must bypass these resources.
Theme audio creates no playback session, watch progress or interaction receipt.

## Identity and Ether mapping

Implement in `internal/frontends/vela` against `internal/frontend` neutral host
contracts. Follow mediabrowser auth/session/PlaybackInfo patterns and Silo's native
Descriptor/Mount/Listeners/config/status conventions: Apps card named Vela, host
managed enable/disable/config, shared `/vela` prefix. Disable closes subscriptions.
Reuse identity Grants IssueLogin/IssueRefresh/Refresh, device and quick-connect
services. Web-code redeem uses RedeemWebCode for the console's IssueWebCode Watch
handoff; it is single-use, expiring and device-bound. Device grants appear in
Sign-in & devices and revocation invalidates API, events and media access.

Rows/ordering/heroes use Experience and frontend_experience, including owner layout
and viewer policy. Receipt tokens map to issued row/entry handles. Visibility is
actual viewport visibility; selected means click; played means actual playback.
Never fabricate rank handles or treat prefetch as an impression. Artwork URLs are
sized policy-checked grants. Detail/children use Item/Children; extras use Extras
and ExtraStreams; live data uses LiveTV. Capability declarations pass through host
capability policy and do not prove hardware decoding. Plans use the session broker;
source substitution must validate edition, timeline, codecs and track mappings.

Bootstrap.heroes is an optional ordered list of at most six featured titles from
the personalized experience service. Each Hero preserves its issued receiptToken;
policy-filter and deduplicate title IDs against each other and the home rows.
Omission or an empty array means no featured source is currently available. There
is no singular hero field or legacy fallback. Clients may rotate presentation in
this order; they must not invent candidates, rank handles or playback readiness.
An optional trailer is metadata; on-demand preview playback requires a ready,
unexpired broker grant from the trailer-preview endpoint. The mock's six explicit demo selections have
grant-bound receipts and are absent from its home-row fixtures.

Each Hero has a required reason (resume, nextEpisode, newRelease, forYou, trending,
featured), a required action {kind:resume|play|details,titleId,positionSeconds?},
and an optional short supporting/reason label (never the primary button text).
Clients localize Resume/Play/More info from the action and actual target facts;
"Popular this week" is a reason chip, not a play-button label.
The first slot is the host's top predicted action;
remaining personal picks are interspersed with trending. Fill to at least five
whenever the authorized library can supply five distinct eligible candidates,
using actual trending or recently added/released sources when needed; never pad
with invented candidates or claim exhaustion merely because a bounded shelf is
short. Fewer is allowed only when the eligible library cannot supply five.

Every hero requires actual authorized landscape backdrop artwork. A backdrop
reference with a signed URL and honest unknown0/0 dimensions is permitted; known
portrait or square dimensions are not landscape. Do not fetch art bytes on
bootstrap merely to infer dimensions. Reason provenance must be preserved by
the host: resume requires a positive persisted watch offset; nextEpisode requires
a neutral-selected authorized episode; newRelease may represent recently released
or recently added content (label must distinguish when appropriate); forYou and
trending require actual personal/trending producer provenance. Featured requires
an explicit owner pin of that title, not merely a promoted/hero-style row.

Actions target an actual authorized item. Resume includes its saved position;
play starts that movie/episode (explicit zero starts over); details opens the
specified title. Show/season IDs cannot be play/resume targets. A nextEpisode
action always carries the episode ID, even if the display title is its authorized
show; preserve the selected episode's receipt. Clients execute the server action,
not an inferred target from the display card. Labels may include real season/
episode facts, but are omitted when unavailable. No guessed episode walks,
positions, release dates, labels or ranking receipts. Update cursor exclusion
limits alongside the six-hero limit. Required-field client/server changes must
ship together; do not send this shape's consumers an older hero schema.

### Trailer previews

features.trailerPreview.available declares the actual preview cache/broker
capability; absent/off disables preview requests. Row.previewOnFocus is an
optional per-row opt-in (absent=false). Hero.previewOnFocus carries that same
owner toggle from the featured source row; absent=false. Hero preview requests
require both the capability and that hero's explicit true flag, including when
trailer metadata or a cached grant is present. Capability alone never opts a hero
in; do not infer the flag from another row or from trailer availability.
Hero and focused-card previews use the same authenticated
`POST /titles/:id/trailer-preview` to request preparation, then
`GET /titles/:id/trailer-preview` to poll, with a matching client device.
The host authorizes the title before checking/preparing cached trailer media.
Ready/preparing/unavailable are200 no-store results; a missing/hidden title is404.
Unsupported feature is403 feature_unavailable, never a fake ready grant.

GET returns the same `TrailerPreviewResponse` shape for an already-requested
preview in the authenticated viewer/device scope. It never starts preparation;
when no preview was requested it returns404. GET has no request body or
idempotency key. Clients POST once per preview intent, then poll with GET rather
than issuing repeated preparation POSTs.

TrailerPreviewResponse is ready with grant, preparing with retryAfterSeconds,
or unavailable with reason. Preparing creates no session/grant and carries
Retry-After; bounded cache preparation may continue after the UI cancels interest.
Poll with GET only while still interested, at the supplied delay. Retries of the
initial POST retain its idempotency key and replay its original result, including
preparing; a new preview intent uses a new key.
A ready grant has sessionId, URL, mimeType, expiry, purpose=preview and the source/
seek generations needed for existing POST /sessions/:id/commands kind=stop.
Preview stop returns an ended PlaybackPlan with purpose=preview. There is no new
/sessions/:id/stop endpoint and no normal playback observation/SSE requirement for
preview clients. Discarded late ready results must also be stopped.

Preview sessions never count as movie playback/admission, warm the full movie,
write watch/history/progress, or generate visible/selected/played receipts.
Absent PlaybackPlan.purpose means playback; preview grants/plans explicitly say
preview. Keep at most one active preview per viewer; replacement, expiry, stop,
revocation and current viewer/device/media policy invalidate media access. URLs
are same-origin broker /sessions/media grants, never provider URLs. Clients must
check origin, path and expiry and stop/unmount on cancellation; browser mute or
pause alone does not revoke a grant. Cache readiness and playable availability
come from actual cached trailer bytes and broker capability, never Extras.Resolve
or a normal movie playback session. Optional Extra.cachedPlayback metadata
does not enable this feature when trailerPreview is absent/off.

Artwork size width/height are delivered pixel dimensions when both are positive.
Use0/0 for an unmeasured source URL; clients discover its natural dimensions from
the image and must not interpret zero as a zero-sized render box. Do not invent
dimensions or fetch/decode image bytes merely to populate metadata. Known-size
URLs must serve their advertised aspect-preserving size, clamped to the source
without upscaling. Ether's Vela image grants use canonical w/h parameters (not
width/height aliases), capped at4000; explicit w=0 requests the source/default
image and preserves an unmeasured-source URL against client sizing fallbacks.

## Partial search results

Descriptive search may return `descriptive.state: "partial"` with early `items`
and `retry: {allowed: true, afterSeconds: 2}`. AI jobs expose the same stage as
`status: "partial"`, with a required `results: SearchResponse` whose
`descriptive.state` is `"partial"`. This is nonterminal: keep polling the existing
AI job ID, or repeat descriptive search after its retry delay. Do not start a new
AI job merely because the current one has early results. Cancellation also applies
to partial jobs.

Present early results only for the current query/generation. A subsequent partial
or final result replaces that generation's provisional list, rather than appending
to it. `status: "complete"` supplies the final AI result; descriptive `"ready"`
supplies the final descriptive result. Early items are real viewer-authorized
matches, but do not imply completion, a total count or stable final ranking.

## Appearance and server events

`GET /appearance` is public: it names the server default skin (an engine id or an
installed pack id), the engine that default runs on, the owner's `force` flag and every
installed SkinPack. It carries no viewer data. `revision` increases with every owner
change; clients ignore an older revision. `GET /events` is the viewer-level SSE stream
(not a playback session): on connect it sends the current `appearance` event, then one
per change, with `cursor` = revision. Unknown event types are ignored. A SkinPack is
data only; clients validate every field (colour `#rrggbb[aa]`, radius 0-48 px, pill
0-999, at most 8 font files, image and font URLs same-origin under
`/vela/v0/appearance/`, 64 KiB per pack). Pack `schema` and `engine` gate
application: a client that lacks the engine or schema shows the engine's house look.
A viewer's own pick wins over `defaultSkinId` unless `force` is true.
Full design: `docs/skin-distribution.md`.

## Cache and mutation semantics

Cacheable GETs: capabilities, bootstrap, libraries/library items, rows, detail/children/extras, channels and
guide. Return `ETag`, `Cache-Control: private, max-age=0, must-revalidate` and honor
`If-None-Match` with 304. Cache keys include instance, viewer, policy revision,
query, device capability context and protocol version. Never reuse across viewers.
Auth, search jobs, sessions, events and mutation responses use `no-store`.

Title detail, children and extras may be partial while the server still fills a title (a new
show's seasons, its extras, a trailer). Optional `pending` names the parts in flight
(`seasons`, `episodes`, `extras`, `trailer`), only for work that is confirmed queued or
running, never speculatively; `refreshAfterMs` (2000 from Ether) says when to ask again. A
partial answer carries `Cache-Control: private, no-store` and a weak `ETag`: clients never
cache it or revalidate against it. A complete answer (no `pending`, or an empty list) has the
cacheable semantics above. Clients re-read a partial answer after `refreshAfterMs` while the
title is on screen, backing off and stopping after a few tries, and update the parts in place
as they arrive; a part still pending is shown as not yet available, not as absent.
Opaque cursors bind viewer, query, ranking snapshot and policy; invalid/expired
cursors return 409 `cursor_expired`, requiring refresh from the first page.

Libraries are the host's viewer-visible published views in server order. IDs are
opaque; names and kinds come from the host. Do not synthesize a Live library from
channel availability when no real library ID exists. Unknown/hidden library IDs
return404. Artwork is an empty array when no authorized library artwork exists.
Per-library browse returns a paged RowEntry grid (title or live channel entries),
plus the library and effective sort/direction. Pages default50, maximum100; no
exact count is required. Preserve host order and issued receipts. Empty
receiptToken means no receipt was issued: clients skip interaction reporting for
that entry rather than manufacturing attribution.

`Library.dateDisplay` defaults to `year`; `date` asks every surface scoped to that
library to show `Title.airDate` as `YYYY-MM-DD`, falling back to the numeric year.
`Title.dateDisplay: "date"` carries the same rule through rows, detail and search
answers that are no longer accompanied by their library declaration.

A declared `LibraryTab.kind: "live"` is a content-library catalogue, not Live TV.
It is available only with `features.libraryLive`; older servers and libraries
without such a tab expose no UI. `GET /libraries/:id/live` accepts the declared
tab key, text query, one advertised filter key, opaque cursor and limit, and returns
static artwork cards plus the filter chips for that answer. `POST
/libraries/:id/live/play` resolves one item into the ordinary live PlaybackPlan and
session lifecycle. It does not create guide channels, programmes or EPG state.

Library.browse advertises only implemented sorts/directions and filters, with
defaults. Optional filters.genres lists actual offered choices in server order;
omit it when unknown and do not invent a genre selector's choices. Optional
Channel.group and Programme.genres carry actual host metadata when available.
`server` means the unchanged source order and supports asc only. Other
sort names map to actual neutral catalogue orders, not client sorting. A missing
filter field or false support flag means unsupported. Query filters are single
kind/genre/year values and exact `true`/`false` played/favorite values; omitted
filters impose no additional restriction. Unsupported or malformed options
return400 request/invalid_library_query. Owner libraryfilter and viewer policy
apply before filters, ordering and pagination; search-only visibility exceptions
must not leak into library browsing. Cursors bind the effective query, library,
authorized snapshot, viewer/policy/device and grant family. Policy or membership
changes invalidate old cursors with409 cursor_expired; never fake exhausted on a
bounded source that cannot prove it. Reauthorize before returning cached pages.

Ether mapping: neutral Experience.Views/LibraryItems and ItemQuery supply the
published view IDs/order, kinds, catalogue sorts and optional Watched/Favorite
filters (`internal/frontend/contracts.go`). MediaBrowser UserViews and Items use
these same services. Use NoTotal where supported; do not resolve releases, wait
for providers, walk the library for exact counts, or invent ranked receipts for
plain LibraryItems pages. Real live views may use the authorized live pager.

Idempotency is scoped to authenticated grant (or pre-auth device), method and path,
retained at least 24 hours. Same key/body replays the original status and response;
a different body is 409 `idempotency_conflict`. Failed precondition responses are
also replayed. Refresh rotation may therefore safely retry with the same key.
Never reuse a key for polling a grant/job or successive telemetry observations.

## Playback and events

Omitting PlaybackRequest.positionSeconds resumes the viewer's saved watch position
(or zero when none exists); an explicit zero starts over.

Source and seek generations start at 1. Every session command/observation includes
both current generations. Stale values return 409 `stale_generation` with current
values; they cannot change state. Seek increments seek generation; committed source
switch increments source generation; session identity survives both. Observations
have strictly increasing sequence numbers within a session, including after seek.
Old sequence numbers are acknowledged without applying. Track null means subtitles
off; omission preserves preferences. Plan revision increases on authoritative
changes. Prepare-fallback is allowed only when advertised; readiness is distinct
from publication, transfer, accepted playable buffer and actual playback progress.
Ready boundaries are proof-bound to the advertised timeline and track mapping.
Clients must not splice arbitrary direct byte streams. Capacity is checked again
when starting output; a plan is not an encoder reservation.

Use authenticated streaming fetch for SSE (native EventSource cannot set bearer
headers). Exactly one active stream per session; a new connection replaces the
old one. Each event has `id: <cursor>`, `event: <type>`, and JSON `data: SessionEvent`.
Last-Event-ID takes precedence over query cursor. Replay retained events in order;
no cursor, invalid cursor or retention gap yields a `snapshot` event at the current
cursor. `GET /sessions/:id` gives the same authoritative snapshot. Resume after its
cursor; do not restart healthy media merely because events reconnected. Revision
and cursor are session scoped; deduplicate repeats and ignore older revisions.
Comments are heartbeat keepalives, never state changes. Recheck authorization on
reconnect and while streaming; revoked credentials close the stream. Ended sessions
retain a final snapshot for bounded reconnection; `ended` closes the stream.

### Subtitle search

`features.subtitleSearch: {available, languages}` lets a running session add a subtitle
the title lacks, from a subtitle site or as the server's AI translation. Absent or
unavailable means no search; clients show nothing for it. `languages` are the codes a
search accepts, ISO 639-1 (`nl`) or a BCP 47 tag where the region matters (`pt-BR`).

`GET /sessions/:id/subtitles/search?language=nl` answers `{language, offers,
preferredLanguages?}`. Without `language` the server searches the viewer's first
preferred subtitle language; `language` always says what was searched.
`preferredLanguages` is the viewer's subtitle languages, most preferred first, which a
client lists first in its language picker. An offer is `{id, language, name, provider,
format?, author?, downloads?, rating? (0–10), releaseMatch?, hearingImpaired?, forced?,
aiTranslated?}`; `releaseMatch` means made for the release the session plays (a file
hash or release-name match) and `aiTranslated` a track the server makes with its
language model once chosen. Offer ids are opaque and valid for the session that
searched; an unknown language is 400 `invalid_language`.

`POST /sessions/:id/subtitles/:offerId` with `{idempotencyKey}` adds the offer to the
session without a source change: the same session and generations, the new track
appended to `subtitleTracks` with external WebVTT delivery, `selectedSubtitleTrackId`
set to it, the revision raised and the plan published on the session stream. While a
track is still being made (an AI translation) the answer is 202 `{state: 'preparing',
retryAfterSeconds}`, which is not a final answer and is not replayed. The client posts
again, each time as a new mutation (a new key), until it gets the plan. The server makes
an offer's track once per session: a post while it prepares joins that work, and one after
it is ready answers the plan with the existing track selected.
An offer the session was not shown is 404 `offer_not_found` (search again); an ended
session is 409 `session_ended`.

### Scrub thumbnails (trickplay)

`PlaybackPlan.trickplay?: {width, height, intervalMs, count, cols, rows,
coverageUntilMs, revision}` advertises only an available offer for the release
currently streamed by that session. Omit it when unavailable. The session snapshot
carries the same metadata in `snapshot.plan.trickplay`; there is no independent
snapshot copy. Existing full `plan` session events publish changes, using normal
session revision/cursor replay and snapshot rules. Clients may ignore this optional
metadata; it does not affect playback readiness or authorize another media path.

`width` and `height` are positive integer dimensions of **one thumbnail** in pixels;
`cols` and `rows` are positive integer sheet dimensions, currently 10 × 10 like
Jellyfin. `intervalMs` is a positive integer title-time interval. `count` is the
positive integer `ceil(durationMs / intervalMs)` from the probed duration,
including fallback slots, not a claim that every frame has been generated. Omit
the entire offer when the duration is unknown; `count` does not grow with playback.
`coverageUntilMs` is the nonnegative integer highest **contiguous real-frame end
from title time zero**, clamped to duration (zero when only a fallback exists).
Seeks can create real-frame islands beyond this edge; those frames appear in
sheets but do not advance contiguous coverage across missing/fallback slots.
`revision` is a nonnegative safe integer,
monotonic within a source generation; advance it whenever coverage or published
sheet contents change, including replacement of a fallback with real frames.
Throttle trickplay-driven full-plan SSE republishing to at most once per ten
seconds per session, plus one final publish when generation stops. Publish only
when metadata/content actually changed; do not send unchanged periodic events.
The sheet ETag uses the current generation revision even while plan publication
is throttled, so a fallback replacement invalidates it without waiting for SSE.
On source-generation replacement, discard the old metadata and cached sheets;
never reuse thumbnails across releases merely because the title id matches.

For title time `tMs >= 0`, the slot is `floor(tMs / intervalMs)`; it must be less
than `count`. Sheet indices are zero-based: `floor(slot / (cols * rows))`.
Within a sheet, column is `slot % cols` and row is
`floor(slot / cols) % rows`. A JPEG is `width * cols` by `height * rows`; ignore
padding cells after the final slot. The route width must equal the advertised
provider width (currently 320); do not resize on request or invent other variants.

`GET /vela/v0/sessions/:id/trickplay/:width/:sheet.jpg` returns `image/jpeg`.
This is an authenticated Vela request with bearer and `X-Vela-Device-Id`, bound to
the exact owning session, current grant family, device and surface. Validate the
session's active media grant, selected release and current viewer/media policy on
every request, **including conditional requests before returning 304**. Do not
look up the newest session for a title or expose upstream URLs/credentials. Client
renderers need authenticated fetch; the bare endpoint is not a public image grant.
An unknown, ended or unavailable session/offer, unadvertised width or unavailable
sheet returns 404; ordinary authentication/policy failures retain 401/403 rules.

Responses use `Cache-Control: private, no-cache` and a version-keyed ETag that
includes the session/source generation, trickplay revision, width and sheet index.
The same URL's bytes can change as frames arrive, so revalidate rather than cache
it immutably. `X-Ether-Trickplay-Fallback: true` says the sheet contains one or more
fallback still cells; `false` says its addressable cells are all real generated
frames. An absent fallback header means unknown, never proof of real frames.
Fallback stills may stand in until real frames exist; they do not advance real
coverage. Sheets wholly beyond contiguous coverage may return placeholder-only
JPEGs with `X-Ether-Trickplay-Fallback: true`. Service workers and shared/static
caches must bypass these sheets.

Generation is owned by Ether's existing streaming `TrickplayProvider`/`Leaser`,
only while that exact session streams the release. Metadata and JPEG reads never
start generation, resolve a release, acquire a new playback stream, or generate
ahead of playback. Progress is published through session events as the active
stream makes frames available. Stopping/revoking the session invalidates access
and releases its generation lease; pre-existing private cached bytes do not grant
continued access. This contract adds no thumbnail generation during browsing or
before playback, and no player/scrubber implementation is implied by the spec.

## Search and errors

Fast and deterministic descriptive/vibe search never await an LLM. AI is an optional
independent job; generation is echoed on every result. Clients discard obsolete
generations and cancel superseded jobs. Unavailable AI returns policy-class
`feature_unavailable`, never a fake AI result. Proactive fallback is optional and
belongs to Ether v0.3.11; absent capability means unsupported, not preparing.

Non-2xx JSON responses are ErrorResponse. Classes/statuses: auth/401, policy/403,
not-found/404 (also policy-hidden entities), request/400, conflict/409, source/502,
decoder/422, playback/422, capacity/503, transient/503. Retry only when retry.allowed; respect
Retry-After/afterSeconds, bounded attempts and caller deadlines. Decoder failures
must not trigger unbounded retries of the same corrupt bytes. Error codes are
stable machine identifiers; messages are displayable text without credentials.

Playback admission errors `no_compatible_path`, `track_not_found` and
`unsupported_conversion` use HTTP422, class `playback`, and `retry.allowed: false`.
Only `no_compatible_path` includes optional `rejectedPaths: [{path,reasons}]`.
`path` is an attempted delivery label, not a `PlaybackPath.id`: failed admission
may have created no session. Both labels and diagnostic reason strings are open;
reasons are human-readable text, not machine codes to branch on.

When bootstrap assembly cannot produce a consistent response after its bounded
internal attempts, GET `/bootstrap` may return HTTP409, class `conflict`, code
`bootstrap_changed`, with `Retry-After: 1` and
`retry: {allowed: true, afterSeconds: 1, maxAttempts: 3}`. Respect that backoff;
do not turn it into an immediate fresh-request loop. This GET has no idempotency
key. It does not share the cursor-refresh behavior of `cursor_expired`.

## Compatibility

Negotiate protocolVersions including 0; unsupported versions return 400
`unsupported_version`. `/v0` changes are additive optional fields only. Consumers
ignore unknown object fields and handle unrecognized events by fetching a snapshot.
Do not assume optional feature support from server version. A required field/type,
unit or semantic change needs a new URL major version. New enum values require
capability gating until old clients can safely ignore them.

`compatibleClientBuilds`, when present, is a semver interval [minInclusive,maxExclusive).
Ether initially supports >=0.1.0 <0.2.0. Optional initialTrackSelection,
sessionTrackChanges and extraPlayback features describe these separate operations.
Absent feature means unsupported; clients handle feature_unavailable without retry.
Source/timeline IDs are omitted when unknown; absence never proves compatibility.

Collections, playlists and directories use `/collections/:id`; Collection.kind
identifies the destination. Contents are RowEntry values in server order with
viewer-bound receipt tokens. Cache and cursor rules are identical to rows.

TitleDetail.mediaSummary contains only known fields from verified, non-estimated
source tracks, without resolving media during browsing. Crew is an optional
name/role list, deduplicated by person/job. A show may include default-season
episodes alongside seasons; child/detail endpoints remain authoritative for
explicit season navigation. Extra.cachedPlayback is present only for ready cached
media with a current broker-scoped URL and expiry; metadata availability alone
never authorizes trailer autoplay. Omit cachedPlayback without that capability.

Negotiation is public discovery: its client field echoes device declarations,
not a grant of decoding support or owner policy. Playback applies authenticated
capability policy. The bearer/device-header rule applies to JSON control endpoints;
artwork and media resources use their own scoped URL grants. Retried mutation
bodies must use identical serialized JSON within the idempotency scope.

channelId identifies live playback even when no live window is observable. The
optional live object can report only a mode; omit unknown window/drift fields.

Optional `live.anchor: {mediaSequence, windowStartSeconds}` maps the first segment
of a published media playlist to its start on the broadcast rendition's clock.
The sequence is a nonnegative JavaScript-safe integer; reject or omit values
outside that range. Seconds are cumulative actual segment durations from
the first published segment, independent of programme-date-time drift.
`live.windowStartSeconds` and `live.liveEdgeSeconds` use this same clock.
Do not derive timestamps as media sequence multiplied by target duration.

Vela media playlist responses carry the current published mapping in
`X-Ether-Live-Media-Sequence` and `X-Ether-Live-Window-Start`. These paired headers
are authoritative for that response and override a stale plan anchor as the live
window slides. Omit an anchor or header pair when no published mapping is known;
absence is not a zero origin. Reconcile sequence offsets using the playlist's
actual segment durations, not wall-clock or target-duration estimates.
Mode is the initial player buffering preference, not a server latency guarantee.
Track.codec describes the delivered track format (for example WebVTT for a VTT
sidecar), while mediaSummary retains source codec facts. Empty publishedRanges
means no publication proof was reported; it does not prove a media outage.

ClientCapabilities.hls declares native HLS acceptance (the browser's HLS MIME
probe); mse separately declares MSE availability. MSE alone does not promise TS
demux or make an unqualified master playlist playable. A server may offer native
HLS with empty qualities; an MSE path needs explicit compatible rendition metadata.

### Ranked rows

`Row.presentation: "ranked"` opts into a Top 10 surface. Rank is the one-based
position in the final server-ordered `items`, with at most ten entries. Clients
keep that order, entry identities and receipt tokens. Omission uses the ordinary
row surface. Landscape artwork may use existing backdrop/cover artwork; portrait
artwork remains a fallback. No inferred rank or new receipt is issued by the client.

`ServerCapabilities.secureOrigins?: string[]` advertises trusted HTTPS base
origins from the host connection publisher (for example its plex.direct address).
Values contain an origin only, without `/vela`, query or fragment. Omission means
no advertised upgrade destination; clients must not manufacture one from a host
name. Origin migration and credential handling remain an explicit client transport
operation rather than an HTTP redirect.

### Original-file playback

`ClientCapabilities.originalPlayback` version1 advertises installed demux and
decoder families, range support and WebGPU availability. It does not prove that
an individual stream can decode; exact stream probing remains a runtime decision.
`PlaybackPath.original`, `range` and optional `byteLength` describe the brokered
original. HTTP range responses remain authoritative. `Track.streamIndex` is the
actual source ffmpeg stream index, not a client-generated track ordinal.
Lazy fallback uses the existing generation-aware `switch` command with `pathId`
and `atSeconds` on the pinned source; there is no separate select-path command.

Capability names are lower-case FFmpeg-style tokens, and a server ignores names
it does not know. `demuxContainers` uses `mkv`, `webm`, `mp4`, `mov`, `mpegts`
(188-byte transport streams), `m2ts` (Blu-ray BDAV with HDMV stream types:
LPCM, TrueHD, DTS-HD, PGS, VC-1), `avi`, `ogg`, `flv`, `asf`, `rm`, `mpegps`, `iso-dvd` and
`iso-bluray`. Decoder lists use FFmpeg codec names (`hevc`, `av1`, `vc1`,
`mpeg2video`, `truehd`, `dts`, `pcm_bluray`); a decoder named in
`originalPlayback.videoDecoders` decodes in real time at the device's
`maxWidth`/`maxHeight`, whether in hardware or software.

`ClientCapabilities.hdr` lists `hdr10`, `hdr10+`, `hlg` and `dv`.
`dolbyVisionProfiles` lists the profiles the device shows as Dolby Vision,
natively or after its own conversion (`7` means the client converts Profile 7 to
8.1 itself); a server should prefer direct play of those over a transcode. A
profile not listed plays its HDR10/HLG base layer at best. `dolbyVisionReshape`
lists profiles whose RPU the client applies itself and shows as HDR10 or SDR
where the display link carries no Dolby Vision (libplacebo on desktops): their
colour is correct, so a server should direct-play them rather than transcode.

`ClientCapabilities.audioOutput` describes what reaches the speakers on the route
at negotiation time. `passthrough` lists bitstreams delivered unchanged (`ac3`,
`eac3`, `eac3-joc`, `truehd`, `dts`, `dts-hd`, `dts-uhd`); `immersive` lists
presentations whose heights or objects survive by any route (`eac3-joc`,
`truehd-atmos`, `dtsx`), including a client that renders TrueHD Atmos objects into
a bed with heights and lets the OS carry it as Dolby MAT; `maxChannels` and
`maxSampleRate` bound decoded PCM; `lossless` says lossless sources reach the
output without loss. A server should not transcode an immersive or lossless track
the client lists, and should keep the original track when the client decodes it.

An `on-demand` playback path has no URL and is never fetched or considered ready.
The generation-aware `switch` command authorizes preparation, then returns the
actual broker plan. Existing ready/preparing/unavailable paths keep their URL rule.
Optional `PlaybackPath.quality: {width, height, bitrate}` describes the target
output (pixel dimensions and bits per second), including for on-demand paths.
It is menu metadata, not codec, init-segment or playability evidence. Switching
to a lazy quality path must return the actual plan and its rendition readiness;
clients must not turn target metadata into verified `Quality` entries or a URL.

Both the path's `quality` target and its `qualities[]` entries carry pixel
`width`/`height` and total peak `bitrate` in bits/second. Optional `videoBitrate`
is the target video rate, `peakVideoBitrate` the video peak budget, and
`averageBitrate` the estimated total average video-plus-audio rate, all in
bits/second. Optional `codec` is the intended `h264`/`hevc` family;
`dynamicRange` is the intended `sdr`/`hdr10`/`hlg`/`dv` output. These intentions
do not verify the media. `videoCodec` is an exact RFC6381 value only after init
verification; pending renditions carry an empty value and `codecStatus: "pending"`,
then publish `"verified"` with the actual codec. The existing rendition URL and
codec requirements are unchanged. Optional plan `qualityLimitations` lists absent
rung heights with server-provided `reason` codes; clients must not invent missing
rungs, interpret unknown codes as readiness, or silently replace a quality choice.

`POST /auth/web-code` requires bearer/device authentication. Its targetOrigin must
exactly match an advertised trusted HTTPS origin; the server issues a short-lived
single-use Vela web code bound to the account and target origin. The response echoes that origin.
Clients carry only `#code=<encoded-code>` in the destination fragment and scrub it
before the first fetch. HTTPS is a new browser device: the target generates its
own device ID and redeems normally. The issuing device field validates the
current authenticated request; it does not bind or transfer the grant. Codes are
single-use for60 seconds, bound to the account, exact trusted TLS origin and Vela
surface. Credentials are not forwarded by HTTP redirects.

### Audio-only fallback

`POST /sessions/:id/audio-fallback` accepts `AudioFallbackRequest` and returns
`AudioFallbackResponse`. It authorizes a real local AAC pipeline on the selected
source track; `features.audioFallback.available` is true only when that pipeline
is available. Audio-only HLS is broker-scoped. Its fMP4 timestamps are title-absolute
(`timelineOriginSeconds: 0`). It does not bump video source or seek generations.
Replacement invalidates the previous audio URL and increments `audioGeneration`.
Stale source/seek generations return409; capacity/source failures use the ordinary
classified error model. `DELETE /sessions/:id/audio-fallback/:audioId` accepts
`Mutation` and returns `Ack`, canceling only that audio pipeline idempotently.

`PlaybackPath.originalVideo` contains only actual, non-estimated source-probe
facts. Missing facts are omitted. Explicit false DV presence flags and compatibility
ID0 are preserved; absence is not proof of a compatible base layer. These facts
are admission input for the original-file decoder, not a promise of support.

Cast and crew credits may each carry `artwork?: ArtworkRef`. Emit only known
portrait grants authorized for the current title credit. Neutral `Person.ThumbPath`
and `PersonArtwork` can supply detached known descriptors without a metadata
lookup or provider refresh. Missing portraits are omitted, including legacy
name-only director/writer credits; clients leave the portrait empty.

### Named live Guides

`Channel.guides?: LiveGuide[]` carries actual owner-defined Guide memberships,
in owner order and filtered to the viewer. Each descriptor is `{id,name}`; IDs
remain stable across rename, and a channel may belong to several Guides. Clients
use IDs for membership/filter state and deduplicate descriptors by ID for tabs.
Omission means membership is unknown; an empty array means known no membership.
`Channel.group` remains the independent provider group string. There is no global
empty-Guide catalogue or new endpoint; memberships arrive with channel pages.
These named Guides are channel groupings, separate from `/live/guide` programme
time windows. The mock includes provider-derived memberships and overlapping
House picks for its first six channels.

Original-video probes may additionally carry `isInterlaced`, `fieldOrder`
(`progressive`, `tt`, `bb`, `tb`, `bt`) and `rotation` in degrees. These are actual
probe facts, not defaults: omit unknown field order/rotation/interlace state and
preserve explicitly known zero rotation or false interlace. Rotation is signed counterclockwise degrees from the display matrix, preserved
without normalization to0–360. For example, positive90 is counterclockwise90;
missing rotation/matrix is omitted rather than defaulted to zero.

### Live results in fast search

Fast `POST /search` responses may include `live: LiveSearchResults`, containing
`channels: Channel[]` and `programmes: Programme[]` in server order. The existing
query and generation identify all lanes. Omission means unavailable; present empty
arrays mean no matches. These are bounded, unpaged lanes: title-page cursors and
continuation describe `items` only, never live totals or completeness. There is no
new endpoint and no invented receipt. Programme IDs and channel IDs match the live
API; programme.channelId references a viewer-authorized tunable channel, and its
start/end are authoritative. Descriptive and AI responses omit these live lanes.
The mock searches its visible channel/Guide labels and a24-hour programme window.

`LiveSearchResults.programmeChannels?: Channel[]` supplies deduplicated,
viewer-authorized parents of the returned programme hits. It is metadata for
looking up channel labels/artwork by ID, **not** channel search matches. Keep
`live.channels` restricted to true channel matches. Missing or partial parent
metadata leaves unknown labels/logos empty; clients do not infer names or make
per-hit network lookups. The neutral source can supply parents in the same
bounded policy query.

### Descriptive search state

Descriptive search can return `descriptive.state` as `ready`, `pending`, `busy`,
or `failed`; an absent field means ready. Items contain candidates obtained so
far, including on failure. Pending and busy may be retried when `retry.allowed`
is true after `retry.afterSeconds` (whole seconds, minimum one). Failed results
may be retried only when allowed. Every retry uses a fresh idempotency key.
The descriptive lane uses Collections AI; it has no lexicon or popular-picks
fallback.

### Ratings and extra playback

`Title.ratings` contains only known, policy-permitted server ratings, in server
order. Each record gives its source, critic or audience kind, raw value and
scale; state, vote count and source URL are optional and never inferred.
`POST /playback` for an extra may return HTTP 202 `PlaybackPreparing` with no
session; retry after the indicated seconds using the identical request and
idempotency key until a 200 `PlaybackPlan` is ready. A 202 is not a final
idempotent response. Trailer playback uses the existing `extraId` playback target, gated by the
`extraPlayback` capability. An unresolved trailer can be started on explicit
request. Its independent broker session does not update watch history, resume,
Continue Watching or scrobbles. Other extras remain unavailable unless offered.

A live `PlaybackPlan` may include `livePolicy: { latencyProfile, targetLatencySeconds }`.
The profile is `auto`, `low`, or `stable`; the positive finite target is a
preferred latency in seconds, not a strict floor. Playback may adapt to stalls.
When absent, the profile is auto and the target is unknown.


Search controls are optional capabilities. `searchSorts` is an ordered list of
`{id, label?, directions}`; `searchKinds` is an ordered list of `{id, label?}`
(legacy string IDs are also accepted). IDs are open strings, including plugin
kinds such as `game`. Clients preserve the advertised labels and order and
humanise an ID only when its label is absent. Missing capabilities mean no
controls. Search requests carry optional `sort`, `direction`, `kind` and `library` in both
fast and descriptive modes; omitting `kind` means All. Every option change starts
a new generation and invalidates prior cursors. Adapters advertise only controls
they implement. `searchLibraries: true` enables restriction to a visible ID from
`GET /libraries`; unknown or invisible IDs return `400 invalid_library`. Omit
`library` for all libraries. Clients show the library select only with support
and at least two libraries, in server order, and reset it when the query clears.
Library and kind controls combine, including advertised plugin kinds.
Jellyfin/Emby use Items `ParentId`; Plex uses library section search.

When `capabilities.liveGuideWindow` is present, clients may read a complete
window using `POST /live/guide/window` with `{ channelIds, from, until }`.
This is a read and does not require an idempotency key. Advertised limits bound
the channel count and window length. The response has `from`, `until`,
`revision`, `validUntil`, and one `{ channelId, state, programmes }` entry per
requested channel in request order. `ready` covers the complete overlap interval,
including crossing programmes with their original timestamps; `ready` with an
empty array is distinct from retryable `unavailable`. `validUntil` reflects source
freshness, including for past windows, and is capped at 60 seconds when any row is
unavailable. A `guide_window_too_dense` error includes
`suggest: { maxChannels, maxWindowMinutes }`; split the request rather than treating
an incomplete row as ready. Servers without this capability retain the paginated
`GET /live/guide` path.

## Media classes, audio and reading

Music, books, audiobooks and podcasts follow [media kinds](../../docs/media-kinds.md).
`Library.media` and `Title.media` (class, role, index, disc, parents, credits,
reading) are additive; `Title.kind` keeps the movie/show/season/episode projection.
Audio plays through `POST /playback` with `PlaybackPlan.media = 'audio'`. Readable
titles open with `POST /titles/:id/read` (a short-lived range-capable URL) and
save `{locator, fraction}` with `POST /titles/:id/reading-progress`; the progress
returns as `WatchState.reading`. Clients gate on `features.mediaClasses`,
`features.audioPlayback` and `features.reading`.

### Listening recap, playlist import and duplicate recordings

- **Listening recap (`features.historyRecap: {available, periods}`)**: `GET /history/recap?period=week|month|year|all&at=YYYY-MM-DD&library=<id>` returns `HistoryRecap`. `at` selects the week, month or year containing that date (default today); `library` optionally scopes to one visible library. An empty period returns zeros and empty arrays, never 404. Artists and albums are derived from each played track's `media.parents`, so audiobooks and podcasts use the same shape (author/show).
- **Playlist import (`features.playlistImport: {available, links, files, maxTracks}`)**: `POST /playlists/import` with `{idempotencyKey, library, url}` or `{idempotencyKey, library, file: {name, format, text}}` returns 202 `{id}`; an unsupported URL returns 400 `unsupported_link`. `GET /playlists/import/:id` returns `PlaylistImport` (`state: 'reading' | 'matching' | 'done' | 'failed'`, `total`, `done`, `matched` with `by: 'isrc' | 'title'`, and `unmatched` with `reason: 'not_found' | 'ambiguous'`, where `ambiguous` items carry `candidates?: Title[]` up to 8 releases). `POST /playlists/import/:id/save` with `{idempotencyKey, name?, exclude?, choose?}` (mapping source index strings to a chosen candidate `titleId`, or 400 `invalid_choice`) creates and returns the ordinary `PlaylistCard` in source order.
- **Duplicate recordings (`features.duplicates: {available}`)**: `TitleMedia.recordingId` carries the recording identity (such as ISRC) shared across releases of the same recording. `GET /libraries/:id/duplicates?cursor=&limit=` pages `DuplicateGroup` items (`{recordingId, count, titles, preferredTitleId?}`), most copies first. `GET /titles/:id/recording` returns `{recordingId, preferredTitleId?, titles}` for every release of that recording in the library. `POST /libraries/:id/duplicates/:recordingId` with `{idempotencyKey, preferredTitleId, hideOtherIds?}` records the viewer's preferred release and optionally hides the other release IDs from the viewer's library lists, search and Liked Songs, returning the updated `DuplicateGroup`.

### Loudness and AutoMix markers

`features.loudness` (`{ available, album?, fades? }`) lets a client level volume and
time crossfades. Tracks carry `TitleMedia.loudness` on every card (detail, children,
rows, queue, favourites, playlist entries, continuation), and an audio
`PlaybackPlan.loudness` repeats it for the exact source the plan plays:

```jsonc
{ "trackGainDb": -7.9, "trackPeak": 0.98, "albumGainDb": -8.4, "albumPeak": 1.0, "lufs": -10.1,
  "reference": -18, "source": "measured",
  "trim": { "startMs": 120, "endMs": 213400, "fadeInEndMs": 900, "fadeOutStartMs": 204100 } }
```

Gains are ReplayGain 2.0 style: the dB that brings the track (or album) to `reference`
LUFS. Peaks are linear true peak (1.0 = 0 dBTP). Ether measures a track once, after
its first complete play, from its cached copy (one EBU R128 pass, no library walk);
until then a provider hint may give `trackGainDb` alone with `source: "provider"`.
`albumGainDb`/`albumPeak` appear only when `album` is advertised and every track of the
album is measured. `trim.startMs`/`endMs` bound the audible part (silence is below
-60 dBFS); with `fades`, `fadeInEndMs` is the first point the 100 ms momentary loudness
comes within 10 LU of integrated and `fadeOutStartMs` the last point before it falls
more than 10 LU below integrated for good. A sub-flag absent or false means those
fields are never sent. The plan's value is authoritative (the card's may describe
another release of the track); a missing value means unmeasured, and the client plays
the file at its own level. `TitleMedia.bpm` is sent when the provider knows it.
Older clients ignore all of it.

Queued handover for crossfades (Ether, after 0.3.21): a server that advertises
`features.queuedPlayback.handoverSeconds` keeps a superseded queued-playback session alive
for that many seconds after its successor takes the device over. Its reads serve, its
progress and stop are accepted, and it retires at the client's stop or when the time
runs out. The takeover itself records the outgoing item as played through. Clients
overlap two sessions (an AutoMix crossfade) only when the field is present, or when
the outgoing tail is already buffered.

### Library experience

`Library.experience` names how a client presents the whole library. Vela's experiences:

| Id | Vela draws |
| --- | --- |
| `watch` | films and TV: the standard library pages (tabs, grid, list, filters) |
| `listen` | the audio app for music, audiobooks and podcasts: Your Library down the side, the page in the middle, the now-playing bar, the queue and Now Playing |
| `read` | books and comics (today the standard library, whose books open the book pages and the reader) |
| `gallery` | photos and home videos (today the standard library, whose photos open the photo viewer) |
| `live` | the guide, multiview and sports (today the live library and the guide) |

```jsonc
{ "id": "audiobooks", "media": "audiobook", "experience": "listen", "presentation": { "card": "square" } }
```

The set is open: a client draws an id it does not know as `watch`, never an error. A server
advertising `features.libraryExperiences` (`{ available, experiences: ["watch", "listen", "read",
"gallery", "live"] }`, the ids it sends) sends it on every library, and its word is final: a plugin
can ask for any experience on any library. Without the feature (older Ether, Jellyfin, Emby,
Plex), or for a library without the field, the client chooses by what the library holds:
`music`, `audiobook` and `podcast` listen; `book` (and comics) read; `photo` is a gallery; a
library of kind `live` is live; everything else watches. That is what every server already
implies, so a library keeps working on any server and any client version.

It is per library: an experience replaces the library's page, so there is no `LibraryTab`
counterpart (`LibraryTab.layout`, grid/list/timeline, is unrelated). In `listen` Vela words
pages, rows and the player by the library's class and each title's role
(`docs/media-kinds.md`): albums and tracks for music, books, authors, narrators and chapters
for audiobooks, shows, hosts and episodes for podcasts, with 15/30 s skips, speed and the sleep
timer for spoken word. It reads only existing fields: the library's home rows (a `continue` row
is Continue listening; the `home` tab's when the library declares one), children,
`TitleDetail.chapters`, credits and watch state. Ether's plugins set it as
`mediaKinds[].library.experience` in the manifest, with the same defaults by class.
