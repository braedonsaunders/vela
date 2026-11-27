// Per-press analysis of an Android TV Perfetto trace (tools/perf/tv-nav.ts). Pure: the runner extracts
// events with trace_processor and the commit probe's logcat lines, this turns them into numbers.
//
// A press starts at its key-down delivery to the app's main thread (ImeInputStage) and runs until the
// next press (or the step's own window). For each one:
//   focusMs   key-down → the native focus change reaching JS (Fabric topFocus event)
//   mountMs   key-down → the end of the first Fabric mount after it (JS answered and was applied)
//   frameMs   key-down → the end of the first RenderThread frame begun after that mount
//   settleMs  key-down → the end of the first frame after the press's last mount that is followed by
//             `quietMs` without a mount (screens fill in over several commits)
//   contentMs key-down → the end of the first frame after the mount that follows the press's
//             CONTENT_VIEWSth native view created (preallocated or mounted): when a screen the press
//             opened first shows its content
//   jsMs / mainMs / renderMs   CPU time on the JS thread, the UI thread and RenderThread
//   mounts, frames, commits, comps   Fabric mounts, frames drawn, React commits and components the
//             probe saw render (probe builds only)

export interface Span { ts: number; dur: number }
export interface TraceEvents {
  /** ImeInputStage slices on the main thread: two per press (down, up). */
  keys: Span[];
  focus: Span[];
  mounts: Span[];
  frames: Span[];
  /** Native views Fabric created (SurfaceMountingManager::createViewUnsafe). */
  views?: Span[];
  sched: { js: Span[]; main: Span[]; render: Span[] };
  /** The trace clock (BOOTTIME) minus CLOCK_MONOTONIC, which logcat's `-v monotonic` uses. They
   * differ by the time a device spent suspended: a TV box that has been in standby. */
  monotonicOffset?: number;
}

/** Views created after a press for it to be a screen's content arriving, not a focus look. */
export const CONTENT_VIEWS = 50;
export interface ProbeCommit { ts: number; comps: number; hosts: number; top: string; upd?: string; src?: string }
/** One 200 ms window of the probe's JS-time attribution: source → [count, ms]. */
export interface ProbeJs { ts: number; sources: Record<string, [number, number]> }

export interface PressMetrics {
  label: string;
  focusMs: number | null;
  mountMs: number | null;
  frameMs: number | null;
  settleMs: number | null;
  contentMs: number | null;
  jsMs: number;
  mainMs: number;
  renderMs: number;
  mounts: number;
  frames: number;
  /** Frames over the 60 Hz budget (16.7 ms from intended vsync to completion); light mode only. */
  jank?: number;
  /** The slowest frame's duration, ms; light mode only. */
  worstMs?: number;
  /** How long the press's CPU was counted for (light mode: from before `input keyevent` to the next press),
   * so a press's JS can be told from the screen's own JS per second over the same stretch. */
  windowMs?: number;
  /** Light mode with a probe build: the key's handling (its logcat mark) to the first React commit after it, the
   * JS answer to the press when the press is what drew (its `top`/`src` say). */
  commitMs?: number | null;
  commits: number;
  comps: number;
  top: string;
  /** Where the JS thread's time went (probe builds): source:count:ms, heaviest first. */
  jsTop: string;
  /** Host components updated (+ mounted) across the press's commits (probe builds), most first. */
  updated: string;
  /** Components where the press's re-renders started (probe builds), most first. */
  sources: string;
}

const MS = 1e6;

/** Key-down timestamps: key slices closer than `gapMs` to the previous one belong to the same press
 * (its key-up, or a held key's repeats). */
export function pressStarts(keys: Span[], gapMs = 250): number[] {
  const sorted = [...keys].sort((a, b) => a.ts - b.ts);
  const starts: number[] = [];
  let last = -Infinity;
  for (const key of sorted) {
    if (key.ts - last > gapMs * MS) starts.push(key.ts);
    last = key.ts;
  }
  return starts;
}

/** The device script's press markers (`logcat -v monotonic`), in order: one per press. */
export function parseMarks(logcat: string, tag: string): number[] {
  const marks: number[] = [];
  for (const line of logcat.split('\n')) {
    const match = new RegExp(`^\\s*(\\d+)\\.(\\d+)\\s.*\\s${tag}\\s*:`).exec(line);
    if (match) marks.push(Number(match[1]) * 1e9 + Number(match[2].padEnd(9, '0').slice(0, 9)));
  }
  return marks;
}

