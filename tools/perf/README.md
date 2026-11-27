# Vela Performance Harness (`tools/perf`)

Measured performance and load-regression tools for built-in experience documents and plugin screens (`docs/experiences.md`, `docs/plugin-screens.md`), targeting the owner's floor TV device profile (budget Google TV stick: onn 4K / Chromecast with Google TV class) and Ether's parallel source-read path.

## Performance Budgets

| Metric | Target Budget | Measurement Method |
| :--- | :--- | :--- |
| **First-frame time** | `<= 400 ms` | Route entry (`router.push(route)`) to first rendered route frame (`FrameCompleted` in `dumpsys gfxinfo app.ether.vela framestats`) on `vela-tv-floor` |
| **Focus-move frame time (`p95`)** | `<= 16 ms` | `p95` of `(FrameCompleted - IntendedVsync) / 1e6` across a 16-step deterministic D-pad traversal (`KEYCODE_DPAD_*`) |
| **Single live record push cost** | `<= 2 frames` (readers only) | Frames rendered after a single live record push on `/vela/v0/live/stream`, paired with structural reader-invalidation audit (`tools/perf/record-push.ts`) |
| **Parallel source reads (`N=4`, `N=8`)** | `0 errors`, server stays up | Concurrent `GET /vela/v0/screens/{screen}/pages/{page}/data` requesting all page sources (eager + lazy) while holding 4 active stream topics on `/vela/v0/live/stream` |

---

## Files

- `gate.ts`: Enforced opt-in TV performance gate (`bun tools/perf/gate.ts <route>`) for built-in experience documents and plugin screens. Runs `vela-tv-floor` measurements on `gpu-workstation` (Linux only, single-emulator lock, killing only its own PIDs) and exits non-zero when any budget (`firstFrame <= 400 ms`, `focusMove p95 <= 16 ms`, `recordPush <= 2 frames & readers-only`) fails.
- `emulator-floor.sh`: Configures and manages the `vela-tv-floor` Android TV AVD on `gpu-workstation` (`1920x1080 @ 320 dpi`, `2048 MB` RAM, `4` cores throttled to Cortex-A55 class via `systemd-run --user --scope -p CPUQuota=100%`). Records its exact PID and only ever stops the PID it started. Refuses to run on macOS.
- `tv-route.ts`: Measures a route (or compares legacy `/screen/sports` vs document `/screen/sports?screens=1` via `--compare-sports`) on the `vela-tv-floor` emulator.
- `gfxinfo.ts`: Parser and percentile (`p50`, `p95`, `max`, jank count `> 16.67 ms`) calculator for Android `dumpsys gfxinfo <pkg> framestats` (`PROFILEDATA` CSV blocks).
- `record-push.ts`: Structural reader isolation probe that evaluates a screen document's collections against `RecordStore` and counts how many items actually read a pushed `$record` vs how many items are invalidated by `ScreenView`'s root `useRecordReader()`.
- `data-reads.ts`: Bounded, opt-in load regression for parallel screen page data reads (`N` up to 8, requesting all sources) with 4 open `/vela/v0/live/stream` topics. Enforces a version gate (`>= 0.3.21-preview.32-screens`) before running against `--lab`.
- `perf.test.ts`: Unit tests for `gate.ts`, `gfxinfo.ts`, `record-push.ts`, and the `data-reads.ts` version gate.
- `tv-nav.ts`, `tv-nav-analysis.ts`, `tv-nav.test.ts`: per-press D-pad responsiveness on any Android TV emulator or device (section 3).
- `repack-js.sh`: a measurement APK for a JS-only change (a fresh Hermes bundle in a release APK).
- `probe/`: measurement-only React commit and JS-time probes, bundled only with `VELA_PERF_PROBE=1`.

---

## 1. Enforced TV Performance Gate (`tools/perf/gate.ts`, `gpu-workstation` only)

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

### Run the Enforced Gate for a Built-In Experience or Screen Route

```bash
# Gate a built-in experience route (e.g. /listen or /library/music) or plugin screen (/screen/sports):
bun tools/perf/gate.ts /listen
bun tools/perf/gate.ts /screen/sports --json --out tools/perf/reports/sports-gate.json
```

- Refuses to run on macOS (`assertLinuxHost`).
- Acquires a single-emulator lock (`~/.scratch/tmp/vela-tv-floor/gate.lock`) so two runs never contend on `emulator-5584`.
- Exits with code `1` if `firstFrame > 400 ms`, `focusMove p95 > 16 ms`, `recordPush > 2 frames`, or `passReaderIsolation` is false.

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

---

