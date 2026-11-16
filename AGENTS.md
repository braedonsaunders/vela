# Working in Vela

Vela is a greenfield client. Speed of high-quality code is the priority. Read
[docs/build-plan.md](docs/build-plan.md) for the architecture, layout and who owns what.

## How to work

- **Write the code.** Spend your time on design and implementation, not on verification
  machinery. There is no CI. Do not add CI, test harnesses, lint configs, coverage, or
  test suites. Do not run Exact's own checks (`cargo test`, `clippy`, `caps.mjs`,
  `affected.mjs`, the async lane, `exact.mjs verify`) — those are for Exact's maintainers.
- **RN/Expo is the current app.** Work in `apps/vela`, `packages/*` and
  `modules/vela-player`; see the build plan for the migration map. Exact's `client/`
  app/dispatch has been removed; any remaining Exact tooling is legacy, not the routine loop.
- **The only routine check is compile-only**, once a coherent chunk is written:
  `bun x tsc --noEmit -p apps/vela` from the repository root. It includes package
  sources through `apps/vela/tsconfig.json` (not project references). For standalone
  mock-server TypeScript use `bun x tsc --noEmit -p mock-server`. The web player has
  its own config: `bun x tsc --noEmit -p modules/vela-player/web` when that code changes.
  Fix compiler errors and move on. An Expo export or native build is a delivery task,
  not an additional routine check. Respect a task's explicit no-check restriction.
- **Look at the result before announcing UI/playback changes.** The parent owns one
  real browser/device look for the affected flow. A worker restricted to coding must
  hand off the exact changed flow and say it is unverified; a compile is not visual or
  playback proof. Renderer widget/binding/action/resolver changes need one document
  using the rule driven through the RN app before they ship. One look, not a loop.
  If a fix takes three tries, stop and report the blocker.
- Highest quality means: correct semantics, clean module boundaries, honest states, no
  placeholders pretending to be features, no dead code, no speculative abstraction.
- Write for human maintainers: one statement per line, ordinary formatting and whitespace,
  lines under about 120 characters, descriptive names, and small modules with one job each
  (no god classes with dozens of private fields). Dense or minified-looking source is a
  defect, not a style.
- Never touch `vendor/exact` (pinned upstream checkout, gitignored). If Exact lacks
  something, work around it in Vela and note it for the orchestrator.
- Stay inside the paths you own (build plan). Shared app wiring, package exports, wire
  types, root dependency/lock files and generators need coordination with the orchestrator before changing paths. Make small,
  additive edits and commit promptly. See `docs/build-plan.md` for current ownership.
- Commit often to `main` with a clear message, only your own files (`git add <paths>`,
  never `git add -A`). Never `git stash`, never rewrite history, never force anything.
- Report back briefly: what landed (commit hashes), what is real vs stubbed, blockers.

## Toolchain

- Bun 1.4.2 is in `.tools/bun-darwin-aarch64/` (gitignored). Put it first on PATH:
  `export PATH="$PWD/.tools/bun-darwin-aarch64:$PATH"` from the repo root (or
  `source tools/env.sh`).
- The root is a Bun workspace (`apps/*`, `packages/*`, `modules/*`) with hoisted
  dependencies (`bunfig.toml`). `apps/vela/package.json` owns the Expo/React/RN pins;
  RN uses the `react-native-tvos` alias. Do not replace it with stock RN incidentally.
- Exact is the legacy pinned checkout (`EXACT_REVISION`, `vendor/exact`), not the
  current RN app runtime. Never edit it or remove it while consumers remain.
- Dependencies: `bun install --frozen-lockfile` with Bun 1.4.2 is the routine install. Adding or
  changing a dependency with Bun 1.4.2 fails in this repo (garbled registry names such as
  `ehttps:%2f%2fregistry` or `js@babel%2fcode-fra`). Workaround: edit the package.json, run
  `~/.bun/bin/bun install` (Bun 1.3.x) once only to read the new `bun.lock` entries, then
  `git checkout bun.lock` and copy just those entries (the workspace's dependency lines and
  the package lines) into it by hand. Never commit a Bun 1.3 lockfile: it rewrites
  `lockfileVersion` and re-resolves unrelated packages. Finish with
  `bun install --frozen-lockfile` under 1.4.2.
- Large scratch output goes under `~/.scratch/tmp/vela/`, never `/tmp`.
- Bulky build output lives on the scratch drive, not the internal disk: make `.artifacts`,
  legacy `client/.exact` and `client/target` in your worktree symlinks into
  `~/.scratch/vela-build/<worktree>/` (create them before your first build; the ignore
  rules cover the symlinks). Delete superseded candidates and release attempts yourself;
  keep the current one and its rollback.
- RN export, native prebuild output, DerivedData, Gradle caches and player payloads
  also belong under `~/.scratch/vela-build/<worktree>/`. Generated native projects
  are not committed. Scratch is temporary; preserve release evidence durably before
  cleanup. Remove task scratch when finished, retaining the current candidate and rollback.
- The current orchestrator is `thr_4q8296jknz`; prior orchestration threads are archived.
  Code-only workers hand off runtime and release gates to this parent.
