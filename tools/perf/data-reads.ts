// Bounded, opt-in load regression for parallel plugin-screen data reads (Ether 05f7bb159).
//
// Signs in once, resolves the page's document (so every declared source — eager and lazy — is
// requested in each read), opens up to 4 live stream topics on /live/stream, and fires N
// concurrent GET /vela/v0/screens/{screen}/pages/{page}/data?sources=<all> reads (N <= 8).
// Stops at the first HTTP/source error or server drop and reports latency p50, p95, errors,
// and whether the server stayed up.
//
//   bun tools/perf/data-reads.ts --server http://127.0.0.1:7845 --mock
//   bun tools/perf/data-reads.ts --lab --n 4,8
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type * as V from '../../packages/protocol/types';

export const MAX_CONCURRENCY = 8;
export const MAX_STREAM_TOPICS = 4;
const RENDERER_VERSION = 19;
const DEFAULT_LAB_ENV = join(homedir(), '.scratch/tmp/thr_9jsg8ia37s/vela-lab.env');
const DEFAULT_LAB_TOKEN = join(homedir(), '.scratch/tmp/thr_9jsg8ia37s/lab-owner-token');

export interface DataReadSample {
  index: number;
  ok: boolean;
  status: number;
  ms: number;
  sourcesCount: number;
  recordsCount: number;
  sourceErrors: string[];
  topic?: string;
  error?: string;
}

export interface DataReadsWaveReport {
  concurrency: number;
  sources: string[];
  streamTopics: number;
  streamConnected: boolean;
  streamFrames: number;
  streamError?: string;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  okCount: number;
  errorCount: number;
  errors: string[];
  serverUpAfter: boolean;
  samples: DataReadSample[];
}

export interface DataReadsReport {
  server: string;
  serverVersion?: string;
  etherCurrent?: string;
  screen: string;
  page: string;
  startedAt: string;
  waves: DataReadsWaveReport[];
  ok: boolean;
}

/** Nearest-rank percentile on a non-empty list of numbers. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[rank]! * 100) / 100;
}

/** Parse `preview.<N>-screens` (or newer) from Ether's `/ether/api/updates/` `current` string. */
export function meetsPreviewScreensGate(current: string | undefined, minPreview = 32): boolean {
  if (!current) return false;
  const match = /^0\.3\.(\d+)(?:-preview\.(\d+)(?:-screens)?)?/.exec(current.trim());
  if (!match) return false;
  const patch = Number(match[1]);
  const preview = match[2] !== undefined ? Number(match[2]) : Number.POSITIVE_INFINITY;
  if (patch > 21) return true;
  if (patch < 21) return false;
  return preview >= minPreview;
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) throw new Error(`Credentials file not found: ${path}`);
  const text = readFileSync(path, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z0-9_]+)=(.*)$/.exec(trimmed);
    if (!match) continue;
    out[match[1]!] = match[2]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

async function readEtherCurrent(origin: string, ownerTokenPath = DEFAULT_LAB_TOKEN): Promise<string | undefined> {
  if (!existsSync(ownerTokenPath)) return undefined;
  const token = readFileSync(ownerTokenPath, 'utf8').trim();
  if (!token) return undefined;
  const res = await fetch(`${origin}/ether/api/updates/`, {
    headers: { Accept: 'application/json', 'X-Plex-Token': token, 'X-Ether-Request': '1' },
  }).catch(() => null);
  if (!res || !res.ok) return undefined;
  const body = (await res.json().catch(() => null)) as { current?: string } | null;
  return typeof body?.current === 'string' ? body.current : undefined;
}

