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

Native mpv supplements missing embedded subtitles from its observed track-list.
These local track IDs are never sent to Ether as server track identifiers.

Plex uses `GET /library/metadata/{id}/subtitles?language=...` and PUT to that
path with the chosen provider `key`; the asynchronous download is followed by
metadata polling. Jellyfin uses GET
`/Items/{id}/RemoteSearch/Subtitles/{language}` and POST
`/Items/{id}/RemoteSearch/Subtitles/{subtitleId}`, then refreshes media streams.
Both append external tracks to the current session, without restarting playback.
