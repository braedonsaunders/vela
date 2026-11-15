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
  Document skins use `doc`.
- **Look at the result** when you change UI or playback: one `bun exact.mjs agent web
  "screenshot .exact/x.png"` drive or a short manual run. One look, not a loop. If a fix
  takes three tries, stop and report the blocker.
- Highest quality means: correct semantics, clean module boundaries, honest states, no
  placeholders pretending to be features, no dead code, no speculative abstraction.
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
- Large scratch output goes under `~/.scratch/tmp/vela/`, never `/tmp`.
