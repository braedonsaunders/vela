/**
 * Enforced Android TV floor performance gate (`bun tools/perf/gate.ts <route>`) for built-in
 * experience documents and plugin screen routes (`docs/experiences.md`, `docs/plugin-screens.md`).
 *
 * Runs the `vela-tv-floor` measurements on `gpu-workstation` (Linux only, one emulator at a time,
 * killing only its own spawned PIDs) and exits non-zero when any budget fails:
 *   - First frame (`routeToFirstFrameMs`): <= 400 ms
 *   - Focus-move frame time (`focusMove.stats.p95Ms`): <= 16 ms
 *   - Single live record push: <= 2 frames AND reader isolation (`isolatesToReadersOnly === true`)
 *
 * Usage:
 *   bun tools/perf/gate.ts <route> [--udid emulator-5584] [--document <path>] [--json] [--out <report.json>]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ScreenDocument } from '../../packages/protocol/screen';
import type { ScreenPageState } from '../../packages/core/src/screens/types';
import { auditRecordPushIsolation, auditSportsIndexRecordPush, type RecordPushAudit } from './record-push';
import { PERF_BUDGETS, type RoutePerfResult } from './tv-route';

export interface PerfGateOptions {
  route: string;
  udid: string;
  documentPath?: string;
  mockUrl?: string;
  mockPort: string;
  metroPort: string;
  settleMs: number;
  cpuQuota: string;
  json: boolean;
  outPath?: string;
}

export interface PerfGateFailure {
  metric: 'firstFrame' | 'focusMove' | 'recordPushFrames' | 'recordPushIsolation';
  budget: string;
  actual: string;
  message: string;
}

export interface PerfGateEvaluation {
  ok: boolean;
  route: string;
  udid: string;
  budgets: typeof PERF_BUDGETS;
  result: RoutePerfResult;
  failures: PerfGateFailure[];
}

export function parseGateArgs(argv: string[]): PerfGateOptions {
  let route = '';
  let udid = 'emulator-5584';
  let documentPath: string | undefined;
  let mockUrl: string | undefined;
  let mockPort = '7849';
  let metroPort = '8149';
  let settleMs = 9000;
  let cpuQuota = process.env.VELA_TV_FLOOR_CPU_QUOTA ?? '200%';
  let json = false;
  let outPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--udid' && argv[i + 1]) { udid = argv[++i]!; continue; }
    if (arg === '--route' && argv[i + 1]) { route = argv[++i]!; continue; }
    if (arg === '--document' && argv[i + 1]) { documentPath = argv[++i]!; continue; }
    if (arg === '--mock' && argv[i + 1]) { mockUrl = argv[++i]!; continue; }
    if (arg === '--mock-port' && argv[i + 1]) { mockPort = argv[++i]!; continue; }
    if (arg === '--metro-port' && argv[i + 1]) { metroPort = argv[++i]!; continue; }
    if (arg === '--settle' && argv[i + 1]) { settleMs = Number(argv[++i]!) || 9000; continue; }
    if (arg === '--cpu-quota' && argv[i + 1]) { cpuQuota = argv[++i]!; continue; }
    if (arg === '--out' && argv[i + 1]) { outPath = argv[++i]!; continue; }
    if (arg === '--json') { json = true; continue; }
    if (!arg.startsWith('-') && !route) {
      route = arg;
      continue;
    }
  }

  if (!route) {
    throw new Error('Usage: bun tools/perf/gate.ts <route> [--udid emulator-5584] [--document <path>] [--json] [--out <file>]');
  }
  if (!route.startsWith('/')) route = `/${route}`;

  return {
    route,
    udid,
    documentPath,
    mockUrl,
    mockPort,
    metroPort,
    settleMs,
    cpuQuota,
    json,
    outPath,
  };
}

/** Resolve a built-in experience or screen route (`/listen`, `/screen/sports`, `/library/music`) to its document fixture if present. */
export function resolveRouteDocumentPath(route: string, repoRoot: string, explicitPath?: string): string | undefined {
  if (explicitPath) return resolve(repoRoot, explicitPath);
  const clean = (route.split('?')[0] ?? route).replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/').filter(Boolean);

  // `/screen/<screen>[/<page>]`
  if (parts[0] === 'screen' && parts[1]) {
    const screen = parts[1];
    const page = parts[2] ?? 'index';
    const candidate = join(repoRoot, 'packages/protocol/fixtures/screens', screen, `${page}.json`);
    if (existsSync(candidate)) return candidate;
  }

  // Built-in experience routes (`/listen`, `/listen/album`, `/library/music`, etc.)
  const expCandidates: string[] = [];
  if (parts[0]) {
    const exp = parts[0] === 'library' && parts[1] === 'music' ? 'listen' : parts[0];
    const page = parts[0] === 'library' && parts[1] === 'music' ? (parts[2] ?? 'index') : (parts[1] ?? 'index');
    expCandidates.push(
      join(repoRoot, 'packages/protocol/fixtures/experiences', exp, `${page}.json`),
      join(repoRoot, 'packages/protocol/fixtures/experiences', exp, `${page}.ts`),
      join(repoRoot, 'packages/protocol/fixtures/screens', exp, `${page}.json`),
      join(repoRoot, 'packages/skin/src/documents', exp, `${page}.json`),
      join(repoRoot, 'packages/skin/src/documents', exp, `${page}.ts`),
    );
  }
  return expCandidates.find(p => existsSync(p));
}

