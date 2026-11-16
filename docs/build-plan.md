# Build plan

Status: RN/Expo source migration and packaging complete (2026-11-16); release qualification remains open.
The orchestrator is `thr_4q8296jknz`; prior orchestration threads are archived.
Product scope comes from [design.md](design.md) and [protocol-design.md](protocol-design.md).
[RN migration](rn-migration.md) records architecture and dated observations;
[distribution](distribution.md) records release contracts and qualification gates.

## Repository layout and ownership

Source moves landed in `5d7a099`, `dfd862e`, `3b933a2` and `2394e9a`.
Core is in `packages/core/src`, resolver/base in `packages/skin/src/resolve`, protocol
in `packages/protocol`, web engine in `modules/vela-player/web/engine`, and app assets
in `apps/vela/assets`. The Exact app/dispatch was removed in `d47098c`, and the
release exporter was replaced in `a9d195c`. Theme values now live in `packages/skin/src/theme.ts`, and
`tools/skin-renderer.ts` supplies React renderer release metadata. The parent owns
integrated compilation and delivery after these moves.

| Path | Responsibility | Current coordination |
|---|---|---|
| `apps/vela/` | Expo app, expo-router routes, screen wiring, platform storage and player views | Parent coordinates app/UI workers |
| `packages/core/` | Adapters (Ether, Jellyfin/Emby, Plex), session, discovery, search, live, telemetry, models, i18n; React subscription entry kept separate | Source migration `thr_3iwkrbqy77` |
| `packages/skin/` | Resolver/base, vocabulary/style translation, recursive React renderer, interactive widgets | Source migration for moves; parent coordinates renderer/UI edits |
| `packages/protocol/` | Wire types moved from `protocol/v0`, skin schema and fixtures | Parent; coordinate all wire changes |
| `packages/player-api/` | Shared player view contract | Parent coordinates player owners |
| `modules/vela-player/` | Expo module: Swift/MPVKit, Kotlin/libmpv and Metro web view | Parent coordinates playback workers |
| `modules/vela-player/web/engine/` | Web engine moved from `client/player` | Source migration; coordinate with playback |
| `mock-server/` | Fixture-backed Bun v0 server | Protocol owner through parent |
| `tools/release/` | Expo export capture, payload inventory, signed distribution, PWA shell | Release worker `thr_88bpxte5e5` |
| `AGENTS.md`, this file, `rn-migration.md`, `distribution.md`, root README | Current contributor/build documentation | Documentation slice `thr_4ny3ys7xke` |
| Remaining `client/` files, Exact-specific tools, `vendor/exact` | Historical files/tools; app/dispatch removed in `d47098c` | Coordinate residual cleanup; never edit `vendor/exact` |

Root dependency files, shared exports, app wiring and generators require coordination
before edits. Commit only owned paths on shared `main`; no push, stash, history rewrite
or branch switch. Existing workers may be editing other paths at the same time.

## Architecture

- One Expo app targets web through react-native-web, Apple through the tvOS RN fork,
  and Android/Android TV through the native host. Dedicated macOS/Windows hosts are
  later scope; Linux uses web/PWA. Target intent is not device qualification.
- Skins remain schema-1 JSON documents plus assets, resolved and drawn by the shared
  React renderer. Skins hold no credentials and issue no requests. Compiled Exact
  skins and per-engine reloads are legacy, not the RN design.
- Server adapters present common v0 models and declared capabilities. Ether is the
  reference/default; Jellyfin/Emby and Plex use the same boundary. Credentials stay
  in platform storage/transport, outside skins and diagnostics.
- Native playback uses the player module/libmpv; web retains the WebCodecs/WebGPU
  engine with JavaScript in Metro and external assets addressed by payload digest.
  A packaged backend is not proof of a particular stream or device capability.
- Wire v0 retains HTTPS JSON, bearer sessions, cache validation and session events.
  Media uses compatible originals or server-produced segments; migration does not
  invent a media container or relax authenticated policy.
- Web/PWA exports are served by Ether at `/vela`, with signed inventory, verified
  installation, atomic activation and rollback. The old Exact release proof does
  not qualify the new Expo artifact.

## Contributor loop

Use the pinned Bun via `source tools/env.sh`. The root workspace hoists dependencies;
`apps/vela/package.json` records Expo/React/RN pins. Compile a coherent chunk once:

```sh
bun x tsc --noEmit -p apps/vela
# Only for changes to these standalone areas:
bun x tsc --noEmit -p mock-server
bun x tsc --noEmit -p modules/vela-player/web
```

Do not add CI, test suites, harnesses, coverage or lint machinery. Do not run Exact's
maintainer checks. There is no routine Contract/profile build for RN contributions.
For a coding-only assignment, do not run these checks if the task forbids them.

