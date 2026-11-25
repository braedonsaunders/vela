# Contributing

Read [architecture](docs/architecture.md) for the source layout. Vela's current
application is `apps/vela`; remaining Exact tooling is legacy. Do not modify
`vendor/exact` or generated native projects.

Use the pinned Bun toolchain and frozen workspace dependencies:

```sh
source tools/env.sh
bun install --frozen-lockfile
# The mock server is a standalone package; it also provides Bun's types to the tests.
(cd mock-server && bun install --frozen-lockfile)
```

After a coherent source change, typecheck and run the tests:

```sh
bun run typecheck    # apps/vela, mock-server, modules/vela-player/web and the tests
bun run test         # bun test over packages, modules and mock-server
bun run check:skins  # after changing skin documents or the resolver
```

For a quick pass, `bun x tsc --noEmit -p apps/vela` (or `-p mock-server`,
`-p modules/vela-player/web`) checks one project. The web player compiles the
pinned mediabunny source, which has a few upstream diagnostics; `bun run
typecheck` reports those without failing and fails on any in Vela's own files.

Tests use Bun's built-in runner (`bun:test`) and live in `test/` folders beside
the code they cover. Test pure logic and protocol behaviour with small inline
fixtures; adapters run against a routed `fetch` stand-in, and mock-server tests
launch the mock on a free port. Prefer assertions about behaviour over
snapshots, and keep tests fast and independent of the network and local media.

GitHub Actions (`.github/workflows/ci.yml`) runs the typecheck, tests and skin
check on every push and pull request to `main`, and publishes the Windows host
to prove it compiles. CI sees only tracked files: anything built from
`vendor/` or other untracked inputs (player payloads, release builds) stays out
of it. Do not add other test frameworks, lint configuration or coverage
machinery without coordinating with maintainers. Exact's maintainer checks are
not part of Vela's contributor workflow. Native builds and Expo exports are
delivery work, not routine checks.

For UI or playback changes, inspect the affected flow in the actual app and
report which platform was observed. Renderer rules need a document exercising
them through the app. Explicitly identify unverified device behavior.

## Release e2e gate

Release qualification is automated in `tests/e2e`; do not substitute a by-hand
lab checklist. Before an Ether RC, the coordinator runs the complete muted web
gate with one command:

```sh
tools/e2e-gate.sh ~/.scratch/tmp/thr_9jsg8ia37s/vela-e2e.env
```

The dotenv file must be mode 600 and belong to the dedicated lab viewer. Never
use a production viewer. The command runs deterministic mock faults first, then
Chromium and WebKit against the private lab, and ends with exactly
`VELA RELEASE GATE: PASS` or `VELA RELEASE GATE: FAIL`. Every suite restores
watch state and closes playback it changes; the gate's run-level cleanup
revokes the Vela session. Plex-mode tests use the separately configured
owner-token file through the harness's secret route: never print, copy, revoke,
or replace that token, and never ask for a plex.tv link code.

Release suites use exact `expect(...)` assertions. Natural-language
`agent.act(...)` steps are allowed only when followed by exact assertions and
their recordings under `.e2e/cache/` are committed. `agent.assert(...)` belongs
only in exploratory or bug-bash suites. CI runs the deterministic web targets
with `e2e run --strict-cache`, so a missing or stale recording fails without a
model call. Re-record intentionally with Codex only, review the actions for
secrets and scope, then prove the same target with `--strict-cache`.

Mock-only cases live under `tests/e2e/mock` and use `mock-server/` plus
`/__admin/faults` for repeatable faults, markers, and stale bootstrap responses.
Do not make a release gate depend on a naturally occurring lab fault.

Native release targets are simulators and emulators only: iOS, tvOS, Android,
and Android TV. Never select a physical Apple TV or an owner's device. Keep all
media muted, check memory before starting, run one native target at a time, shut
it down afterward, and take the shared build lock with
`VELA_NATIVE_LOCK=$HOME/.bb/thread-storage/vela-orch/native.lock`. Android
emulators on the GPU worker render in software, so compare frame times rather
than treating them as absolute performance measurements.

Keep changes focused, use descriptive names and ordinary formatting, and avoid
speculative abstractions. Coordinate changes to wire types, shared exports and
root dependencies with maintainers. Never commit credentials, private signing
keys, generated native projects or build output.