/** Build a synthetic or fixture-backed reader isolation audit for any ScreenDocument (built-in or plugin). */
export function auditBuiltInDocumentRecordPush(doc: ScreenDocument): RecordPushAudit {
  // Construct synthetic records & sources for any collection sources (`src.<name>.*`) in the document
  // so `auditRecordPushIsolation` can verify per-item `ScopedRecordNode` and `useScopedReads` isolation.
  const pushedKey = `record:${doc.screen}:${doc.page}:0`;
  const otherKey = `record:${doc.screen}:${doc.page}:1`;
  const records: Record<string, { rev: number; value: unknown }> = {
    [pushedKey]: {
      rev: 1,
      value: {
        id: 'item-0',
        $key: 'item-0',
        key: 'item-0',
        title: 'Item Zero',
        name: 'Item Zero',
        subtitle: 'Artist Zero',
        artist: 'Artist Zero',
        album: 'Album Zero',
        state: 'playing',
        phase: 'live',
        playing: true,
        active: true,
        duration: 210,
        position: 45,
        sides: [
          { side: 'away', id: 'a0', name: 'Away 0', short: 'A0', abbr: 'A0', score: '1' },
          { side: 'home', id: 'h0', name: 'Home 0', short: 'H0', abbr: 'H0', score: '2' },
        ],
      },
    },
    [otherKey]: {
      rev: 1,
      value: {
        id: 'item-1',
        $key: 'item-1',
        key: 'item-1',
        title: 'Item One',
        name: 'Item One',
        subtitle: 'Artist One',
        artist: 'Artist One',
        album: 'Album One',
        state: 'idle',
        phase: 'final',
        playing: false,
        active: false,
        duration: 185,
        position: 0,
        sides: [
          { side: 'away', id: 'a1', name: 'Away 1', short: 'A1', abbr: 'A1', score: '0' },
          { side: 'home', id: 'h1', name: 'Home 1', short: 'H1', abbr: 'H1', score: '3' },
        ],
      },
    },
  };

  const refPair = [{ $record: pushedKey }, { $record: otherKey }];
  const makeSourceBag = () => ({
    items: refPair,
    tracks: refPair,
    albums: refPair,
    artists: refPair,
    playlists: refPair,
    rows: refPair,
    queue: refPair,
    events: refPair,
    stories: refPair,
    channels: refPair,
    entities: refPair,
    topics: [
      { id: 'all', name: 'All' },
      { id: 'recent', name: 'Recent' },
    ],
  });

  const sources: Record<string, unknown> = {};
  for (const sName of Object.keys(doc.sources ?? {})) {
    sources[sName] = makeSourceBag();
  }
  // Also populate common built-in source names found in tree `over` paths
  const rawJson = JSON.stringify(doc.tree ?? {});
  for (const m of rawJson.matchAll(/\bsrc\.([A-Za-z0-9_]+)/g)) {
    const sName = m[1]!;
    if (!sources[sName]) sources[sName] = makeSourceBag();
  }

  const pageState: ScreenPageState = {
    href: `/vela/v0/screens/${doc.screen}/pages/${doc.page}/document`,
    key: `screen:${doc.screen}:${doc.page}`,
    params: {},
    sources,
    pending: {},
    errors: {},
    load: 'ready',
    rev: 1,
  };

  return auditRecordPushIsolation(doc, pageState, records, pushedKey);
}

