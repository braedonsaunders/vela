# Vela Performance Harness (`tools/perf`)

Measured performance and load-regression tools for plugin screens (`docs/plugin-screens.md`), targeting the owner's floor TV device profile (budget Google TV stick: onn 4K / Chromecast with Google TV class) and Ether's parallel source-read path.

## Performance Budgets

| Metric | Target Budget | Measurement Method |
| :--- | :--- | :--- |
| **First-frame time** | `<= 400 ms` | Route entry (`router.push(route)`) to first rendered route frame (`FrameCompleted` in `dumpsys gfxinfo app.ether.vela framestats`) on `vela-tv-floor` |
| **Focus-move frame time (`p95`)** | `<= 16 ms` | `p95` of `(FrameCompleted - IntendedVsync) / 1e6` across a 16-step deterministic D-pad traversal (`KEYCODE_DPAD_*`) |
| **Single live record push cost** | `<= 2 frames` (readers only) | Frames rendered after a single live record push on `/vela/v0/live/stream`, paired with structural reader-invalidation audit (`tools/perf/record-push.ts`) |
| **Parallel source reads (`N=4`, `N=8`)** | `0 errors`, server stays up | Concurrent `GET /vela/v0/screens/{screen}/pages/{page}/data` requesting all page sources (eager + lazy) while holding 4 active stream topics on `/vela/v0/live/stream` |

---

## Files

- [`emulator-floor.sh`](file:///Users/braedonsaunders/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_tx7jctbqv7-1/vela/tools/perf/emulator-floor.sh): Configures and manages the `vela-tv-floor` Android TV AVD on `gpu-workstation` (`1920x1080 @ 320 dpi`, `2048 MB` RAM, `4` cores throttled to Cortex-A55 class via `systemd-run --user --scope -p CPUQuota=100%`). Records its exact PID and only ever stops the PID it started. Refuses to run on macOS.
- [`tv-route.ts`](file:///Users/braedonsaunders/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_tx7jctbqv7-1/vela/tools/perf/tv-route.ts): Measures a route (or compares legacy `/screen/sports` vs document `/screen/sports?screens=1` via `--compare-sports`) on the `vela-tv-floor` emulator.
- [`gfxinfo.ts`](file:///Users/braedonsaunders/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_tx7jctbqv7-1/vela/tools/perf/gfxinfo.ts): Parser and percentile (`p50`, `p95`, `max`, jank count `> 16.67 ms`) calculator for Android `dumpsys gfxinfo <pkg> framestats` (`PROFILEDATA` CSV blocks).
- [`record-push.ts`](file:///Users/braedonsaunders/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_tx7jctbqv7-1/vela/tools/perf/record-push.ts): Structural reader isolation probe that evaluates a screen document's collections against `RecordStore` and counts how many items actually read a pushed `$record` vs how many items are invalidated by `ScreenView`'s root `useRecordReader()`.
- [`data-reads.ts`](file:///Users/braedonsaunders/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_tx7jctbqv7-1/vela/tools/perf/data-reads.ts): Bounded, opt-in load regression for parallel screen page data reads (`N` up to 8, requesting all sources) with 4 open `/vela/v0/live/stream` topics. Enforces a version gate (`>= 0.3.21-preview.32-screens`) before running against `--lab`.
- [`perf.test.ts`](file:///Users/braedonsaunders/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_tx7jctbqv7-1/vela/tools/perf/perf.test.ts): Unit tests for `gfxinfo.ts`, `record-push.ts`, and the `data-reads.ts` version gate.

---

## 1. Android TV Floor Emulator Profile (`gpu-workstation` only)

All Android TV emulator runs execute on `gpu-workstation` (`Ubuntu-24.04` WSL2) — never on macOS.

### Start `vela-tv-floor` on `gpu-workstation`

```bash
# On gpu-workstation (Ubuntu-24.04):
bash tools/perf/emulator-floor.sh start --port 5584 --cpu-quota 100%
```

- **AVD**: `vela-tv-floor` (`android-36/android-tv/x86_64`)
- **Resolution / Density**: `1920x1080` @ `320 dpi`
- **Memory**: `2048 MB` RAM (`256 MB` VM heap)
- **CPU**: `4` vCPUs pinned to cores `0-3` and throttled with `systemd-run --user --scope -p CPUQuota=100%` (~25% of one host Zen 5 core per guest vCPU, matching Amlogic S905Y4 / S905X2 quad-core Cortex-A55 throughput)

### Measure a Single Route or Compare Legacy vs Document Sports

```bash
# Measure a single route on emulator-5584:
bun tools/perf/tv-route.ts --udid emulator-5584 --route "/screen/sports?screens=1"

# Run the full legacy (/screen/sports) vs document (/screen/sports?screens=1) comparison:
bun tools/perf/tv-route.ts \
  --udid emulator-5584 \
  --compare-sports \
  --out tools/perf/reports/sports-tv-floor.md \
  --json tools/perf/reports/sports-tv-floor.json
```

### Stop `vela-tv-floor`

```bash
# Stops ONLY the PID recorded in ~/.scratch/tmp/vela-tv-floor/emulator-5584.pid:
bash tools/perf/emulator-floor.sh stop --port 5584
```

---

## 2. Parallel Source Reads Load Regression (`tools/perf/data-reads.ts`)

Fires `N` concurrent `GET /vela/v0/screens/{screen}/pages/{page}/data` requests (including every eager and lazy source in the page document) while maintaining 4 active topics on `/vela/v0/live/stream`. Reports latency `p50` and `p95`, error count, and whether the server stayed up.

### Against the Local Mock Server

```bash
bun tools/perf/data-reads.ts --mock --server http://127.0.0.1:7845 --n 4,8
```

### Against the Lab (`preview.32-screens` or newer required)

```bash
bun tools/perf/data-reads.ts --lab --n 4,8
```

- Reads validation credentials in code from `~/.scratch/tmp/thr_9jsg8ia37s/vela-lab.env` (never printed).
- Checks `/ether/api/updates/` first and refuses to run if `current` is older than `0.3.21-preview.32-screens`.
- Runs once at `N=4` then `N=8` (`<= 8` cap) and stops immediately on the first error.

### Music visualizer

Use the muted app on a private Android TV emulator. For the 2 GB floor, check
that the artwork tint and transport remain usable when the capability gate
hides the visualizer. On an enabled tier, start a music queue, then open Now
Playing and the full-screen visualizer. Record the app process's
`VelaVisualizer` firstFrame messages for this run. Each marks the first
TextureView presentation after selecting or initializing that scene.

With the stage focused, check Left and Right, then Select to open the scene
rail. Reset `adb -s SERIAL shell dumpsys gfxinfo app.ether.vela reset`, traverse
the rail with 16 D-pad moves and save `dumpsys gfxinfo app.ether.vela framestats`
as `focus.gfxinfo`. Reset again and capture the steady music screen in
`steady.gfxinfo`. Verify Back returns to the same playing track and the
mini-player retains its position after closing Now Playing.

```sh
bun tools/perf/visualizer.ts first-frame.log focus.gfxinfo steady.gfxinfo
```

The report checks the scene-start and focus budgets and counts UI-thread draws
over one 60 Hz interval. Missing presentation or frame samples yield an
unmeasured result. Measure the renderer's own frame intervals separately from
the UI frame statistics.