## 3. D-pad responsiveness per press (`tools/perf/tv-nav.ts`, any Android TV emulator or device)

Drives a named scenario with real key presses (`input keyevent --duration 80`, paced by the device)
under a Perfetto trace, and reports for every press:

| Column | Meaning |
| :--- | :--- |
| `focusMs` | key-down → the native focus change reaching JS (Fabric `topFocus`) |
| `mountMs` | key-down → end of the first Fabric mount after it (JS answered and it was applied) |
| `frameMs` | key-down → end of the first RenderThread frame begun after that mount |
| `settleMs` | key-down → the frame after the press's last mount followed by 400 ms without one |
| `jsMs`, `mainMs`, `renderMs` | CPU time on the JS thread, the UI thread and RenderThread |
| `mounts`, `frames` | Fabric mounts applied, frames drawn |
| `commits`, `comps` | React commits and components rendered (probe builds only) |

It also prints whole-run frames and CPU per second (what a screen costs just being on show; use
scenario `idle`). Scenarios (`home`, `movies`, `library`, `title`, `player`, `burst`, `idle`) force-stop
and launch the app, so runs are comparable; `player` reaches playback in unmeasured `setup` presses
first. The build decides the server: a lab or mock sign-in build (below).

```bash
# Measurement APK for a JS-only change: this tree's production Hermes bundle in a release APK.
EXPO_PUBLIC_VELA_SERVER=http://10.0.2.2:7845 EXPO_PUBLIC_VELA_MOCK=1 \
  tools/perf/repack-js.sh Vela-0.2.77-androidtv.apk ~/.scratch/tmp/vela-perf/after.apk [--probe]
adb -s emulator-5704 uninstall app.ether.vela; adb -s emulator-5704 install ~/.scratch/tmp/vela-perf/after.apk
bun tools/perf/tv-nav.ts --serial emulator-5704 --scenario home,library,player --label after --out after.json
bun tools/perf/tv-nav.ts --compare before.json after.json
```

- **Release vs probe.** Take CPU and latency numbers from release bundles. `--probe` builds an unminified
  bundle with `tools/perf/probe/` (Metro adds it only with `VELA_PERF_PROBE=1`): per commit it logs the
  components rendered (`top`), the host views updated or mounted (`upd`) and where each update started
  (`src`), and every 200 ms where JS time went (Fabric events, timers by bundle line, `completeRoot`).
- **Credentials.** A sign-in build embeds the account in the bundle: keep it under `~/.scratch` and delete it.
- **Software rendering.** On emulators RenderThread time and frame durations are relative only; compare
  builds on the same emulator, and treat JS/UI CPU and render counts as what carries over to devices.
- **Native profiles.** `VELA_PERF_PROFILEABLE=1` at prebuild (`plugins/android-profileable.js`) makes a
  release build profileable (simpleperf `--app app.ether.vela`) and adds a broadcast that runs Hermes's
  sampling profiler; see the plugin for the commands.
- `--keep <dir>` keeps each trace for ui.perfetto.dev. Needs `adb` and `trace_processor` (`--adb`, `--tp`).

### Lab devices and kernels without tracing (`--lab`, `--light`)

On the lab host (homeserver), `--lab <device> --owner <claim owner>` drives a claimed lab device through
`lab shell` instead of adb: scripts go in as base64, traces come back over netcat on the lab network (else as
gzip+base64 chunks under `lab shell`'s 100 kB cap). Android before 12 has no `input keyevent --duration`, so
presses there are instant; Android 9 and 10 start `traced` only with `persist.traced.enable=1`.

Some boxes' kernels have no tracing at all (the lab's `tx1-box`: no tracefs, so Perfetto records no ftrace).
`--light` measures them from what they do give: a logcat mark as `input keyevent` returns (Android 10 waits for
the app to handle the key), frames from `dumpsys gfxinfo framestats` dumped through each window, and the JS, UI
and RenderThread run time from `/proc/<pid>/task/<tid>/schedstat`. It reports `frameMs` (first frame),
`settleMs`, `jank` (frames over 16.7 ms), `worstMs` and CPU per thread, but no focus or mount times; a launch's
`contentMs` is when its JS thread went quiet (under a quarter busy for 3 s). `--watch <titleId>` makes the
`player` scenario reach playback through that title's watch link.

```bash
# On homeserver, with tx1-box claimed as $OWNER; let the SoC cool between runs (it idles near 69 C).
bun tools/perf/tv-nav.ts --lab tx1-box --owner "$OWNER" --light --scenario cold,home,griddeep,title,transitions,idle \
  --settle 30000 --out after.json
```
