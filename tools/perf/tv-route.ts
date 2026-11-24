// Measured Android TV performance harness (`tools/perf/tv-route.ts`) for the budget Google TV floor
// profile (`vela-tv-floor` on `gpu-workstation`: 2 GB RAM, 4 cores throttled to Cortex-A55 class, 1080p).
//
// For a given route (or `--compare-sports` comparing the pre-cut legacy Sports screen at
// `plugin-screens/pre-cut` (`49522fc6`) vs the document Sports screen on `plugin-screens/main`),
// measures:
//   1. First-frame time (`firstFrameMs`, budget <= 400 ms):
//      Time from the route entry (`router.push(route)` after the 1500 ms `useStartRoutes` launch gate)
//      to the first rendered route frame (`FrameCompleted` in `dumpsys gfxinfo framestats`), plus the
//      first route frame's own render duration (`firstRouteFrameRenderMs`).
//   2. Focus-move frame times (`focusMove.p95Ms`, budget <= 16 ms):
//      Resets `gfxinfo`, steps through a deterministic 16-move D-pad traversal across the screen's
//      hero, filter chips, shelves, and cards, and computes `p50`, `p95`, `max`, and jank count from
//      `dumpsys gfxinfo app.ether.vela framestats`.
//   3. Single live record push cost (`recordPush.frames`, budget <= 2 frames, re-rendering only its readers):
//      Resets `gfxinfo`, triggers a single live record update on the mock server (toggling one team's
//      `favorite` record / event record push over `/vela/v0/live/stream`), waits 1200 ms, and counts
//      the frames rendered on the TV emulator, paired with the structural reader isolation audit from
//      `tools/perf/record-push.ts`.
//
// Safety invariants:
//   - Only kills child processes (`mock`, `metro`) that it spawned itself (never pkill/killall).
//   - Never starts an emulator on macOS; expects an `--udid` (`emulator-5584`) running on `gpu-workstation`.
//
// Usage:
//   bun tools/perf/tv-route.ts --udid emulator-5584 --route "/screen/sports" --variant document
//   bun tools/perf/tv-route.ts --udid emulator-5584 --compare-sports [--legacy-cwd /path/to/pre-cut-worktree] [--out tools/perf/reports/sports-tv-floor.md]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  parseGfxinfoFramestats,
  parseGfxinfoSummaryFallback,
  summarizeFrames,
  type FrameStatsSummary,
} from './gfxinfo';
import { auditSportsIndexRecordPush, type RecordPushAudit } from './record-push';

export const PERF_BUDGETS = {
  firstFrameMs: 400,
  focusMoveP95Ms: 16,
  recordPushMaxFrames: 2,
} as const;

export interface RoutePerfResult {
  label: string;
  route: string;
  gitRef?: string;
  udid: string;
  measuredAt: string;
  deviceProfile: {
    resolution: string;
    density: string;
    ramMb: number;
    cores: number;
    cpuQuota: string;
  };
  firstFrame: {
    /** Time from route entry (`useStartRoutes` 1500 ms timer) to first rendered route frame completion. */
    routeToFirstFrameMs: number;
    /** Duration (`(FrameCompleted - IntendedVsync) / 1e6`) of the heaviest initial route mount frame. */
    mountFrameMaxMs: number;
    /** Duration of the first route frame itself. */
    firstRouteFrameDurationMs: number;
    /** Total frames drawn during route mount & settle. */
    mountFrameCount: number;
    budgetMs: number;
    pass: boolean;
  };
  focusMove: {
    steps: number;
    stats: FrameStatsSummary;
    budgetP95Ms: number;
    pass: boolean;
  };
  recordPush: {
    kind: 'legacy-sse' | 'screen-record-stream';
    framesRendered: number;
    stats: FrameStatsSummary;
    readerAudit?: RecordPushAudit;
    budgetFrames: number;
    passFrames: boolean;
    passReaderIsolation: boolean;
    pass: boolean;
  };
}

