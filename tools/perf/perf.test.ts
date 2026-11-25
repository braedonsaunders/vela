import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ScreenDocument } from '../../packages/protocol/screen';
import type { ScreenPageState } from '../../packages/core/src/screens/types';
import { parseGfxinfoFramestats, summarizeFrames } from './gfxinfo';
import { auditRecordPushIsolation } from './record-push';
import { meetsPreviewScreensGate } from './data-reads';
import {
  acquireGateLock,
  assertLinuxHost,
  auditBuiltInDocumentRecordPush,
  evaluatePerfGate,
  formatGateReport,
  parseGateArgs,
  resolveRouteDocumentPath,
} from './gate';
import type { RoutePerfResult } from './tv-route';

describe('tools/perf/gfxinfo', () => {
  test('parses 14-column PROFILEDATA CSV blocks and computes p50, p95, max, and jank counts', () => {
    const sampleOutput = `
Applications Graphics Acceleration Info:
Uptime: 123456 Realtime: 123456

** Graphics info for pid 4321 [app.ether.vela] **

Total frames rendered: 5
Janky frames: 1 (20.00%)
50th percentile: 9ms
90th percentile: 18ms
95th percentile: 22ms
99th percentile: 22ms

---PROFILEDATA---
Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionCompleted
0,1000000000,1000100000,0,0,1000200000,1000300000,1000400000,1002000000,1004000000,1004200000,1005000000,1007000000,1008500000,0,0,1008000000,1008500000,0,0
0,1016666667,1016700000,0,0,1016800000,1016900000,1017000000,1019000000,1022000000,1022100000,1023000000,1025000000,1026000000,0,0,1025500000,1026000000,0,0
0,1033333333,1033400000,0,0,1033500000,1033600000,1033700000,1036000000,1040000000,1040200000,1042000000,1044000000,1045500000,0,0,1045000000,1045500000,0,0
0,1050000000,1050100000,0,0,1050200000,1050300000,1050400000,1053000000,1056000000,1056200000,1058000000,1060000000,1061000000,0,0,1060500000,1061000000,0,0
0,1066666667,1067000000,0,0,1067100000,1067200000,1067300000,1075000000,1082000000,1082200000,1085000000,1088000000,1089500000,0,0,1089000000,1089500000,0,0
---PROFILEDATA---
`;
    const frames = parseGfxinfoFramestats(sampleOutput);
    expect(frames.length).toBe(5);
    expect(frames[0]!.totalMs).toBe(8.5);
    expect(frames[4]!.totalMs).toBe(22.83);

    const summary = summarizeFrames(frames);
    expect(summary.count).toBe(5);
    expect(summary.p50Ms).toBe(11);
    expect(summary.p95Ms).toBe(22.83);
    expect(summary.jankCount).toBe(1);
  });

  test('parses 24-column Android TV API 36 FrameTimelineVsyncId PROFILEDATA CSV blocks', () => {
    const api36Output = `
---PROFILEDATA---
Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,FrameDeadline,FrameStartTime,FrameInterval,WorkloadTarget,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionCompleted,
0,223767,1261433162848,1261433162848,0,1261433370701,1261433371152,1261435103470,1261435238537,1261449829514,1261433369749,16666666,16666666,1261435885705,1261436005902,1261436183389,1261441209178,1261538641633,5580,451477,1261538526013,1261538641633,0,1261441209178,
0,224832,1264583162722,1264583162722,0,1264583411300,1264583411650,1264612153088,1264612329432,1264599829388,1264583410077,16666666,16666666,1264612825724,1264612910473,1264612986267,1264613863192,1264631986975,2705,315639,1264631886685,1264631986975,0,1264613863192,
---PROFILEDATA---
`;
    const frames = parseGfxinfoFramestats(api36Output);
    expect(frames.length).toBe(2);
    expect(frames[0]!.totalMs).toBe(105.48);
    expect(frames[1]!.totalMs).toBe(48.82);
  });
});

describe('tools/perf/data-reads version gate', () => {
  test('enforces preview.32-screens or newer before running against lab', () => {
    expect(meetsPreviewScreensGate('0.3.21-preview.31-screens')).toBe(false);
    expect(meetsPreviewScreensGate('0.3.21-preview.32-screens')).toBe(true);
    expect(meetsPreviewScreensGate('0.3.21-preview.33-screens')).toBe(true);
    expect(meetsPreviewScreensGate('0.3.22')).toBe(true);
    expect(meetsPreviewScreensGate('0.3.20-preview.40-screens')).toBe(false);
  });
});

