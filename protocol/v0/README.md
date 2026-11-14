# Vela v0

`types.ts` is the wire source of truth. JSON over HTTPS, base `/vela/v0`.
Times are UTC RFC3339; positions/durations are seconds; bitrates are bits/s.
IDs, continuation cursors, receipt tokens and source identities are opaque.

## Endpoints

All endpoints require `Authorization: Bearer <accessToken>` except capabilities,
sign-in, refresh, grant initiation/polling, quick-connect initiation/polling and
web-code redemption. Authenticated calls also require `X-Vela-Device-Id: <device.id>`.
Device identity binds credentials and sessions. All POSTs
require a nonempty body `idempotencyKey`; no tokens in URL query parameters.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | /capabilities | — | ServerCapabilities |
| POST | /negotiate | NegotiateRequest | NegotiateResponse |
| POST | /auth/sign-in | SignInRequest | Tokens |
| POST | /auth/refresh | RefreshRequest | Tokens |
| POST | /auth/revoke | RevokeRequest | Ack |
| POST | /auth/web-code/redeem | WebCodeRedeemRequest | Tokens |
| POST | /auth/device | DeviceGrantRequest | DeviceGrant |
| POST | /auth/device/poll | DevicePollRequest | GrantPoll |
| POST | /auth/device/approve | GrantApproveRequest | Ack |
| POST | /auth/quick-connect | DeviceGrantRequest | QuickConnect |
| POST | /auth/quick-connect/poll | QuickPollRequest | GrantPoll |
| POST | /auth/quick-connect/approve | QuickApproveRequest | Ack |
| GET | /bootstrap | — | Bootstrap |
| GET | /rows | RowsQuery (query) | Page<Row> |
| GET | /rows/:id | cursor, limit (query) | Row |
| GET | /collections/:id | cursor, limit (query) | CollectionContents |
| GET | /titles/:id | — | TitleDetail |
| GET | /titles/:id/children | cursor, limit (query) | Page<Title> |
| GET | /titles/:id/extras | — | ExtrasResponse |
| POST | /titles/:id/watch | WatchRequest | Ack |
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
| GET | /live/channels | cursor, limit (query) | Page<Channel> |
| GET | /live/guide | GuideQuery (query) | GuideResponse |

Guide `channelIds` is a comma-separated list; window is half-open `[from,until)`;
return programmes overlapping the window, with original untrimmed times. Maximum
window 24 hours; pages default 50, maximum 100. Children returns seasons for a show
and episodes for a season. A show/season cannot itself start playback.

Media URLs are broker-owned `/sessions/media/<session>/<token>/master.m3u8`,
variant playlists, CMAF init/segments, subtitle resources (including progressive
cues) or a direct file. There is no parallel Vela media API. A plan advertises only
currently authorized paths, never provider credentials. Media grants expire and
must be revalidated against the owning device/session and current policy.

## Identity and Ether mapping

Implement in `internal/frontends/vela` against `internal/frontend` neutral host
contracts. Follow mediabrowser auth/session/PlaybackInfo patterns and Silo's native
Descriptor/Mount/Listeners/config/status conventions: Apps card named Vela, host
managed enable/disable/config, shared `/vela` prefix. Disable closes subscriptions.
Reuse identity Grants IssueLogin/IssueRefresh/Refresh, device and quick-connect
services. Web-code redeem uses RedeemWebCode for the console's IssueWebCode Watch
handoff; it is single-use, expiring and device-bound. Device grants appear in
Sign-in & devices and revocation invalidates API, events and media access.

Rows/ordering/hero use Experience and frontend_experience, including owner layout
and viewer policy. Receipt tokens map to issued row/entry handles. Visibility is
actual viewport visibility; selected means click; played means actual playback.
Never fabricate rank handles or treat prefetch as an impression. Artwork URLs are
sized policy-checked grants. Detail/children use Item/Children; extras use Extras
and ExtraStreams; live data uses LiveTV. Capability declarations pass through host
capability policy and do not prove hardware decoding. Plans use the session broker;
source substitution must validate edition, timeline, codecs and track mappings.

## Cache and mutation semantics

Cacheable GETs: capabilities, bootstrap, rows, detail/children/extras, channels and
guide. Return `ETag`, `Cache-Control: private, max-age=0, must-revalidate` and honor
`If-None-Match` with 304. Cache keys include instance, viewer, policy revision,
query, device capability context and protocol version. Never reuse across viewers.
Auth, search jobs, sessions, events and mutation responses use `no-store`.
Opaque cursors bind viewer, query, ranking snapshot and policy; invalid/expired
cursors return 409 `cursor_expired`, requiring refresh from the first page.

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

## Search and errors

Fast and deterministic descriptive/vibe search never await an LLM. AI is an optional
independent job; generation is echoed on every result. Clients discard obsolete
generations and cancel superseded jobs. Unavailable AI returns policy-class
`feature_unavailable`, never a fake AI result. Proactive fallback is optional and
belongs to Ether v0.3.11; absent capability means unsupported, not preparing.

Non-2xx JSON responses are ErrorResponse. Classes/statuses: auth/401, policy/403,
not-found/404 (also policy-hidden entities), request/400, conflict/409, source/502,
decoder/422, capacity/503, transient/503. Retry only when retry.allowed; respect
Retry-After/afterSeconds, bounded attempts and caller deadlines. Decoder failures
must not trigger unbounded retries of the same corrupt bytes. Error codes are
stable machine identifiers; messages are displayable text without credentials.

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
