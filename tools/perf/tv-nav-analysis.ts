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
  const settleFrame = rest ? frameEnd(frames, rest.ts + rest.dur, to + 2000 * MS) : null;
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

export const METRICS = ['focusMs', 'mountMs', 'frameMs', 'settleMs', 'contentMs', 'jsMs', 'mainMs', 'renderMs', 'mounts', 'frames', 'commits', 'comps'] as const;
export type Metric = typeof METRICS[number];

export function summarizePresses(presses: PressMetrics[]): Record<Metric, Summary> {
  return Object.fromEntries(METRICS.map(metric => [metric, summarize(presses.map(p => p[metric]))])) as Record<Metric, Summary>;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