describe('tools/perf/record-push reader isolation audit', () => {
  test('quantifies actual readers vs root-reader invalidation on Sports index document', () => {
    const root = resolve(import.meta.dir, '../..');
    const rawDoc = JSON.parse(
      readFileSync(join(root, 'packages/protocol/fixtures/screens/sports/index.json'), 'utf8'),
    ) as ScreenDocument;
    const doc: ScreenDocument = { ...rawDoc, screen: 'sports', page: 'index', presentation: 'section' };

    const records = {
      'event:sports:sports:nfl-nyg-phi': {
        rev: 1,
        value: {
          id: 'sports:sports:nfl-nyg-phi',
          kind: 'pair',
          state: 'in',
          phase: 'live',
          detail: 'Q4 · 04:12',
          league: { id: 'nfl', name: 'NFL', abbr: 'NFL', label: 'NFL' },
          sides: [
            { side: 'away', id: 'nfl-nyg', name: 'New York Giants', short: 'Giants', abbr: 'NYG', score: '21' },
            { side: 'home', id: 'nfl-phi', name: 'Philadelphia Eagles', short: 'Eagles', abbr: 'PHI', score: '24' },
          ],
          targets: [{ kind: 'channel', id: 'ch-1', name: 'FOX' }],
        },
      },
      'event:sports:sports:nhl-tor-mtl': {
        rev: 1,
        value: {
          id: 'sports:sports:nhl-tor-mtl',
          kind: 'pair',
          state: 'in',
          phase: 'live',
          detail: '2nd · 11:05',
          league: { id: 'nhl', name: 'NHL', abbr: 'NHL', label: 'NHL' },
          sides: [
            { side: 'away', id: 'nhl-mtl', name: 'Montréal Canadiens', short: 'Canadiens', abbr: 'MTL', score: '2' },
            { side: 'home', id: 'nhl-tor', name: 'Toronto Maple Leafs', short: 'Maple Leafs', abbr: 'TOR', score: '3' },
          ],
          targets: [{ kind: 'channel', id: 'ch-2', name: 'CBC' }],
        },
      },
      'entity:sports:sports:team:nfl-phi': {
        rev: 1,
        value: {
          id: 'nfl-phi',
          kind: 'team',
          name: 'Philadelphia Eagles',
          abbr: 'PHI',
          league: 'nfl',
          key: 'sports:sports:team:nfl-phi',
          favorite: true,
        },
      },
      'entity:sports:sports:team:nhl-tor': {
        rev: 1,
        value: {
          id: 'nhl-tor',
          kind: 'team',
          name: 'Toronto Maple Leafs',
          abbr: 'TOR',
          league: 'nhl',
          key: 'sports:sports:team:nhl-tor',
          favorite: true,
        },
      },
    };

    const pageState: ScreenPageState = {
      href: '/vela/v0/screens/sports/pages/index/document',
      key: 'screen:sports:index',
      params: {},
      sources: {
        hero: {
          events: [{ $record: 'event:sports:sports:nfl-nyg-phi' }, { $record: 'event:sports:sports:nhl-tor-mtl' }],
        },
        live: {
          events: [{ $record: 'event:sports:sports:nfl-nyg-phi' }, { $record: 'event:sports:sports:nhl-tor-mtl' }],
        },
        yourTeams: {
          events: [{ $record: 'event:sports:sports:nfl-nyg-phi' }],
        },
        teams: {
          entities: [
            { $record: 'entity:sports:sports:team:nfl-phi' },
            { $record: 'entity:sports:sports:team:nhl-tor' },
          ],
        },
      },
      pending: {},
      errors: {},
      load: 'ready',
      rev: 1,
    };

    const audit = auditRecordPushIsolation(doc, pageState, records, 'event:sports:sports:nfl-nyg-phi');
    expect(audit.totalCollectionItems).toBeGreaterThan(audit.actualReaderItems);
    expect(audit.actualReaderItems).toBeGreaterThan(0);
    expect(audit.isolatedPerItemInvalidatedItems).toBe(audit.actualReaderItems);
    expect(audit.rootReadsTotalRecords).toBe(0);
    expect(audit.currentRootInvalidatedItems).toBe(audit.actualReaderItems);
    expect(audit.isolatesToReadersOnly).toBe(true);
  });
});

test('a gated visualizer with no presentation evidence cannot pass the TV budget', async () => {
  const { visualizerPerf } = await import('./visualizer');
  const result = visualizerPerf('', '', '');
  expect(result).toMatchObject({ measured: false, pass: false, focusP95Ms: null, uiMaxMs: null });
});

