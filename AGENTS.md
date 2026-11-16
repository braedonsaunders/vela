# Working in Vela

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [architecture](docs/architecture.md).
Work in `apps/vela`, `packages/*` and `modules/vela-player`. Never edit
`vendor/exact`. Preserve unrelated working changes and commit only your files.

Prioritize implementation and clean module boundaries. The routine check is
compile-only: `bun x tsc --noEmit -p apps/vela`; use the standalone mock-server
or web-player configuration when changing those areas. Respect explicit no-check
assignments. Do not add test suites, CI, lint or coverage machinery, or run
Exact's maintainer checks.

Inspect UI/playback changes in the app before claiming verification. Code-only
workers must identify the exact flow still requiring a runtime look. Coordinate
shared wiring, protocol, exports and dependency changes with maintainers.
