// A Hermes sampling profile (the Chrome .cpuprofile a profileable build writes on the PERF_PROFILE
// broadcast, plugins/android-profileable.js) summarized by original source: self time, inclusive time
// by function and by file, heaviest first, optionally for a window of the profile only.
//
//   bun tools/perf/hermes-profile.ts js.cpuprofile index.android.bundle.map [--from 0] [--to 25] [--top 40]
//
// The map is the bundle's composed source map: a Gradle release build keeps it under
// app/generated/sourcemaps/react/release/, and tools/perf/repack-js.sh writes one beside the APK with --map.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/** Where a sampled frame is: Hermes's trace names bytecode (`funcVirtAddr` + `offset`, which the bundle's
 * source map addresses as line 1, that column); a Chrome .cpuprofile names a line and column. */
export interface CallFrame { functionName: string; url?: string; lineNumber: number; columnNumber: number; bytecode?: boolean }
interface ProfileNode { id: number; callFrame: CallFrame; children?: number[] }
/** Chrome's .cpuprofile. */
export interface CpuProfile { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[]; startTime: number }
/** What HermesSamplingProfiler.dumpSampledTraceToFile writes: Chrome trace events with sampled stacks. */
export interface HermesTrace {
  stackFrames: Record<string, { name: string; parent?: number | string; funcVirtAddr?: string; offset?: string; line?: string; column?: string; url?: string }>;
  samples: { ts: string | number; sf: number | string; tid?: string | number }[];
}

/** Either format as one tree: each frame's parent and call frame, and the samples (frame, µs) in time order. */
export interface Samples { frames: Map<string, { parent?: string; frame: CallFrame }>; samples: { id: string; at: number }[] }

export function samplesOf(profile: CpuProfile | HermesTrace): Samples {
  const frames: Samples['frames'] = new Map();
  if ('stackFrames' in profile) {
    for (const [id, f] of Object.entries(profile.stackFrames)) {
      const bytecode = f.funcVirtAddr !== undefined && f.offset !== undefined;
      frames.set(id, {
        ...(f.parent !== undefined ? { parent: String(f.parent) } : {}),
        frame: bytecode
          ? { functionName: f.name, lineNumber: 0, columnNumber: Number(f.funcVirtAddr) + Number(f.offset), bytecode: true }
          : { functionName: f.name, url: f.url, lineNumber: f.line !== undefined ? Number(f.line) - 1 : -1, columnNumber: Number(f.column ?? 0) },
      });
    }
    const samples = profile.samples.map(sample => ({ id: String(sample.sf), at: Number(sample.ts) })).sort((a, b) => a.at - b.at);
    return { frames, samples };
  }
  for (const node of profile.nodes) {
    frames.set(String(node.id), { ...frames.get(String(node.id)), frame: node.callFrame });
    for (const child of node.children ?? []) frames.set(String(child), { ...frames.get(String(child))!, parent: String(node.id) });
  }
  let at = profile.startTime;
  return { frames, samples: profile.samples.map((id, i) => ({ id: String(id), at: (at += profile.timeDeltas[i] ?? 0) })) };
}

export interface Summary { totalMs: number; self: [string, number][]; inclusive: [string, number][]; files: [string, number][] }

/** Self and inclusive milliseconds per label (`label(frame)`), samples between `fromS` and `toS` seconds in. */
export function summarize(profile: Samples, label: (frame: CallFrame) => string, fromS = 0, toS = Infinity): Summary {
  const labels = new Map<string, string>();
  const labelOf = (id: string) => {
    let value = labels.get(id);
    if (value === undefined) labels.set(id, value = label(profile.frames.get(id)!.frame));
    return value;
  };
  const self = new Map<string, number>(), inclusive = new Map<string, number>(), files = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, ms: number) => map.set(key, (map.get(key) ?? 0) + ms);
  const start = profile.samples[0]?.at ?? 0;
  let total = 0;
  profile.samples.forEach((sample, i) => {
    // A sample stands for the time until the next one.
    const next = profile.samples[i + 1];
    const ms = next ? (next.at - sample.at) / 1000 : 0;
    const seconds = (sample.at - start) / 1e6;
    if (seconds < fromS || seconds > toS || !profile.frames.has(sample.id)) return;
    total += ms;
    add(self, labelOf(sample.id), ms);
    const seen = new Set<string>(), seenFiles = new Set<string>();
    for (let id: string | undefined = sample.id; id !== undefined; id = profile.frames.get(id)?.parent) {
      if (!profile.frames.has(id)) break;
      const key = labelOf(id);
      if (!seen.has(key)) { seen.add(key); add(inclusive, key, ms); }
      const file = key.split(' ')[0]!.replace(/:\d+$/, '');
      if (!seenFiles.has(file)) { seenFiles.add(file); add(files, file, ms); }
    }
  });
  const sorted = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]);
  return { totalMs: total, self: sorted(self), inclusive: sorted(inclusive), files: sorted(files) };
}