/** Each press starts at its key-down: the first after its marker (the input command takes a while
 * to start), else its marker when the key left no input slice. */
export function anchorPresses(marks: number[], keyDowns: number[], withinMs = 1500): number[] {
  return marks.map((mark, i) => {
    const next = marks[i + 1] ?? Infinity;
    return keyDowns.find(down => down >= mark && down < Math.min(next, mark + withinMs * MS)) ?? mark;
  });
}

/** CPU time (ms) of scheduled spans clipped to [from, to). */
export function cpuIn(spans: Span[], from: number, to: number): number {
  let total = 0;
  for (const span of spans) {
    const start = Math.max(span.ts, from);
    const end = Math.min(span.ts + span.dur, to);
    if (end > start) total += end - start;
  }
  return total / MS;
}

const within = (spans: Span[], from: number, to: number) => spans.filter(span => span.ts >= from && span.ts < to);
const after = (spans: Span[], at: number, to: number) => spans.find(span => span.ts >= at && span.ts < to);

/** The end of the first frame begun at or after `at` (before `to`), else null. */
function frameEnd(frames: Span[], at: number, to: number): number | null {
  const frame = after(frames, at, to);
  return frame ? frame.ts + frame.dur : null;
}

/** The last mount in the window that is followed by `quietMs` without another mount, else the window's
 * last mount: where a screen that fills in over several commits came to rest. */
export function settlingMount(mounts: Span[], quietMs: number): Span | undefined {
  for (let i = 0; i < mounts.length; i++) {
    const end = mounts[i].ts + mounts[i].dur;
    const next = mounts[i + 1];
    if (!next || next.ts - end >= quietMs * MS) return mounts[i];
  }
  return undefined;
}

/** The probe's JS time sources in [from, to), summed: the heaviest `limit`, as source:count:ms. */
export function jsSources(windows: ProbeJs[], from: number, to: number, limit = 4): string {
  const sum: Record<string, [number, number]> = {};
  for (const window of windows) {
    if (window.ts < from || window.ts >= to) continue;
    for (const [source, [count, ms]] of Object.entries(window.sources)) {
      const total = sum[source] ?? (sum[source] = [0, 0]);
      total[0] += count;
      total[1] += ms;
    }
  }
  return Object.entries(sum).sort((a, b) => b[1][1] - a[1][1]).slice(0, limit)
    .map(([source, [count, ms]]) => `${source}:${count}:${round(ms)}`).join(',');
}

export function analyzePress(
  events: TraceEvents, probe: ProbeCommit[], label: string, from: number, to: number, quietMs = 400, js: ProbeJs[] = [],
): PressMetrics {
  const sorted = (spans: Span[]) => [...spans].sort((a, b) => a.ts - b.ts);
  const mounts = within(sorted(events.mounts), from, to);
  const frames = sorted(events.frames);
  const focus = after(sorted(events.focus), from, to);
  const firstMount = mounts[0];
  const mountEnd = firstMount ? firstMount.ts + firstMount.dur : null;
  const firstFrame = mountEnd !== null ? frameEnd(frames, mountEnd, to + 2000 * MS) : null;
  const rest = settlingMount(mounts, quietMs);
  const created = within(sorted(events.views ?? []), from, to)[CONTENT_VIEWS - 1];
  const contentMount = created ? mounts.find(mount => mount.ts + mount.dur >= created.ts) : undefined;
  const contentFrame = contentMount ? frameEnd(frames, contentMount.ts + contentMount.dur, to + 2000 * MS) : null;
  // A last mount that draws nothing (props of something off screen) settles where it ends.
  const settleFrame = rest ? frameEnd(frames, rest.ts + rest.dur, to) ?? rest.ts + rest.dur : null;
  const commits = probe.filter(commit => commit.ts >= from && commit.ts < to);
  const ms = (end: number | null) => (end === null ? null : round((end - from) / MS));
  const heaviest = commits.reduce<ProbeCommit | undefined>((top, c) => (!top || c.comps > top.comps ? c : top), undefined);
  return {
    label,
    focusMs: focus ? round((focus.ts - from) / MS) : null,
    mountMs: ms(mountEnd),
    frameMs: ms(firstFrame),
    settleMs: ms(settleFrame),
    contentMs: ms(contentFrame),
    jsMs: round(cpuIn(events.sched.js, from, to)),
    mainMs: round(cpuIn(events.sched.main, from, to)),
    renderMs: round(cpuIn(events.sched.render, from, to)),
    mounts: mounts.length,
    frames: within(frames, from, to).length,
    commits: commits.length,
    comps: commits.reduce((sum, c) => sum + c.comps, 0),
    top: heaviest?.top ?? '',
    updated: sumCounts(commits.map(c => c.upd ?? '')),
    sources: sumCounts(commits.map(c => c.src ?? '')),
    // A window's line is logged at its end: it covers the 200 ms before it.
    jsTop: jsSources(js, from + 200 * MS, to + 200 * MS),
  };
}

