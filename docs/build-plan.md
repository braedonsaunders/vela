# Build plan

Status: working plan for the first implementation. The orchestrator thread
(`thr_ucqnvk37fq`) owns this file and decides conflicts. Product scope comes from
[design.md](design.md) and [protocol-design.md](protocol-design.md).

## Repository layout

| Path | What | Owner |
|---|---|---|
| `client/` | The Exact app (`exact new client --name Vela`). `app.contract` is the root: routes, shell, skin selection. `app.ts` is the data-module entry and only re-exports from `client/src/`. | bootstrap, then shared |
| `client/src/protocol/` | Typed Vela v0 client: HTTP, SSE events, auth/session, cache validation | data |
| `client/src/adapter/` | `ServerAdapter` boundary; `ether/` is the only implementation | data |
| `client/src/discovery/`, `search/`, `telemetry/` | Bootstrap/home rows, search generations and AI lane, impression/interaction receipts | data |
| `client/foundation/*.contract` | Shared, skin-independent Contract: search behaviour, detail state, playback chrome state, accessibility semantics | ui |
| `client/skins/cinematic/*.contract` | The official skin | ui |
| `client/skins/<other>/` | A second, radically different skin that proves the skin contract | skins |
| `client/player/` | Playback engine (TypeScript): source selection, MSE/segment pipeline, ABR, recovery, tracks, PiP | playback |
| `client/live/`, `client/skins/*/guide*` | Live TV and the channel guide | live |
| `protocol/v0/` | The wire contract: `README.md` (spec), `types.ts` (single source of truth for shapes), `fixtures/` | protocol |
| `mock-server/` | Bun dev server implementing v0 from fixtures, with fault injection for playback recovery | protocol |

## Decisions taken

1. **Exact** is pinned at `EXACT_REVISION`, cloned to `vendor/exact` (gitignored). The app
   consumes it by path. Moving the pin is a deliberate commit.
2. **Wire format v0:** JSON over HTTPS under `/vela/v0/`, bearer access tokens from
   Ether's existing identity services, `ETag`/`If-None-Match` on cacheable reads, one
   Server-Sent Events stream per session for state/recovery events with cursors and
   snapshot fallback. Binary encodings wait for measurements. `protocol/v0/types.ts`
   is the single source of truth; the Ether implementation mirrors it.
3. **Media delivery:** HTTP segments (fMP4/CMAF) through HLS-style playlists that Ether
   already produces (`internal/transcode/dash_session.go`, `internal/hlsplay`). Direct
   file playback for compatible originals. Vela's own session/recovery contract wraps
   them; we do not invent a container.
4. **Skins are compile-time Contract packages.** A skin is a directory of `.contract`
   components that implement a fixed set of slots (`Home`, `SearchSurface`,
   `TitleCard`, `Row`, `Detail`, `PlayerChrome`, `Guide`, `Shell`) over props supplied by
   the foundation. The root selects the active skin by state; the server names the
   default. Skins hold no credentials, issue no requests and cannot reorder server
   rows: they receive rows already ordered and report visibility through foundation
   callbacks. Third-party JavaScript in the client origin is not allowed.
5. **Playback engine lives outside the data module** (Exact's data module has no DOM and
   no clock). The playback worker decides the mechanism (Exact `video` element with
   MSE object URLs from a package web module, a same-origin engine frame, or another
   path Exact supports) and records the decision in `docs/playback-engine.md`.
6. **Mock first, Ether in parallel.** The client develops against `mock-server/`. The
   Ether orchestrator (`thr_daerp5pbp7`) implements `internal/frontends/vela` against
   `protocol/v0/`. Server-side proactive fallback stays v0.3.11 per the spec.

## Order of work

1. bootstrap: toolchain, scaffold `client/`, dev loop documented. **protocol** and
   **playback research** run alongside.
2. ui (home, search, detail, routes, cinematic skin) and data (`client/src`) once the
   scaffold and `protocol/v0/types.ts` exist.
3. playback engine + player chrome; live TV and guide; second skin.
4. Wire to a real Ether once `internal/frontends/vela` serves v0.