The parent must look at an affected UI/playback flow before announcing it, and drive
one document using any new renderer rule before shipping. Coding workers report the
missing runtime look explicitly. Keep build/native/cache output scratch-backed as
specified in [AGENTS.md](../AGENTS.md); do not commit generated native projects.

## Release handoff

Release owner confirmed `bun tools/release/build.ts --player-assets=<payload-directory>
--committed` for the replacement implementation, where the directory is `<out>/player/<digest>` and
`<out>/PLAYER-ASSETS-MANIFEST.json` records provenance. Version is captured `apps/vela/package.json`; one
archive/manifest records `skinRenderer` and `playerAssetsDigest`. Catalog generation
moves to `tools/skin-documents.ts`. The parent built and test-key signed the 0.2.0
candidate from `a9d195c`; see [distribution.md](distribution.md) for its evidence and
remaining installer gates. This is not a routine check.

## Current delivery ledger

Owned and updated by orchestrator `thr_4q8296jknz` (2026-11-16). Each row closes
only with evidence for the integrated revision, not inherited spike proof.

| Area | Current state / next gate |
|---|---|
| Construction | Source moves and Exact app removal complete; Expo export and app/mock TypeScript compile pass. Standalone web-player TypeScript still reports errors in pinned Mediabunny source; the real Expo export succeeds. |
| UI/playback | Packaged web sign-in, title, extras, video and Audio-menu dismissal pass against Ether. tvOS, iOS simulator and Android TV builds succeed. Android TV sign-in/home and synthetic video playback pass. Android focused preview remains hidden after `f5b5107`; the native preview fix loop stopped at the three-attempt limit. Physical Apple TV Menu and phone/tablet interactions remain open. Native username Next fix `2d2d2a7` / `504b30c` compiles; runtime interaction proof remains pending. |
| Ether cold detail | Lab `3ca533ffe` deployed. Outlander displays seasons/episodes while extras are pending, refetches automatically, then displays Extras/trailer actions after the lab's missing TMDB configuration was corrected. No client or protocol workaround was needed. |
| Distribution | Expo 0.2.0 (`a9d195c`) and 0.2.1 (`469c800`) exported, each 245-file inventory/player digest verified, signed with the existing lab test key, and publish dry runs passed with zero public actions. The 0.2.1 first-card preview plays fully inside the screen on web. Ether owner `thr_9jsg8ia37s` owns isolated installer/update/rollback and old-tab retention qualification. PWA manifest and active service worker observed; offline/update qualification remains open. |
| Publication | Release not yet publicly published. Exact-version owner approval remains required before deliberate production publication. |
| Later scope | Dedicated macOS/Windows hosts; residual Exact cleanup follows migrated consumers and release path. |

The parent selects concrete affected flows; this ledger is not an exhaustive matrix
or a claim of broad app completion/device parity.

The Mac is at the office. Basement Apple TV is unavailable to `devicectl`; home LAN
reachability from the GPU workstation does not establish an install/screenshot route.
The signed iOS simulator app renders sign-in; Device Hub automation later failed with
`cgWindowNotFound`, preventing a complete phone interaction pass. These are explicit
delivery limits, not passing checks. The immutable 0.2.1 fixture captures the later native
sign-in and preview attempts; its existence does not close their remaining device gates.

### Owner web feedback — 2026-11-16

Candidate 0.2.3 (`e67b559`) incorporates title overlay continuity (`c8098a1`),
8 px desktop EPG outer margins (`18f76b5`), web sticky backdrop stacking (`22635a7`),
and account-menu dismissal after skin selection (`9659fb2`). The parent browser look
confirmed Lounge foreground, guide geometry, menu dismissal, and the same home DOM
with scrollTop 360 before/during/after title opening. Standalone title typography
was corrected in `e67b559` and visually checked; 0.2.2 is rejected, not a release candidate.
App TypeScript and Expo export pass. 0.2.3 is locally test-key signed, with all 245
files and the player aggregate verified. The owner preview now serves 0.2.3.

Player provenance moved to the release root (`3cb4e7e`, `d552c01`) so a source
revision change cannot alter a URL inside the unchanged player digest namespace.
Ether reports its isolated 0.2.0 → 0.2.1 → 0.2.0 → 0.2.1 installer cycle passes,
including 226 retained immutable URLs and scaled icons; the old provenance collision
was an explicit exception. The new 0.2.3 fixture is handed to Ether for that final contract check.
No real lab restart or public publication was performed. Cinematic's reported thin
top strip remains unreproduced: desktop header/root bounds start at y=0; a screenshot
is needed to identify the affected pixels. Native delivery limits above remain open.