describe('tools/perf/gate.ts', () => {
  const makeResult = (overrides: Partial<RoutePerfResult> = {}): RoutePerfResult => ({
    label: 'document',
    route: '/listen',
    gitRef: 'b6192802',
    udid: 'emulator-5584',
    measuredAt: '2026-11-25T19:00:00Z',
    deviceProfile: {
      resolution: '1920x1080',
      density: '320 dpi',
      ramMb: 2048,
      cores: 4,
      cpuQuota: '100%',
    },
    firstFrame: {
      routeToFirstFrameMs: 142.4,
      mountFrameMaxMs: 48.2,
      firstRouteFrameDurationMs: 28.1,
      mountFrameCount: 9,
      budgetMs: 400,
      pass: true,
    },
    focusMove: {
      steps: 16,
      stats: {
        count: 32,
        p50Ms: 6.4,
        p95Ms: 11.8,
        maxMs: 14.2,
        minMs: 4.1,
        meanMs: 7.0,
        jankCount: 0,
        jankRatio: 0,
        durationsMs: [6.4, 11.8],
      },
      budgetP95Ms: 16,
      pass: true,
    },
    recordPush: {
      kind: 'screen-record-stream',
      framesRendered: 1,
      stats: {
        count: 1,
        p50Ms: 5.5,
        p95Ms: 5.5,
        maxMs: 5.5,
        minMs: 5.5,
        meanMs: 5.5,
        jankCount: 0,
        jankRatio: 0,
        durationsMs: [5.5],
      },
      readerAudit: {
        pushedRecordKey: 'record:listen:index:0',
        totalCollectionItems: 24,
        actualReaderItems: 2,
        currentRootInvalidatedItems: 2,
        isolatedPerItemInvalidatedItems: 2,
        rootReadsTotalRecords: 0,
        isolatesToReadersOnly: true,
        rootCause: 'isolated',
      },
      budgetFrames: 2,
      passFrames: true,
      passReaderIsolation: true,
      pass: true,
    },
    ...overrides,
  });

  test('parseGateArgs parses route and flags', () => {
    const parsed = parseGateArgs(['/listen', '--udid', 'emulator-5584', '--json', '--cpu-quota', '100%']);
    expect(parsed.route).toBe('/listen');
    expect(parsed.udid).toBe('emulator-5584');
    expect(parsed.json).toBe(true);
    expect(parsed.cpuQuota).toBe('100%');

    const normalized = parseGateArgs(['screen/sports']);
    expect(normalized.route).toBe('/screen/sports');
  });

  test('evaluatePerfGate passes when all three budgets hold and fails with structured reasons when exceeded', () => {
    const passing = evaluatePerfGate(makeResult());
    expect(passing.ok).toBe(true);
    expect(passing.failures).toEqual([]);
    expect(formatGateReport(passing)).toContain('pass');

    const failing = evaluatePerfGate(
      makeResult({
        firstFrame: {
          routeToFirstFrameMs: 485.0,
          mountFrameMaxMs: 485.0,
          firstRouteFrameDurationMs: 120.0,
          mountFrameCount: 12,
          budgetMs: 400,
          pass: false,
        },
        focusMove: {
          steps: 16,
          stats: {
            count: 20,
            p50Ms: 10.0,
            p95Ms: 21.4,
            maxMs: 28.0,
            minMs: 6.0,
            meanMs: 12.0,
            jankCount: 3,
            jankRatio: 0.15,
            durationsMs: [],
          },
          budgetP95Ms: 16,
          pass: false,
        },
        recordPush: {
          kind: 'screen-record-stream',
          framesRendered: 5,
          stats: {
            count: 5,
            p50Ms: 9.0,
            p95Ms: 14.0,
            maxMs: 14.0,
            minMs: 7.0,
            meanMs: 9.5,
            jankCount: 0,
            jankRatio: 0,
            durationsMs: [],
          },
          budgetFrames: 2,
          passFrames: false,
          passReaderIsolation: false,
          pass: false,
        },
      }),
    );
    expect(failing.ok).toBe(false);
    expect(failing.failures.map(f => f.metric)).toEqual([
      'firstFrame',
      'focusMove',
      'recordPushFrames',
      'recordPushIsolation',
    ]);
    expect(formatGateReport(failing)).toContain('FAIL');
  });

  test('assertLinuxHost refuses macOS and allows linux', () => {
    expect(() => assertLinuxHost('darwin')).toThrow(/gpu-workstation \(Linux\)/);
    expect(() => assertLinuxHost('linux')).not.toThrow();
  });

  test('acquireGateLock prevents concurrent runs and cleans up on release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vela-gate-lock-'));
    try {
      const release = acquireGateLock(dir);
      // Same PID can re-acquire
      const release2 = acquireGateLock(dir);
      release2();
      release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolveRouteDocumentPath and auditBuiltInDocumentRecordPush work on built-in / screen documents', () => {
    const root = resolve(import.meta.dir, '../..');
    const resolvedPath = resolveRouteDocumentPath('/screen/news', root);
    expect(resolvedPath).toEndWith('packages/protocol/fixtures/screens/news/index.json');
    const doc = JSON.parse(readFileSync(resolvedPath!, 'utf8')) as ScreenDocument;
    const audit = auditBuiltInDocumentRecordPush(doc);
    expect(audit.isolatesToReadersOnly).toBe(true);
    expect(audit.actualReaderItems).toBeGreaterThan(0);
  });
});