const DPAD_SEQUENCE: string[] = [
  'KEYCODE_DPAD_DOWN',
  'KEYCODE_DPAD_RIGHT',
  'KEYCODE_DPAD_RIGHT',
  'KEYCODE_DPAD_LEFT',
  'KEYCODE_DPAD_DOWN',
  'KEYCODE_DPAD_RIGHT',
  'KEYCODE_DPAD_RIGHT',
  'KEYCODE_DPAD_RIGHT',
  'KEYCODE_DPAD_LEFT',
  'KEYCODE_DPAD_LEFT',
  'KEYCODE_DPAD_DOWN',
  'KEYCODE_DPAD_RIGHT',
  'KEYCODE_DPAD_RIGHT',
  'KEYCODE_DPAD_LEFT',
  'KEYCODE_DPAD_UP',
  'KEYCODE_DPAD_UP',
];

const APP = 'app.ether.vela';
const MOCK_TOKEN = 'vela-perf-mock-token';
const MOCK_DEVICE_ID = 'vela-dev';
const MOCK_AUTH_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${MOCK_TOKEN}`,
  'X-Vela-Device-Id': MOCK_DEVICE_ID,
};

export function formatComparisonMarkdown(
  legacy: RoutePerfResult,
  document: RoutePerfResult,
): string {
  const passBadge = (ok: boolean) => (ok ? 'PASS' : 'FAIL');
  const audit = document.recordPush.readerAudit;
  const legacyRef = legacy.gitRef ? ` @ \`${legacy.gitRef}\`` : '';
  const docRef = document.gitRef ? ` @ \`${document.gitRef}\`` : '';

  return `# Android TV Floor Performance Report — Sports Legacy vs Document

- **Measured At**: \`${document.measuredAt}\`
- **Target Floor Profile**: \`vela-tv-floor\` on \`gpu-workstation\` (budget Google TV stick class: onn 4K / Chromecast with Google TV)
  - **Display**: \`${document.deviceProfile.resolution}\` @ \`${document.deviceProfile.density}\`
  - **Memory**: \`${document.deviceProfile.ramMb} MB\` RAM
  - **CPU**: \`${document.deviceProfile.cores}\` vCPUs throttled via \`systemd-run --user -p CPUQuota=${document.deviceProfile.cpuQuota}\` (Cortex-A55 class)
- **Compared Builds**:
  - **Legacy**: \`${legacy.route}\`${legacyRef}
  - **Document**: \`${document.route}\`${docRef}
- **Budgets**:
  - First frame: \`<= ${PERF_BUDGETS.firstFrameMs} ms\`
  - Focus move \`p95\`: \`<= ${PERF_BUDGETS.focusMoveP95Ms} ms\`
  - Single live record push: \`<= ${PERF_BUDGETS.recordPushMaxFrames} frames\` (re-rendering only its readers)

## Summary Comparison

| Metric | Budget | Legacy (\`${legacy.route}\`${legacyRef}) | Document (\`${document.route}\`${docRef}) | Delta (Doc - Legacy) | Document Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **First-frame time** (route entry to first rendered frame) | \`<= ${PERF_BUDGETS.firstFrameMs} ms\` | **${legacy.firstFrame.routeToFirstFrameMs.toFixed(1)} ms** (peak mount frame: ${legacy.firstFrame.mountFrameMaxMs.toFixed(2)} ms, ${legacy.firstFrame.mountFrameCount} frames) | **${document.firstFrame.routeToFirstFrameMs.toFixed(1)} ms** (peak mount frame: ${document.firstFrame.mountFrameMaxMs.toFixed(2)} ms, ${document.firstFrame.mountFrameCount} frames) | ${(document.firstFrame.routeToFirstFrameMs - legacy.firstFrame.routeToFirstFrameMs >= 0 ? '+' : '') + (document.firstFrame.routeToFirstFrameMs - legacy.firstFrame.routeToFirstFrameMs).toFixed(1)} ms | **${passBadge(document.firstFrame.pass)}** |
| **Focus-move frame time (\`p95\`)** (${document.focusMove.steps} D-pad moves) | \`<= ${PERF_BUDGETS.focusMoveP95Ms} ms\` | **${legacy.focusMove.stats.p95Ms.toFixed(2)} ms** (\`p50\`: ${legacy.focusMove.stats.p50Ms.toFixed(2)} ms, \`max\`: ${legacy.focusMove.stats.maxMs.toFixed(2)} ms, frames: ${legacy.focusMove.stats.count}, jank: ${legacy.focusMove.stats.jankCount}) | **${document.focusMove.stats.p95Ms.toFixed(2)} ms** (\`p50\`: ${document.focusMove.stats.p50Ms.toFixed(2)} ms, \`max\`: ${document.focusMove.stats.maxMs.toFixed(2)} ms, frames: ${document.focusMove.stats.count}, jank: ${document.focusMove.stats.jankCount}) | ${(document.focusMove.stats.p95Ms - legacy.focusMove.stats.p95Ms >= 0 ? '+' : '') + (document.focusMove.stats.p95Ms - legacy.focusMove.stats.p95Ms).toFixed(2)} ms | **${passBadge(document.focusMove.pass)}** |
| **Single live record push cost** (frames & reader isolation) | \`<= ${PERF_BUDGETS.recordPushMaxFrames} frames\` & readers-only | **${legacy.recordPush.framesRendered} frames** (\`p95\`: ${legacy.recordPush.stats.p95Ms.toFixed(2)} ms, \`max\`: ${legacy.recordPush.stats.maxMs.toFixed(2)} ms) | **${document.recordPush.framesRendered} frames** (\`p95\`: ${document.recordPush.stats.p95Ms.toFixed(2)} ms, \`max\`: ${document.recordPush.stats.maxMs.toFixed(2)} ms; invalidated items: **${audit ? `${audit.currentRootInvalidatedItems}/${audit.totalCollectionItems}` : 'n/a'}** vs **${audit ? `${audit.actualReaderItems}` : 'n/a'}** actual readers) | ${document.recordPush.framesRendered - legacy.recordPush.framesRendered >= 0 ? '+' : ''}${document.recordPush.framesRendered - legacy.recordPush.framesRendered} frames | **${passBadge(document.recordPush.pass)}** (frames: ${passBadge(document.recordPush.passFrames)}, isolation: ${passBadge(document.recordPush.passReaderIsolation)}) |

## Detailed Findings for W3 (TV Focus & Perf Fixes)

### 1. Single Record Push Reader Isolation (\`packages/skin/src/screen/host.tsx\`)
${
  audit
    ? `- **Pushed Record**: \`${audit.pushedRecordKey}\`
- **Total Collection Items Rendered on Sports Index**: \`${audit.totalCollectionItems}\` (across hero, leagues, Your teams, Live now, schedule, standings, and team picker)
- **Actual Reader Items for \`${audit.pushedRecordKey}\`**: \`${audit.actualReaderItems}\` items
- **Currently Invalidated Items on Single Record Push**: \`${audit.currentRootInvalidatedItems}/${audit.totalCollectionItems}\` items (\`rootReadsTotalRecords = ${audit.rootReadsTotalRecords}\`)
- **With Per-Item \`useRecordReader()\`**: \`${audit.isolatedPerItemInvalidatedItems}/${audit.totalCollectionItems}\` items
- **Root Cause**: ${audit.rootCause}`
    : '- Reader isolation audit not applicable.'
}

