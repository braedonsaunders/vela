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

Keep changes focused, use descriptive names and ordinary formatting, and avoid
speculative abstractions. Coordinate changes to wire types, shared exports and
root dependencies with maintainers. Never commit credentials, private signing
keys, generated native projects or build output.