/** Pure budget evaluator: checks a `RoutePerfResult` against `PERF_BUDGETS` and returns pass/fail and structured reasons. */
export function evaluatePerfGate(result: RoutePerfResult, budgets = PERF_BUDGETS): PerfGateEvaluation {
  const failures: PerfGateFailure[] = [];

  if (result.firstFrame.routeToFirstFrameMs > budgets.firstFrameMs) {
    failures.push({
      metric: 'firstFrame',
      budget: `<= ${budgets.firstFrameMs} ms`,
      actual: `${result.firstFrame.routeToFirstFrameMs.toFixed(1)} ms`,
      message: `First frame ${result.firstFrame.routeToFirstFrameMs.toFixed(1)} ms exceeded budget of ${budgets.firstFrameMs} ms`,
    });
  }

  if (result.focusMove.stats.count === 0 || result.focusMove.stats.p95Ms > budgets.focusMoveP95Ms) {
    const actual = result.focusMove.stats.count === 0
      ? '0 frames measured'
      : `${result.focusMove.stats.p95Ms.toFixed(2)} ms`;
    failures.push({
      metric: 'focusMove',
      budget: `p95 <= ${budgets.focusMoveP95Ms} ms`,
      actual,
      message: `Focus-move p95 (${actual}) exceeded budget of ${budgets.focusMoveP95Ms} ms`,
    });
  }

  if (result.recordPush.framesRendered > budgets.recordPushMaxFrames) {
    failures.push({
      metric: 'recordPushFrames',
      budget: `<= ${budgets.recordPushMaxFrames} frames`,
      actual: `${result.recordPush.framesRendered} frames`,
      message: `Single live record push rendered ${result.recordPush.framesRendered} frames, exceeding budget of ${budgets.recordPushMaxFrames} frames`,
    });
  }

  if (!result.recordPush.passReaderIsolation) {
    const audit = result.recordPush.readerAudit;
    const actual = audit
      ? `${audit.currentRootInvalidatedItems}/${audit.totalCollectionItems} invalidated (${audit.actualReaderItems} actual readers)`
      : 'unisolated';
    failures.push({
      metric: 'recordPushIsolation',
      budget: 'readers only',
      actual,
      message: `Single live record push invalidated non-reader items (${actual})`,
    });
  }

  return {
    ok: failures.length === 0,
    route: result.route,
    udid: result.udid,
    budgets,
    result,
    failures,
  };
}

export function formatGateReport(evaluation: PerfGateEvaluation): string {
  const { result, budgets, failures, ok } = evaluation;
  const audit = result.recordPush.readerAudit;
  const isolationText = audit
    ? `, readers ${audit.currentRootInvalidatedItems}/${audit.actualReaderItems} of ${audit.totalCollectionItems} items`
    : '';
  const lines = [
    `vela-tv-floor gate: ${result.route} on ${result.udid} (${result.deviceProfile.resolution}, ${result.deviceProfile.ramMb}MB, CPUQuota=${result.deviceProfile.cpuQuota})`,
    `  firstFrame:  ${result.firstFrame.routeToFirstFrameMs.toFixed(1)} ms (budget <= ${budgets.firstFrameMs} ms) [${result.firstFrame.routeToFirstFrameMs <= budgets.firstFrameMs ? 'PASS' : 'FAIL'}]`,
    `  focusMove:   p95 ${result.focusMove.stats.p95Ms.toFixed(2)} ms, p50 ${result.focusMove.stats.p50Ms.toFixed(2)} ms, max ${result.focusMove.stats.maxMs.toFixed(2)} ms (${result.focusMove.stats.count} frames, budget <= ${budgets.focusMoveP95Ms} ms) [${result.focusMove.stats.count > 0 && result.focusMove.stats.p95Ms <= budgets.focusMoveP95Ms ? 'PASS' : 'FAIL'}]`,
    `  recordPush:  ${result.recordPush.framesRendered} frames${isolationText} (budget <= ${budgets.recordPushMaxFrames} frames & readers-only) [${result.recordPush.framesRendered <= budgets.recordPushMaxFrames && result.recordPush.passReaderIsolation ? 'PASS' : 'FAIL'}]`,
  ];
  for (const f of failures) {
    lines.push(`  FAIL ${f.metric}: ${f.message}`);
  }
  lines.push(ok ? 'pass' : 'FAIL');
  return lines.join('\n');
}

/** Enforce Linux-only (`gpu-workstation`) execution for Android TV emulator runs. */
export function assertLinuxHost(platform = process.platform): void {
  if (platform !== 'linux') {
    throw new Error(
      `tools/perf/gate.ts runs only on gpu-workstation (Linux); current platform is ${platform}. Never start an Android emulator on macOS.`,
    );
  }
}

