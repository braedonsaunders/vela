# Working in Vela

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [architecture](docs/architecture.md).
Work in `apps/vela`, `packages/*` and `modules/vela-player`. Never edit
`vendor/exact`. Preserve unrelated working changes and commit only your files.

Prioritize implementation and clean module boundaries. The routine check is
`bun run typecheck` (or `bun x tsc --noEmit -p apps/vela` for a quick app-only
pass) and `bun run test`; run `bun run check:skins` after changing skin
documents or the resolver. CI runs all three, plus a Windows host build, on
every push and pull request to `main`. Respect explicit no-check assignments,
and do not run Exact's maintainer checks.

Tests use Bun's built-in runner and live beside the code in `test/` folders
(`packages/*/test`, `modules/*/test`, `mock-server/test`). Add tests for pure
logic you change: behaviour, not snapshots. Do not add new test frameworks,
lint or coverage tooling without coordinating with maintainers.

Inspect UI/playback changes in the app before claiming verification. Code-only
workers must identify the exact flow still requiring a runtime look. Coordinate
shared wiring, protocol, exports and dependency changes with maintainers.
