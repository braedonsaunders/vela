# Build plan

Status: RN/Expo migration in progress (2026-11-16), not a completed app release.
The orchestrator is `thr_4q8296jknz`; prior orchestration threads are archived.
Product scope comes from [design.md](design.md) and [protocol-design.md](protocol-design.md).
[RN migration](rn-migration.md) records architecture and dated observations;
[distribution](distribution.md) records release contracts and qualification gates.

## Repository layout and ownership

Source moves landed in `5d7a099`, `dfd862e`, `3b933a2` and `2394e9a`.
Core is in `packages/core/src`, resolver/base in `packages/skin/src/resolve`, protocol
in `packages/protocol`, web engine in `modules/vela-player/web/engine`, and app assets
in `apps/vela/assets`. The Exact app/dispatch was removed in `d47098c`; residual
tooling/release consumers
still need closure. Theme values now live in `packages/skin/src/theme.ts`, and
`tools/skin-renderer.ts` supplies React renderer release metadata. The parent owns
integrated compilation after these moves.

| Path | Responsibility | Current coordination |
|---|---|---|
| `apps/vela/` | Expo app, expo-router routes, screen wiring, platform storage and player views | Parent coordinates app/UI workers |
| `packages/core/` | Adapters (Ether, Jellyfin/Emby, Plex), session, discovery, search, live, telemetry, models, i18n; React subscription entry kept separate | Source migration `thr_3iwkrbqy77` |
| `packages/skin/` | Resolver/base, vocabulary/style translation, recursive React renderer, interactive widgets | Source migration for moves; parent coordinates renderer/UI edits |
| `packages/protocol/` | Wire types moved from `protocol/v0`,, skin schema and fixtures | Source migration; coordinate all wire changes |
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
--committed` for the replacement implementation, where the directory contains
`PLAYER-ASSETS-MANIFEST.json`. Version is captured `apps/vela/package.json`; one
archive/manifest records `skinRenderer` and `playerAssetsDigest`. Catalog generation
moves to `tools/skin-documents.ts`. This is unbuilt/unqualified coding work; see
[distribution.md](distribution.md) before using it. It is not a routine check.

## Current delivery ledger

Owned and updated by orchestrator `thr_4q8296jknz` (2026-11-16). Each row closes
only with evidence for the integrated revision, not inherited spike proof.

| Area | Current state / next gate |
|---|---|
| Construction | Source moves committed (`5d7a099`, `dfd862e`, `3b933a2`, `2394e9a`), Exact app removed (`d47098c`); release integration and remaining legacy consumers still need closure, then integrated compile and real Expo artifact. |
| UI/playback | `c742d66` has reported typecheck/web observation. Native previews `f96f622` / `009c9d9` remain unbuilt/unverified; Menu is unresolved despite one saved passing run. Parent still needs affected web/PWA and Apple/Android playback flows plus phone/tablet pass. |
| Ether cold detail | Merged, not lab-deployed. Deploy first, then drive cold-title against that revision. |
| Distribution | New Expo signed fixture still needs install/update/rollback, asset-retention and PWA qualification. Earlier Exact dry run is historical proof only. |
| Publication | Release not yet publicly published. Exact-version owner approval remains required before deliberate production publication. |
| Later scope | Dedicated macOS/Windows hosts; residual Exact cleanup follows migrated consumers and release path. |

The parent selects concrete affected flows; this ledger is not an exhaustive matrix
or a claim of broad app completion/device parity.