/** Total milliseconds per distinct call path (root first, cut to 16 frames below the first match) through a
 * frame whose label contains `text`. */
export function heaviestStacks(profile: Samples, label: (frame: CallFrame) => string, text: string, fromS = 0, toS = Infinity): [string[], number][] {
  const totals = new Map<string, number>();
  const start = profile.samples[0]?.at ?? 0;
  profile.samples.forEach((sample, i) => {
    const next = profile.samples[i + 1];
    const seconds = (sample.at - start) / 1e6;
    if (!next || seconds < fromS || seconds > toS) return;
    const path: string[] = [];
    for (let id: string | undefined = sample.id; id !== undefined && profile.frames.has(id); id = profile.frames.get(id)?.parent) {
      path.unshift(label(profile.frames.get(id)!.frame));
    }
    const at = path.findIndex(frame => frame.includes(text));
    if (at < 0) return;
    const key = path.slice(Math.max(0, at - 8), at + 8).join('\u0000');
    totals.set(key, (totals.get(key) ?? 0) + (next.at - sample.at) / 1000);
  });
  return [...totals].sort((a, b) => b[1] - a[1]).map(([key, ms]) => [key.split('\u0000'), ms]);
}

/** A repository-relative source path: node_modules/…, packages/…, apps/…, modules/…, tools/…. */
export function shortSource(source: string): string {
  return source.replace(/^.*?((?:node_modules|packages|apps|modules|tools)\/)/, '$1');
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { from: { type: 'string' }, to: { type: 'string' }, top: { type: 'string', default: '40' }, stacks: { type: 'string' } },
    allowPositionals: true,
  });
  const [profileFile, mapFile] = positionals;
  if (!profileFile || !mapFile) throw new Error('usage: hermes-profile.ts <js.cpuprofile> <bundle.map> [--from s] [--to s] [--top n] [--stacks text]');
  const profile = samplesOf(JSON.parse(readFileSync(profileFile, 'utf8')) as CpuProfile | HermesTrace);
  // The hoisted source-map (0.5, untyped) builds its consumer at once; newer ones answer a promise.
  const { SourceMapConsumer } = await import('source-map' as string) as {
    SourceMapConsumer: new (map: unknown) => { originalPositionFor(at: { line: number; column: number }): { source: string | null; line: number | null; name: string | null }; destroy?(): void };
  };
  const consumer = await new SourceMapConsumer(JSON.parse(readFileSync(mapFile, 'utf8')));
  const label = (frame: CallFrame) => {
    if (frame.bytecode || (frame.lineNumber >= 0 && /bundle/.test(frame.url ?? ''))) {
      const at = consumer.originalPositionFor({ line: frame.lineNumber + 1, column: Math.max(0, frame.columnNumber) });
      if (at.source) return `${shortSource(at.source)}:${at.line} ${at.name ?? frame.functionName}`;
    }
    return frame.functionName || '(anonymous)';
  };
  if (values.stacks) {
    // The heaviest call paths through frames whose label contains the text (callers first).
    const stacks = heaviestStacks(profile, label, values.stacks, values.from ? Number(values.from) : 0, values.to ? Number(values.to) : Infinity);
    for (const [path, ms] of stacks.slice(0, Number(values.top))) console.log(`${ms.toFixed(0).padStart(7)} ms\n    ${path.join('\n    ')}`);
    process.exit(0);
  }
  const summary = summarize(profile, label, values.from ? Number(values.from) : 0, values.to ? Number(values.to) : Infinity);
  const top = Number(values.top);
  const rows = (list: [string, number][]) => list.slice(0, top).map(([key, ms]) => `${ms.toFixed(0).padStart(7)} ms  ${key}`).join('\n');
  console.log(`total ${summary.totalMs.toFixed(0)} ms sampled\n== self\n${rows(summary.self)}\n== inclusive (function)\n${rows(summary.inclusive)}\n== inclusive (file)\n${rows(summary.files)}`);
  consumer.destroy?.();
}