async function serverUp(origin: string): Promise<{ up: boolean; version?: string }> {
  try {
    const res = await fetch(`${origin}/vela/v0/capabilities`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { up: false };
    const caps = (await res.json()) as V.ServerCapabilities;
    return { up: true, version: caps.server?.version };
  } catch {
    return { up: false };
  }
}

export interface RunDataReadsOptions {
  origin: string;
  username: string;
  password: string;
  screen: string;
  page: string;
  waves: number[];
  tz: string;
  etherCurrent?: string;
}

export async function runDataReads(options: RunDataReadsOptions): Promise<DataReadsReport> {
  const origin = options.origin.replace(/\/+$/, '');
  for (const n of options.waves) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_CONCURRENCY) {
      throw new Error(`Concurrency N must be an integer in 1..${MAX_CONCURRENCY} (got ${n})`);
    }
  }

  const health0 = await serverUp(origin);
  if (!health0.up) throw new Error(`Server at ${origin} is not reachable before test`);

  const deviceId = `vela-perf-data-reads-${process.pid}`;
  const signInRes = await fetch(`${origin}/vela/v0/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: options.username,
      password: options.password,
      idempotencyKey: crypto.randomUUID(),
      device: { id: deviceId, name: 'Vela Perf Harness', platform: 'web', appVersion: '0.2.56' },
    }),
  });
  if (!signInRes.ok) throw new Error(`Sign-in failed with HTTP ${signInRes.status}`);
  const tokens = (await signInRes.json()) as V.Tokens;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.accessToken}`,
    'X-Vela-Device-Id': deviceId,
    'X-Vela-Screen-Renderer': String(RENDERER_VERSION),
    'X-Vela-Language': 'en',
  };

  // 1. Read the page document so we know all declared sources (including lazy ones).
  const docRes = await fetch(`${origin}/vela/v0/screens/${encodeURIComponent(options.screen)}/pages/${encodeURIComponent(options.page)}/document`, { headers });
  if (!docRes.ok) throw new Error(`Document read failed with HTTP ${docRes.status}`);
  const doc = (await docRes.json()) as V.ScreenDocument;
  const allSources = Object.keys(doc.sources ?? {});
  if (!allSources.length) throw new Error(`Document ${options.screen}/${options.page} declares no sources`);

  // 2. Seed up to 4 distinct stream topics (by varying params or pages) so the live stream holds 4 topics.
  const topicVariants: Record<string, string>[] = [
    {},
    ...(doc.params?.league ? [{ 'p.league': 'nfl' }, { 'p.league': 'nba' }, { 'p.league': 'nhl' }] : []),
  ];
  const topics: string[] = [];
  for (const variant of topicVariants) {
    if (topics.length >= MAX_STREAM_TOPICS) break;
    const params = new URLSearchParams({ sources: allSources.join(','), tz: options.tz, ...variant });
    const seedRes = await fetch(`${origin}/vela/v0/screens/${encodeURIComponent(options.screen)}/pages/${encodeURIComponent(options.page)}/data?${params}`, { headers });
    if (!seedRes.ok) throw new Error(`Topic seed read failed with HTTP ${seedRes.status}`);
    const seedData = (await seedRes.json()) as V.ScreenData;
    if (seedData.live?.topic && !topics.includes(seedData.live.topic)) topics.push(seedData.live.topic);
  }
  while (topics.length < MAX_STREAM_TOPICS && topics[0]) topics.push(topics[0]);

  const waveReports: DataReadsWaveReport[] = [];
  let allOk = true;

  for (const concurrency of options.waves) {
    // Open /live/stream with 4 topics while the N parallel data reads fire.
    const streamAbort = new AbortController();
    const streamParams = new URLSearchParams();
    for (const topic of topics.slice(0, MAX_STREAM_TOPICS)) streamParams.append('topic', topic);
    streamParams.set('tz', options.tz);
    streamParams.set('alerts', '1');

    let streamConnected = false;
    let streamFrames = 0;
    let streamError: string | undefined;

    const streamTask = (async () => {
      try {
        const res = await fetch(`${origin}/vela/v0/live/stream?${streamParams}`, {
          headers: { ...headers, Accept: 'text/event-stream' },
          signal: streamAbort.signal,
        });
        if (!res.ok) {
          streamError = `HTTP ${res.status}`;
          return;
        }
        streamConnected = true;
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        while (!streamAbort.signal.aborted) {
          const next = await reader.read();
          if (next.done) break;
          const chunk = decoder.decode(next.value, { stream: true });
          streamFrames += chunk.split('\n\n').filter(Boolean).length;
        }
      } catch (error) {
        if (!streamAbort.signal.aborted) streamError = String((error as Error).message ?? error);
      }
    })();

    // Give the stream a moment to establish before firing the N parallel reads.
    await Bun.sleep(150);

    const dataPath = `${origin}/vela/v0/screens/${encodeURIComponent(options.screen)}/pages/${encodeURIComponent(options.page)}/data`;
    const samples = await Promise.all(
      Array.from({ length: concurrency }, async (_, index): Promise<DataReadSample> => {
        const params = new URLSearchParams({ sources: allSources.join(','), tz: options.tz });
        const t0 = performance.now();
        try {
          const res = await fetch(`${dataPath}?${params}`, { headers });
          const ms = Math.round((performance.now() - t0) * 100) / 100;
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            return { index, ok: false, status: res.status, ms, sourcesCount: 0, recordsCount: 0, sourceErrors: [], error: `HTTP ${res.status}: ${text.slice(0, 160)}` };
          }
          const body = (await res.json()) as V.ScreenData;
          const sourceErrors = Object.entries(body.errors ?? {}).map(([k, v]) => `${k}:${v.code}`);
          return {
            index,
            ok: sourceErrors.length === 0,
            status: res.status,
            ms,
            sourcesCount: Object.keys(body.sources ?? {}).length,
            recordsCount: Object.keys(body.records ?? {}).length,
            sourceErrors,
            topic: body.live?.topic,
            ...(sourceErrors.length ? { error: `source errors: ${sourceErrors.join(', ')}` } : {}),
          };
        } catch (error) {
          const ms = Math.round((performance.now() - t0) * 100) / 100;
          return { index, ok: false, status: 0, ms, sourcesCount: 0, recordsCount: 0, sourceErrors: [], error: String((error as Error).message ?? error) };
        }
      }),
    );

    streamAbort.abort();
    await streamTask;

    const afterHealth = await serverUp(origin);
    const latencies = samples.map(s => s.ms);
    const errors = samples.flatMap(s => (s.error ? [`#${s.index}: ${s.error}`] : []));
    if (streamError) errors.push(`stream: ${streamError}`);
    if (!afterHealth.up) errors.push('server unreachable after wave');

    const waveReport: DataReadsWaveReport = {
      concurrency,
      sources: allSources,
      streamTopics: topics.slice(0, MAX_STREAM_TOPICS).length,
      streamConnected,
      streamFrames,
      ...(streamError ? { streamError } : {}),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      minMs: latencies.length ? Math.min(...latencies) : 0,
      maxMs: latencies.length ? Math.max(...latencies) : 0,
      okCount: samples.filter(s => s.ok).length,
      errorCount: errors.length,
      errors,
      serverUpAfter: afterHealth.up,
      samples,
    };
    waveReports.push(waveReport);

    // Stop at the first error as required.
    if (waveReport.errorCount > 0 || !waveReport.serverUpAfter) {
      allOk = false;
      break;
    }
  }

  return {
    server: origin,
    ...(health0.version ? { serverVersion: health0.version } : {}),
    ...(options.etherCurrent ? { etherCurrent: options.etherCurrent } : {}),
    screen: options.screen,
    page: options.page,
    startedAt: new Date().toISOString(),
    waves: waveReports,
    ok: allOk,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      server: { type: 'string' },
      lab: { type: 'boolean', default: false },
      mock: { type: 'boolean', default: false },
      'lab-env': { type: 'string', default: DEFAULT_LAB_ENV },
      'lab-token': { type: 'string', default: DEFAULT_LAB_TOKEN },
      screen: { type: 'string', default: 'sports' },
      page: { type: 'string', default: 'index' },
      n: { type: 'string', default: '4,8' },
      tz: { type: 'string', default: 'America/New_York' },
      json: { type: 'boolean', default: false },
    },
  });

  if (!values.lab && !values.mock && !values.server) {
    throw new Error('Opt-in required: pass --mock [--server http://127.0.0.1:7845] or --lab');
  }

  const waves = values.n!.split(',').map(s => Number(s.trim())).filter(Boolean);
  let origin = values.server ?? (values.lab ? 'http://127.0.0.1:32550' : 'http://127.0.0.1:7777');
  let username = 'demo';
  let password = 'vela';
  let etherCurrent: string | undefined;

  if (values.lab) {
    etherCurrent = await readEtherCurrent(origin, values['lab-token']);
    if (!meetsPreviewScreensGate(etherCurrent, 32)) {
      console.error(`Refusing to run against lab: Ether current version is ${JSON.stringify(etherCurrent ?? 'unknown')}, need 0.3.21-preview.32-screens or newer.`);
      process.exit(2);
    }
    const env = readEnvFile(values['lab-env']!);
    if (!env.LAB_USER || !env.LAB_PASSWORD) throw new Error('LAB_USER and LAB_PASSWORD must be set in lab-env file');
    username = env.LAB_USER;
    password = env.LAB_PASSWORD;
  }

  const report = await runDataReads({
    origin,
    username,
    password,
    screen: values.screen!,
    page: values.page!,
    waves,
    tz: values.tz!,
    etherCurrent,
  });

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Server: ${report.server}${report.etherCurrent ? ` (${report.etherCurrent})` : report.serverVersion ? ` (${report.serverVersion})` : ''}`);
    console.log(`Target: /vela/v0/screens/${report.screen}/pages/${report.page}/data`);
    for (const wave of report.waves) {
      console.log(
        `N=${wave.concurrency} (sources=${wave.sources.length}, streamTopics=${wave.streamTopics}, streamConnected=${wave.streamConnected}): ` +
        `p50=${wave.p50Ms} ms, p95=${wave.p95Ms} ms (min=${wave.minMs} ms, max=${wave.maxMs} ms), ` +
        `ok=${wave.okCount}/${wave.concurrency}, errors=${wave.errorCount}, serverUp=${wave.serverUpAfter}`,
      );
      for (const err of wave.errors) console.log(`  error: ${err}`);
    }
  }
  if (!report.ok) process.exit(1);
}
