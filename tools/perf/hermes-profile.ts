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
import { SourceMapConsumer } from 'source-map';

interface CallFrame { functionName: string; url?: string; lineNumber: number; columnNumber: number }
interface ProfileNode { id: number; callFrame: CallFrame; children?: number[] }
export interface CpuProfile { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[]; startTime: number }

export interface Summary { totalMs: number; self: [string, number][]; inclusive: [string, number][]; files: [string, number][] }

/** Self and inclusive milliseconds per label (`label(node)`), samples between `fromS` and `toS` seconds in. */
export function summarize(profile: CpuProfile, label: (frame: CallFrame) => string, fromS = 0, toS = Infinity): Summary {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const labels = new Map<number, string>();
  const labelOf = (id: number) => {
    let value = labels.get(id);
    if (value === undefined) labels.set(id, value = label(nodes.get(id)!.callFrame));
    return value;
  };
  const self = new Map<string, number>(), inclusive = new Map<string, number>(), files = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, ms: number) => map.set(key, (map.get(key) ?? 0) + ms);
  let at = 0, total = 0;
  profile.samples.forEach((id, i) => {
    at += profile.timeDeltas[i] ?? 0;
    // A sample stands for the time until the next one.
    const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    if (at / 1e6 < fromS || at / 1e6 > toS || !nodes.has(id)) return;
    total += ms;
    add(self, labelOf(id), ms);
    const seen = new Set<string>(), seenFiles = new Set<string>();
    for (let node: number | undefined = id; node !== undefined; node = parent.get(node)) {
      const key = labelOf(node);
      if (!seen.has(key)) { seen.add(key); add(inclusive, key, ms); }
      const file = key.split(' ')[0]!.replace(/:\d+$/, '');
      if (!seenFiles.has(file)) { seenFiles.add(file); add(files, file, ms); }
    }
  });
  const sorted = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]);
  return { totalMs: total, self: sorted(self), inclusive: sorted(inclusive), files: sorted(files) };
}

/** A repository-relative source path: node_modules/…, packages/…, apps/…, modules/…, tools/…. */
export function shortSource(source: string): string {
  return source.replace(/^.*?((?:node_modules|packages|apps|modules|tools)\/)/, '$1');
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { from: { type: 'string' }, to: { type: 'string' }, top: { type: 'string', default: '40' } },
    allowPositionals: true,
  });
  const [profileFile, mapFile] = positionals;
  if (!profileFile || !mapFile) throw new Error('usage: hermes-profile.ts <js.cpuprofile> <bundle.map> [--from s] [--to s] [--top n]');
  const profile = JSON.parse(readFileSync(profileFile, 'utf8')) as CpuProfile;
  const consumer = await new SourceMapConsumer(JSON.parse(readFileSync(mapFile, 'utf8')));
  const label = (frame: CallFrame) => {
    if (frame.lineNumber >= 0 && /bundle/.test(frame.url ?? '')) {
      const at = consumer.originalPositionFor({ line: frame.lineNumber + 1, column: Math.max(0, frame.columnNumber) });
      if (at.source) return `${shortSource(at.source)}:${at.line} ${at.name ?? frame.functionName}`;
    }
    return frame.functionName || '(anonymous)';
  };
  const summary = summarize(profile, label, values.from ? Number(values.from) : 0, values.to ? Number(values.to) : Infinity);
  const top = Number(values.top);
  const rows = (list: [string, number][]) => list.slice(0, top).map(([key, ms]) => `${ms.toFixed(0).padStart(7)} ms  ${key}`).join('\n');
  console.log(`total ${summary.totalMs.toFixed(0)} ms sampled\n== self\n${rows(summary.self)}\n== inclusive (function)\n${rows(summary.inclusive)}\n== inclusive (file)\n${rows(summary.files)}`);
  consumer.destroy();
}
