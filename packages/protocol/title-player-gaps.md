# Ether APIs needed by title actions and subtitle search

The lab's v0 capabilities on 2026-11-17 do not advertise title management,
media versions or subtitle search. `types.ts` and the Ether adapter have no
such operations. Vela therefore does not present unsupported mutations.
Plex and Jellyfin implement these through optional adapter capabilities.

Ask Ether for the following capability-gated v0 additions (proposed routes,
not endpoints Vela currently calls):

- `features.titleManagement`: `GET /titles/{id}/actions` returns
  `{ watched: boolean, list: "favorite" | "watchlist" | null, watch: WatchState,
  versions: [{ id, name, audioTrackId? }] }`. Availability must reflect viewer
  permissions. `PATCH /titles/{id}/watch` accepts
  `{ idempotencyKey, played?, listed? }` and returns authoritative WatchState.
- Version IDs must identify a concrete release/edition. `POST /playback`
  accepts `mediaSourceId` plus existing `audioTrackId`; reject unknown IDs
  rather than silently choosing another release. Plans should identify the
  chosen release and enumerate all verified embedded and external tracks.
- `features.subtitleSearch`: `GET /sessions/{id}/subtitles/search?language=en`
  returns `{ items: [{ id, language, name, hearingImpaired?, forced? }] }`.
  IDs are opaque provider results scoped to the viewer/title/session.
  `POST /sessions/{id}/subtitles` accepts `{ idempotencyKey, resultId }`,
  downloads the result and returns the updated PlaybackPlan with a new
  external subtitle track, its supported format and an authorized scoped URL.
  Keep session/source/seek generations unchanged for external additions.
  If preparation is asynchronous, return a job with a bounded polling hint.
- A stop reply's position must be the persisted, resume-eligible position
  (zero below Ether's 5% threshold), not the raw last player observation.
  Vela refreshes title watch state after stop before updating title/home resume UI,
  so servers returning raw session cursors cannot cause a transient local resume.

Apple AetherEngine and desktop mpv supplement missing embedded subtitles from their observed track lists.
These local track IDs are never sent to Ether as server track identifiers.

Plex uses `GET /library/metadata/{id}/subtitles?language=...` and PUT to that
path with the chosen provider `key`; the asynchronous download is followed by
metadata polling. Jellyfin uses GET
`/Items/{id}/RemoteSearch/Subtitles/{language}` and POST
`/Items/{id}/RemoteSearch/Subtitles/{subtitleId}`, then refreshes media streams.
Both append external tracks to the current session, without restarting playback.

## Cached release selection can ignore HDR capabilities

On 2026-11-18, a fresh lab Fall playback request declaring `hdr: ["hdr10"]`,
HEVC and TrueHD original playback still returned the cached 19,899,305,655-byte
3840×1920 release with `colorTransfer: "bt2020-10"` (BT.2020 SDR).
The earlier PQ proof used a different 3840×2160 remux, roughly 71.4 GB.
The Ether coordinator confirmed the cached selection did not appear in fresh
resolver history. Declaring display HDR modes therefore did not rerank that
cached resolution. Vela must report the chosen source's actual SDR format.

Ether v0 currently offers neither a versions list nor an implemented per-release
selector, despite the shared playback request's optional `mediaSourceId` used by
other adapters. Fix cached selection to respect the current capability context,
and expose capability-gated concrete version selection with explicit rejection
of unsupported/unknown IDs. Do not synthesize media URLs or relabel an SDR source
as HDR in the client. A temporary lab release pin can establish a reproducible
HDR test fixture; it is not client playback policy.
