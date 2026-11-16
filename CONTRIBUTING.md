# Contributing

Read [architecture](docs/architecture.md) for the source layout. Vela's current
application is `apps/vela`; remaining Exact tooling is legacy. Do not modify
`vendor/exact` or generated native projects.

Use the pinned Bun toolchain and frozen workspace dependencies:

```sh
source tools/env.sh
bun install --frozen-lockfile
```

After a coherent source change, use the relevant compile-only check:

```sh
bun x tsc --noEmit -p apps/vela
# For changes in these standalone areas:
bun x tsc --noEmit -p mock-server
bun x tsc --noEmit -p modules/vela-player/web
```

Do not introduce CI, test harnesses, lint configuration or coverage machinery.
Exact's maintainer checks are not part of Vela's contributor workflow. Native
builds and Expo exports are delivery work, not routine checks.

For UI or playback changes, inspect the affected flow in the actual app and
report which platform was observed. Renderer rules need a document exercising
them through the app. Explicitly identify unverified device behavior.

Keep changes focused, use descriptive names and ordinary formatting, and avoid
speculative abstractions. Coordinate changes to wire types, shared exports and
root dependencies with maintainers. Never commit credentials, private signing
keys, generated native projects or build output.