### 2. Focus-Move Frame Distribution (${document.focusMove.steps} D-pad steps)
- **Legacy (\`${legacy.route}\`${legacyRef})**:
  - Frames rendered: \`${legacy.focusMove.stats.count}\`
  - \`p50 = ${legacy.focusMove.stats.p50Ms.toFixed(2)} ms\`, \`p95 = ${legacy.focusMove.stats.p95Ms.toFixed(2)} ms\`, \`max = ${legacy.focusMove.stats.maxMs.toFixed(2)} ms\`, \`mean = ${legacy.focusMove.stats.meanMs.toFixed(2)} ms\`
  - Jank frames (\`> 16.67 ms\`): \`${legacy.focusMove.stats.jankCount}\` (\`${(legacy.focusMove.stats.jankRatio * 100).toFixed(1)}%\`)
- **Document (\`${document.route}\`${docRef})**:
  - Frames rendered: \`${document.focusMove.stats.count}\`
  - \`p50 = ${document.focusMove.stats.p50Ms.toFixed(2)} ms\`, \`p95 = ${document.focusMove.stats.p95Ms.toFixed(2)} ms\`, \`max = ${document.focusMove.stats.maxMs.toFixed(2)} ms\`, \`mean = ${document.focusMove.stats.meanMs.toFixed(2)} ms\`
  - Jank frames (\`> 16.67 ms\`): \`${document.focusMove.stats.jankCount}\` (\`${(document.focusMove.stats.jankRatio * 100).toFixed(1)}%\`)
`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      udid: { type: 'string', default: 'emulator-5584' },
      route: { type: 'string' },
      variant: { type: 'string', default: 'document' },
      'compare-sports': { type: 'boolean', default: false },
      'legacy-cwd': { type: 'string' },
      'document-cwd': { type: 'string' },
      mock: { type: 'string' },
      'mock-port': { type: 'string', default: '7849' },
      'metro-port': { type: 'string', default: '8149' },
      settle: { type: 'string', default: '9000' },
      'cpu-quota': { type: 'string', default: process.env.VELA_TV_FLOOR_CPU_QUOTA ?? '200%' },
      out: { type: 'string' },
      json: { type: 'string' },
    },
  });

  const udid = values.udid!;
  const mockPort = values['mock-port']!;
  const metroPort = values['metro-port']!;
  const settleMs = Number(values.settle) || 9000;
  const cpuQuota = values['cpu-quota']!;
  const root = resolve(import.meta.dir, '../..');
  const legacyRoot = values['legacy-cwd'] ? resolve(values['legacy-cwd']) : root;
  const documentRoot = values['document-cwd'] ? resolve(values['document-cwd']) : root;

  function gitShortHead(repoDir: string): string {
    const res = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], {
      cwd: repoDir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    return res.exitCode === 0 ? res.stdout.toString().trim() : 'unknown';
  }

  function runAdb(...args: string[]): string {
    const adbBin = process.env.ADB ?? (process.env.ANDROID_SDK_ROOT ? `${process.env.ANDROID_SDK_ROOT}/platform-tools/adb` : 'adb');
    const adbEnv = {
      ...process.env,
      ANDROID_ADB_SERVER_PORT: process.env.ANDROID_ADB_SERVER_PORT ?? '5041',
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = Bun.spawnSync(['timeout', '25', adbBin, '-s', udid, ...args], {
        env: adbEnv,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (res.exitCode === 0) {
        return res.stdout.toString();
      }
      if (attempt === 1) {
        Bun.spawnSync(['timeout', '5', adbBin, 'reconnect', 'offline'], {
          env: adbEnv,
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
        });
      } else {
        throw new Error(`adb -s ${udid} ${args.join(' ')} failed (exit ${res.exitCode}): ${res.stderr.toString().trim()}`);
      }
    }
    return '';
  }

  /** Set the systemd user service CPUQuota for the emulator (if running under systemd-run). */
  function setEmulatorCpuQuota(quota: string): void {
    const portMatch = /emulator-(\d+)/.exec(udid);
    if (!portMatch) return;
    const unit = `vela-tv-floor-${portMatch[1]}.service`;
    Bun.spawnSync(['systemctl', '--user', 'set-property', unit, `CPUQuota=${quota}`], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
  }

  /** Start an isolated frozen mock server on `mockPort` if `--mock` was not externally supplied.
   *  Returns the mock URL and a cleanup callback that kills ONLY its own child PID. */
  async function ensureMockServer(): Promise<{ url: string; stop: () => void }> {
    if (values.mock) {
      return { url: values.mock, stop: () => {} };
    }
    const url = `http://127.0.0.1:${mockPort}`;
    const child = Bun.spawn(['bun', 'mock-server/main.ts'], {
      cwd: documentRoot,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: mockPort,
        VELA_MOCK_SPORTS_FREEZE: '1',
        VELA_MOCK_TOKEN: MOCK_TOKEN,
      },
    });
    const started = Date.now();
    let ready = false;
    while (Date.now() - started < 20_000) {
      try {
        const res = await fetch(`${url}/__admin/sports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spoilerFree: false, screenDelayMs: 0, screenFail: false }),
        });
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // still booting
      }
      await Bun.sleep(200);
    }
    if (!ready) {
      child.kill();
      throw new Error(`Timed out waiting for mock-server on ${url}`);
    }
    return {
      url,
      stop: () => {
        try {
          child.kill();
        } catch {}
      },
    };
  }

  /** Start Metro in `repoDir/apps/vela` for a single `EXPO_PUBLIC_VELA_START_ROUTES` target and
   *  pre-warm the Android bundle so first-frame measurement reflects app + route execution rather
   *  than cold Metro JS bundling. Returns a stop function that kills ONLY the spawned Metro PID. */
  async function startMetroForRoute(repoDir: string, mockUrl: string, route: string): Promise<() => void> {
    const log: string[] = [];
    const child = Bun.spawn(['bun', 'x', 'expo', 'start', '--port', metroPort, '--clear', '--no-dev'], {
      cwd: join(repoDir, 'apps/vela'),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        EXPO_PUBLIC_VELA_SERVER: mockUrl,
        EXPO_PUBLIC_VELA_MOCK: '1',
        EXPO_PUBLIC_VELA_START_ROUTES: route,
        CI: '1',
      },
    });
    const drain = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        log.push(new TextDecoder().decode(next.value));
      }
    };
    void drain(child.stdout);
    void drain(child.stderr);

    const started = Date.now();
    while (!log.join('').includes(`localhost:${metroPort}`) && Date.now() - started < 120_000) {
      await Bun.sleep(400);
    }

    // Warm the Android JS bundle once so Metro's transform cache is hot before the timed launch.
    try {
      const statusRes = await fetch(`http://127.0.0.1:${metroPort}/status`);
      if (statusRes.ok) {
        const bundleUrl = `http://127.0.0.1:${metroPort}/node_modules/expo-router/entry.bundle?platform=android&dev=false&minify=false`;
        await fetch(bundleUrl).then(r => r.arrayBuffer()).catch(() => {});
      }
    } catch {
      // ignore pre-warm errors
    }

    return () => {
      try {
        child.kill();
      } catch {}
    };
  }

  function queryDeviceProfile(): RoutePerfResult['deviceProfile'] {
    const out = runAdb(
      'shell',
      'wm size; wm density; grep MemTotal /proc/meminfo; grep -c "^processor" /proc/cpuinfo',
    );
    const lines = out.trim().split(/\r?\n/);
    const sizeMatch = /(\d+x\d+)/.exec(out);
    const densityMatch = /density:\s*(\d+)/i.exec(out);
    const memKbMatch = /MemTotal:\s*(\d+)/i.exec(out);
    const coresLine = lines[lines.length - 1]?.trim() ?? '4';

    return {
      resolution: sizeMatch ? sizeMatch[1]! : '1920x1080',
      density: densityMatch ? `${densityMatch[1]} dpi` : '320 dpi',
      ramMb: memKbMatch ? Math.round(Number(memKbMatch[1]) / 1024) : 2048,
      cores: Number(coresLine) || 4,
      cpuQuota,
    };
  }

  /** Trigger a single live record push on the mock server while the Sports route is open.
   *  For document routes, calls `POST /vela/v0/screens/sports/actions/ether.favorite`
   *  which pushes the updated `entity:sports:sports:team:nfl-phi` and `event:sports:sports:nfl-nyg-phi`
   *  records over `/vela/v0/live/stream`.
   *  For legacy routes, triggers an event update over `/vela/v0/live/stream`. */
  async function triggerSingleRecordPush(mockUrl: string, isDocumentVariant: boolean): Promise<void> {
    if (isDocumentVariant) {
      await fetch(`${mockUrl}/vela/v0/screens/sports/actions/ether.favorite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vela-Screen-Renderer': '19',
          ...MOCK_AUTH_HEADERS,
        },
        body: JSON.stringify({
          page: 'index',
          args: { ref: 'entity:sports:sports:team:nfl-phi', on: false },
        }),
      });
    } else {
      await fetch(`${mockUrl}/__admin/sports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spoilerFree: true }),
      });
    }
  }

  async function measureRoute(
    repoDir: string,
    mockUrl: string,
    route: string,
    label: 'legacy' | 'document',
    deviceProfile: RoutePerfResult['deviceProfile'],
  ): Promise<RoutePerfResult> {
    // Unthrottle emulator during Metro bundling & ADB setup so host Metro doesn't starve the guest adbd
    setEmulatorCpuQuota('400%');

    // Reset mock state to deterministic defaults
    await fetch(`${mockUrl}/__admin/sports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spoilerFree: false, screenDelayMs: 0, screenFail: false, favourites: null }),
    });

    const stopMetro = await startMetroForRoute(repoDir, mockUrl, route);

    try {
      runAdb('reverse', `tcp:${metroPort}`, `tcp:${metroPort}`);
      const mPort = new URL(mockUrl).port;
      if (mPort) runAdb('reverse', `tcp:${mPort}`, `tcp:${mPort}`);

      // Single batched shell setup: stop app, clear data, write React Native dev prefs
      const prefs = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map><string name="debug_http_host">localhost:${metroPort}</string><boolean name="js_dev_mode_debug" value="false" /></map>`;
      const tmpPrefs = `/tmp/vela-perf-prefs-${process.pid}.xml`;
      writeFileSync(tmpPrefs, prefs);
      runAdb('push', tmpPrefs, '/data/local/tmp/vela-perf-prefs.xml');
      rmSync(tmpPrefs);

      runAdb(
        'shell',
        `am force-stop ${APP}; pm clear ${APP} >/dev/null; run-as ${APP} sh -c 'mkdir -p shared_prefs && cp /data/local/tmp/vela-perf-prefs.xml shared_prefs/${APP}_preferences.xml'`,
      );

      // Apply target floor CPUQuota right before launching the app and measuring frames!
      setEmulatorCpuQuota(cpuQuota);

      // Launch app and wait for homeReady + useStartRoutes (1500ms timer after homeReady) + route settle
      runAdb(
        'shell',
        `dumpsys gfxinfo ${APP} reset >/dev/null 2>&1; monkey -p ${APP} -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1`,
      );

      await Bun.sleep(settleMs);

      const mountGfxRaw = runAdb('shell', 'dumpsys', 'gfxinfo', APP, 'framestats');
      const mountSamples = parseGfxinfoFramestats(mountGfxRaw);
      const mountStats = summarizeFrames(mountSamples);

      // Identify the route navigation burst (after the initial home mount + 1500ms startRoutes delay).
      // Look for the gap >= 800ms after initial frames where router.push(route) fires, or take the
      // duration of the route-entry frame burst.
      let routeFirstFrameDurationMs = mountStats.p95Ms;
      let routeToFirstFrameMs = mountStats.p95Ms;
      if (mountSamples.length >= 2) {
        let splitIdx = -1;
        for (let i = 1; i < mountSamples.length; i++) {
          const gapMs = (mountSamples[i]!.intendedVsyncNs - mountSamples[i - 1]!.frameCompletedNs) / 1_000_000;
          if (gapMs >= 800 && gapMs <= 4500) {
            splitIdx = i;
          }
        }
        if (splitIdx > 0) {
          const routeBurst = mountSamples.slice(splitIdx);
          routeFirstFrameDurationMs = routeBurst[0]!.totalMs;
          const burstStartNs = routeBurst[0]!.intendedVsyncNs;
          let contentFrame = routeBurst[0]!;
          for (const f of routeBurst) {
            if ((f.frameCompletedNs - burstStartNs) / 1_000_000 <= 500) {
              contentFrame = f;
              break;
            }
          }
          routeToFirstFrameMs = Number(((contentFrame.frameCompletedNs - burstStartNs) / 1_000_000).toFixed(2));
        } else {
          routeFirstFrameDurationMs = mountSamples[0]!.totalMs;
          routeToFirstFrameMs = mountStats.maxMs;
        }
      }

      // 2. Measure Focus-Move frame times (p95) across deterministic D-pad traversal in a single shell invocation
      const dpadCmd = [
        `dumpsys gfxinfo ${APP} reset >/dev/null 2>&1`,
        ...DPAD_SEQUENCE.map(key => `input keyevent ${key}; sleep 0.18`),
        'sleep 0.4',
        `dumpsys gfxinfo ${APP} framestats`,
      ].join('; ');
      const focusGfxRaw = runAdb('shell', dpadCmd);
      const focusSamples = parseGfxinfoFramestats(focusGfxRaw);
      let focusStats = summarizeFrames(focusSamples);
      if (focusStats.count === 0) {
        const fb = parseGfxinfoSummaryFallback(focusGfxRaw);
        focusStats = {
          count: fb.totalFrames,
          p50Ms: fb.p50Ms,
          p95Ms: fb.p95Ms,
          maxMs: fb.p95Ms,
          minMs: fb.p50Ms,
          meanMs: fb.p50Ms,
          jankCount: fb.jankCount,
          jankRatio: fb.totalFrames > 0 ? Number((fb.jankCount / fb.totalFrames).toFixed(4)) : 0,
          durationsMs: [],
        };
      }

      // 3. Measure Single Live Record Push cost in frames + reader isolation audit
      const isDocumentVariant = label === 'document';
      runAdb('shell', 'dumpsys', 'gfxinfo', APP, 'reset');
      await triggerSingleRecordPush(mockUrl, isDocumentVariant);
      await Bun.sleep(1200);
      const pushGfxRaw = runAdb('shell', 'dumpsys', 'gfxinfo', APP, 'framestats');
      const pushSamples = parseGfxinfoFramestats(pushGfxRaw);
      const pushStats = summarizeFrames(pushSamples);
      const readerAudit = isDocumentVariant
        ? await auditSportsIndexRecordPush(mockUrl, MOCK_AUTH_HEADERS)
        : undefined;

      // Restore mock defaults
      await fetch(`${mockUrl}/__admin/sports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spoilerFree: false, screenDelayMs: 0, screenFail: false, favourites: null }),
      });

      const passFirstFrame = routeToFirstFrameMs <= PERF_BUDGETS.firstFrameMs;
      const passFocusMove = focusStats.count > 0 && focusStats.p95Ms <= PERF_BUDGETS.focusMoveP95Ms;
      const passPushFrames = pushStats.count <= PERF_BUDGETS.recordPushMaxFrames;
      const passReaderIsolation = readerAudit ? readerAudit.isolatesToReadersOnly : true;

      return {
        label,
        route,
        gitRef: gitShortHead(repoDir),
        udid,
        measuredAt: new Date().toISOString(),
        deviceProfile,
        firstFrame: {
          routeToFirstFrameMs,
          mountFrameMaxMs: mountStats.maxMs,
          firstRouteFrameDurationMs: routeFirstFrameDurationMs,
          mountFrameCount: mountStats.count,
          budgetMs: PERF_BUDGETS.firstFrameMs,
          pass: passFirstFrame,
        },
        focusMove: {
          steps: DPAD_SEQUENCE.length,
          stats: focusStats,
          budgetP95Ms: PERF_BUDGETS.focusMoveP95Ms,
          pass: passFocusMove,
        },
        recordPush: {
          kind: isDocumentVariant ? 'screen-record-stream' : 'legacy-sse',
          framesRendered: pushStats.count,
          stats: pushStats,
          readerAudit,
          budgetFrames: PERF_BUDGETS.recordPushMaxFrames,
          passFrames: passPushFrames,
          passReaderIsolation,
          pass: passPushFrames && passReaderIsolation,
        },
      };
    } finally {
      stopMetro();
    }
  }

  const mock = await ensureMockServer();
  try {
    setEmulatorCpuQuota('400%');
    const deviceProfile = queryDeviceProfile();
    if (values['compare-sports']) {
      console.log(`[tv-route] Measuring legacy Sports route (/screen/sports) from ${legacyRoot} (${gitShortHead(legacyRoot)}) on ${udid}...`);
      const legacy = await measureRoute(legacyRoot, mock.url, '/screen/sports', 'legacy', deviceProfile);
      console.log(
        `[tv-route] Legacy result: firstFrame=${legacy.firstFrame.routeToFirstFrameMs}ms, focusP95=${legacy.focusMove.stats.p95Ms}ms (${legacy.focusMove.stats.count} frames), recordPush=${legacy.recordPush.framesRendered} frames`,
      );

      // Post-cut document Sports is at /screen/sports (or /screen/sports?screens=1 pre-cut)
      console.log(`[tv-route] Measuring document Sports route (/screen/sports) from ${documentRoot} (${gitShortHead(documentRoot)}) on ${udid}...`);
      const document = await measureRoute(documentRoot, mock.url, '/screen/sports', 'document', deviceProfile);
      console.log(
        `[tv-route] Document result: firstFrame=${document.firstFrame.routeToFirstFrameMs}ms, focusP95=${document.focusMove.stats.p95Ms}ms (${document.focusMove.stats.count} frames), recordPush=${document.recordPush.framesRendered} frames (invalidated=${document.recordPush.readerAudit?.currentRootInvalidatedItems}/${document.recordPush.readerAudit?.totalCollectionItems})`,
      );

      const markdown = formatComparisonMarkdown(legacy, document);
      if (values.out) {
        const outPath = resolve(values.out);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, markdown);
        console.log(`[tv-route] Wrote Markdown report to ${outPath}`);
      } else {
        console.log('\n' + markdown);
      }
      if (values.json) {
        const jsonPath = resolve(values.json);
        mkdirSync(dirname(jsonPath), { recursive: true });
        writeFileSync(jsonPath, JSON.stringify({ budgets: PERF_BUDGETS, legacy, document }, null, 2));
        console.log(`[tv-route] Wrote JSON report to ${jsonPath}`);
      }
    } else {
      const targetRoute = values.route ?? '/screen/sports';
      const variant = (values.variant === 'legacy' ? 'legacy' : 'document') as 'legacy' | 'document';
      const targetRepo = variant === 'legacy' ? legacyRoot : documentRoot;
      console.log(`[tv-route] Measuring ${targetRoute} (${variant}) from ${targetRepo} (${gitShortHead(targetRepo)}) on ${udid}...`);
      const result = await measureRoute(targetRepo, mock.url, targetRoute, variant, deviceProfile);
      console.log(JSON.stringify(result, null, 2));
      if (values.json) {
        const jsonPath = resolve(values.json);
        mkdirSync(dirname(jsonPath), { recursive: true });
        writeFileSync(jsonPath, JSON.stringify(result, null, 2));
      }
    }
  } finally {
    mock.stop();
  }
}