/** Single-emulator lock file so two perf gates never contend on the same emulator or start a second one. */
export function acquireGateLock(lockDir = join(homedir(), '.scratch/tmp/vela-tv-floor')): () => void {
  mkdirSync(lockDir, { recursive: true });
  const lockFile = join(lockDir, 'gate.lock');
  if (existsSync(lockFile)) {
    try {
      const existingPid = Number(readFileSync(lockFile, 'utf8').trim());
      if (existingPid && existingPid !== process.pid) {
        try {
          process.kill(existingPid, 0);
          throw new Error(`Another vela-tv-floor perf gate is already running (PID ${existingPid}, lock ${lockFile})`);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Another vela-tv-floor')) throw e;
    }
  }
  writeFileSync(lockFile, `${process.pid}\n`);
  return () => {
    try {
      if (existsSync(lockFile) && readFileSync(lockFile, 'utf8').trim() === String(process.pid)) {
        rmSync(lockFile);
      }
    } catch {}
  };
}

if (import.meta.main) {
  try {
    const opts = parseGateArgs(process.argv.slice(2));
    assertLinuxHost();
    const releaseLock = acquireGateLock();
    const root = resolve(import.meta.dir, '../..');

    try {
      const jsonTmp = join(homedir(), `.scratch/tmp/vela-tv-floor/gate-${process.pid}.json`);
      mkdirSync(dirname(jsonTmp), { recursive: true });

      const tvArgs = [
        process.execPath,
        join(import.meta.dir, 'tv-route.ts'),
        '--udid', opts.udid,
        '--route', opts.route,
        '--variant', 'document',
        '--mock-port', opts.mockPort,
        '--metro-port', opts.metroPort,
        '--settle', String(opts.settleMs),
        '--cpu-quota', opts.cpuQuota,
        '--json', jsonTmp,
        ...(opts.mockUrl ? ['--mock', opts.mockUrl] : []),
      ];

      const run = Bun.spawnSync(tvArgs, {
        cwd: root,
        stdin: 'ignore',
        stdout: opts.json ? 'pipe' : 'inherit',
        stderr: 'inherit',
        env: {
          ...process.env,
          ANDROID_ADB_SERVER_PORT: process.env.ANDROID_ADB_SERVER_PORT ?? '5041',
        },
      });

      if (run.exitCode !== 0 || !existsSync(jsonTmp)) {
        throw new Error(`tv-route measurement failed for ${opts.route} (exit ${run.exitCode})`);
      }

      const result = JSON.parse(readFileSync(jsonTmp, 'utf8')) as RoutePerfResult;
      try { rmSync(jsonTmp); } catch {}

      // If the route is a built-in experience document (e.g. `/listen`, `/library/music`) rather than
      // `/screen/sports`, run its document-specific structural record-push isolation audit as well.
      const docPath = resolveRouteDocumentPath(opts.route, root, opts.documentPath);
      if (docPath && !opts.route.startsWith('/screen/sports')) {
        const { loadDocument } = await import('../skin-check');
        const loaded = await loadDocument(docPath);
        if ((loaded as ScreenDocument).kind === 'screen') {
          const audit = auditBuiltInDocumentRecordPush(loaded as ScreenDocument);
          result.recordPush.readerAudit = audit;
          result.recordPush.passReaderIsolation = audit.isolatesToReadersOnly;
          result.recordPush.pass = result.recordPush.passFrames && result.recordPush.passReaderIsolation;
        }
      } else if (opts.route.startsWith('/screen/sports') && !result.recordPush.readerAudit && opts.mockUrl) {
        const audit = await auditSportsIndexRecordPush(opts.mockUrl);
        result.recordPush.readerAudit = audit;
        result.recordPush.passReaderIsolation = audit.isolatesToReadersOnly;
        result.recordPush.pass = result.recordPush.passFrames && result.recordPush.passReaderIsolation;
      }

      const evaluation = evaluatePerfGate(result);
      if (opts.outPath) {
        const outAbs = resolve(opts.outPath);
        mkdirSync(dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, JSON.stringify(evaluation, null, 2));
      }
      if (opts.json) {
        console.log(JSON.stringify(evaluation, null, 2));
      } else {
        console.log(formatGateReport(evaluation));
      }
      if (!evaluation.ok) {
        process.exit(1);
      }
    } finally {
      releaseLock();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