/** Parses the probe's logcat lines (`logcat -v monotonic`): seconds since boot, then the message. */
export function parseProbe(logcat: string): ProbeCommit[] {
  const commits: ProbeCommit[] = [];
  for (const line of logcat.split('\n')) {
    const match = /^\s*(\d+)\.(\d+)\s.*VELAPERF commit t=\d+ comps=(\d+) hosts=(\d+) top=(\S*)(?: upd=(\S*))?(?: src=(\S*))?/.exec(line);
    if (!match) continue;
    const ns = Number(match[1]) * 1e9 + Number(match[2].padEnd(9, '0').slice(0, 9));
    commits.push({ ts: ns, comps: Number(match[3]), hosts: Number(match[4]), top: match[5], upd: match[6] ?? '', src: match[7] ?? '' });
  }
  return commits;
}

/** Sums `name:count,...` lists: the heaviest `limit` names, as name:count. */
export function sumCounts(lists: string[], limit = 6): string {
  const sum: Record<string, number> = {};
  for (const list of lists) {
    for (const entry of list.split(',')) {
      const parts = /^(.*):(\d+)$/.exec(entry);
      if (parts) sum[parts[1]] = (sum[parts[1]] ?? 0) + Number(parts[2]);
    }
  }
  return Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => `${name}:${count}`).join(',');
}

/** Parses the probe's `VELAPERF js` lines (`logcat -v monotonic`). */
export function parseProbeJs(logcat: string): ProbeJs[] {
  const windows: ProbeJs[] = [];
  for (const line of logcat.split('\n')) {
    const match = /^\s*(\d+)\.(\d+)\s.*VELAPERF js ev=(\S*) timer=(\S*) commit=(\d+):([\d.]+)/.exec(line);
    if (!match) continue;
    const sources: Record<string, [number, number]> = {};
    for (const list of [match[3], match[4]]) {
      for (const entry of list.split(',')) {
        const parts = /^(.*):(\d+):([\d.]+)$/.exec(entry);
        if (parts) sources[parts[1]] = [Number(parts[2]), Number(parts[3])];
      }
    }
    if (Number(match[5])) sources.completeRoot = [Number(match[5]), Number(match[6])];
    windows.push({ ts: Number(match[1]) * 1e9 + Number(match[2].padEnd(9, '0').slice(0, 9)), sources });
  }
  return windows;
}

export interface Summary { n: number; median: number | null; p90: number | null; total: number }

export function summarize(values: (number | null)[]): Summary {
  const present = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const pick = (p: number) => (present.length ? present[Math.min(present.length - 1, Math.ceil(p * present.length) - 1)] : null);
  return { n: present.length, median: pick(0.5), p90: pick(0.9), total: round(present.reduce((a, b) => a + b, 0)) };
}

export const METRICS = ['focusMs', 'mountMs', 'frameMs', 'settleMs', 'contentMs', 'jsMs', 'mainMs', 'renderMs', 'mounts', 'frames', 'jank', 'worstMs', 'commits', 'comps', 'windowMs', 'commitMs'] as const;
export type Metric = typeof METRICS[number];

export function summarizePresses(presses: PressMetrics[]): Record<Metric, Summary> {
  return Object.fromEntries(METRICS.map(metric => [metric, summarize(presses.map(p => p[metric] ?? null))])) as Record<Metric, Summary>;
}

// Light mode: devices whose kernel has no tracing (the lab's tx1-box) give no system trace. There a press
// is measured from what the device does give: the logcat mark written as `input keyevent` returns (on
// Android 10 it waits for the app to handle the key), the frames `dumpsys gfxinfo framestats` recorded
// (CLOCK_MONOTONIC, as logcat), and each thread's run time from /proc/<pid>/task/<tid>/schedstat.

/** Frames from any number of `framestats` dumps, once each (by intended vsync), in order: ts is the
 * intended vsync, dur runs to FrameCompleted. Frames the platform marked as skipped are left out. */
