# Working in Vela

Vela is a greenfield client. Speed of high-quality code is the priority. Read
[docs/build-plan.md](docs/build-plan.md) for the architecture, layout and who owns what.

## How to work

- **Write the code.** Spend your time on design and implementation, not on verification
  machinery. There is no CI. Do not add CI, test harnesses, lint configs, coverage, or
  test suites. Do not run Exact's own checks (`cargo test`, `clippy`, `caps.mjs`,
  `affected.mjs`, the async lane, `exact.mjs verify`) — those are for Exact's maintainers.
- **The only routine check** is that your code compiles: `bun exact.mjs contract build
  app.contract --json --errors-only` in `client/` (it also type-checks `app.ts`), and
  `bun x tsc --noEmit` for standalone TypeScript (`mock-server/`). Run it once you have a
  coherent chunk written, fix what it reports, move on.
- **While compiled skins exist, check one engine, not the all-skins app** (its lowering takes
  15+ minutes): `bun tools/check.ts <engine>` stages your checkout, profiles it to that engine
  and runs the errors-only contract build under the shared build lock; `bun tools/check.ts doc
  --agent "<op>" …` drives the profile with `exact.mjs agent web`, under reduced motion
  (ambient players stall on the agent's virtual clock); add `--motion` to drive with motion.
  `bun tools/check.ts doc --serve --port <n>` keeps a built profile served for repeated drives
  (`bun exact.mjs agent web --url http://127.0.0.1:<n>/ …`).
  Document skins use `doc`.
- **Renderer changes are driven before they are announced**: a new widget, binding, action or
  resolver rule ships only after one document that uses it has been driven in a browser
  (`bun tools/check.ts doc --serve` or `--agent`). A compile alone has twice broken every document.
- **Look at the result** when you change UI or playback: one `bun exact.mjs agent web
  "screenshot .exact/x.png"` drive or a short manual run. One look, not a loop. If a fix
  takes three tries, stop and report the blocker.
- Highest quality means: correct semantics, clean module boundaries, honest states, no
  placeholders pretending to be features, no dead code, no speculative abstraction.
- Write for human maintainers: one statement per line, ordinary formatting and whitespace,
  lines under about 120 characters, descriptive names, and small modules with one job each
  (no god classes with dozens of private fields). Dense or minified-looking source is a
  defect, not a style.
- Never touch `vendor/exact` (pinned upstream checkout, gitignored). If Exact lacks
  something, work around it in Vela and note it for the orchestrator.
- Stay inside the paths you own (build plan). Shared files (`client/app.contract`,
  `client/app.ts`, `protocol/v0/types.ts`): make small, additive edits and commit promptly.
- Commit often to `main` with a clear message, only your own files (`git add <paths>`,
  never `git add -A`). Never `git stash`, never rewrite history, never force anything.
- Report back briefly: what landed (commit hashes), what is real vs stubbed, blockers.

## Toolchain

- Bun 1.4.2 is in `.tools/bun-darwin-aarch64/` (gitignored). Put it first on PATH:
  `export PATH="$PWD/.tools/bun-darwin-aarch64:$PATH"` from the repo root (or
  `source tools/env.sh` once it exists).
- Exact is pinned at `vendor/exact` (revision in `EXACT_REVISION`). The app is consumed by
  path; `client/exact.mjs` forwards to it.
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
  `client/.exact` and `client/target` in your worktree symlinks into
  `~/.scratch/vela-build/<worktree>/` (create them before your first build; the ignore
  rules cover the symlinks). Delete superseded candidates and release attempts yourself;
  keep the current one and its rollback.