export function parseFramestats(text: string): Span[] {
  const frames = new Map<number, Span>();
  let columns: string[] | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('Flags,')) { columns = line.split(','); continue; }
    if (!columns || !/^\d+,/.test(line)) { if (line.startsWith('---')) columns = null; continue; }
    const cells = line.split(',');
    const at = (name: string) => Number(cells[columns!.indexOf(name)]);
    const flags = Number(cells[0]);
    const start = at('IntendedVsync');
    const end = at('FrameCompleted');
    if (flags !== 0 || !(start > 0) || !(end > start)) continue;
    frames.set(start, { ts: start, dur: end - start });
  }
  return [...frames.values()].sort((a, b) => a.ts - b.ts);
}

/** schedstat samples from the device script: `<tag> <press> <js ns> <main ns> <render ns>`. */
export interface CpuSample { tag: string; press: number; js: number; main: number; render: number }

export function parseCpuSamples(text: string): CpuSample[] {
  const samples: CpuSample[] = [];
  for (const line of text.split('\n')) {
    const m = /^(\w+) (\d+) (\d+) (\d+) (\d+)\s*$/.exec(line.trim());
    if (m) samples.push({ tag: m[1], press: Number(m[2]), js: Number(m[3]), main: Number(m[4]), render: Number(m[5]) });
  }
  return samples;
}

const JANK_NS = 16.7 * MS;

/** A press in light mode, from the key's handling (`from`) to the next press or its window's end. The
 * first frame shows the press; it settles at the end of the first frame followed by `quietMs` without
 * one. CPU is the threads' run time from just before the key to the window's end. */
export function analyzeLightPress(frames: Span[], cpu: CpuSample[], press: number, label: string, from: number, to: number, quietMs = 400): PressMetrics {
  const own = frames.filter(frame => frame.ts >= from && frame.ts < to);
  const first = own[0];
  let settle: Span | undefined;
  for (let i = 0; i < own.length; i++) {
    const end = own[i].ts + own[i].dur;
    const next = own[i + 1];
    if (!next ? to - end >= quietMs * MS : next.ts - end >= quietMs * MS) { settle = own[i]; break; }
  }
  const before = cpu.find(sample => sample.press === press && sample.tag === 'p');
  const after = cpu.find(sample => sample.press === press && sample.tag === 'e');
  const ran = (key: 'js' | 'main' | 'render') => (before && after ? round((after[key] - before[key]) / MS) : 0);
  const ms = (at: number | undefined) => (at === undefined ? null : round((at - from) / MS));
  return {
    label,
    focusMs: null,
    mountMs: null,
    frameMs: ms(first ? first.ts + first.dur : undefined),
    settleMs: ms(settle ? settle.ts + settle.dur : undefined),
    contentMs: null,
    jsMs: ran('js'),
    mainMs: ran('main'),
    renderMs: ran('render'),
    mounts: 0,
    frames: own.length,
    jank: own.filter(frame => frame.dur > JANK_NS).length,
    worstMs: own.length ? round(Math.max(...own.map(frame => frame.dur)) / MS) : 0,
    commits: 0,
    comps: 0,
    top: '',
    jsTop: '',
    updated: '',
    sources: '',
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The JS thread's run time logged through a launch (`VELACPU <js ns> <main ns> <render ns>`, logcat -v monotonic). */
export function parseJsSamples(logcat: string): { ts: number; js: number }[] {
  const samples: { ts: number; js: number }[] = [];
  for (const line of logcat.split('\n')) {
    const m = /^\s*(\d+)\.(\d+)\s.*VELACPU\s*:\s*(\d+) \d+ \d+/.exec(line);
    if (m) samples.push({ ts: Number(m[1]) * 1e9 + Number(m[2].padEnd(9, '0').slice(0, 9)), js: Number(m[3]) });
  }
  return samples;
}

/** When a launch's JS thread went quiet: the start of the first stretch of `chunks` samples in a row each
 * under `busy` of their interval, ms after `from`; null when it never did before `to`. */
export function jsQuietMs(samples: { ts: number; js: number }[], from: number, to: number, busy = 0.25, chunks = 2): number | null {
  const own = samples.filter(sample => sample.ts >= from && sample.ts <= to);
  let previous = { ts: from, js: own[0]?.js ?? 0 };
  let run = 0, start = from;
  for (const sample of own) {
    const share = (sample.js - previous.js) / Math.max(1, sample.ts - previous.ts);
    if (share < busy) { if (run++ === 0) start = previous.ts; if (run >= chunks) return round((start - from) / MS); }
    else run = 0;
    previous = sample;
  }
  return null;
}
