// Android TV D-pad responsiveness, per press, on an emulator or device (adb). Drives a named scenario
// with real key presses under a Perfetto trace and reports, for every press, how long focus, the JS
// answer and the frame showing it took, and the CPU each thread spent (tools/perf/tv-nav-analysis.ts).
// With a probe build (tools/perf/repack-js.sh --probe) it also counts React commits and components.
//
//   bun tools/perf/tv-nav.ts --serial emulator-5704 --scenario home [--label before] [--out run.json]
//   bun tools/perf/tv-nav.ts --compare before.json after.json      (Markdown table of the medians)
//   --keep <dir> keeps each run's trace (<scenario>-<label>.pftrace) for ui.perfetto.dev
//
// Scenarios start the app afresh (force-stop, launch, wait), so runs are comparable; the build decides
// the server (a lab or mock sign-in build). Software-rendered emulators make renderMs and frame times
// relative only: compare builds on the same emulator. Needs adb and trace_processor (Perfetto) on PATH,
// or --adb / --tp. Kills nothing but the Perfetto session it started on the device.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  analyzePress, cpuIn, parseProbe, parseProbeJs, pressStarts, summarizePresses, METRICS,
  type PressMetrics, type Span, type TraceEvents, type Metric, type Summary,
} from './tv-nav-analysis';

const PACKAGE = 'app.ether.vela';

/** A press (`key`, Android KEYCODE_ name without the prefix) or a pause. `window` is how long the
 * press is measured for (the next press waits that long); `burst` sends several keys back to back. */
export type Step =
  | { key: string; label?: string; window?: number; burst?: number }
  | { wait: number }
  /** Opens a deep link (an unmeasured jump to where the presses start) and waits `wait` ms. */
  | { link: string; wait: number };

const press = (key: string, label: string, window = 1200): Step => ({ key, label, window });
const repeat = (key: string, label: string, count: number, window = 1200): Step[] =>
  Array.from({ length: count }, (_, i) => press(key, `${label} ${i + 1}`, window));

/** The lab's Movies library, in its grid view. */
const MOVIES_GRID = 'vela://library/1?view=library';

/** From Home on launch (focus on the hero's Play, or on search when the account has no hero):
 * up to the navigation bar, where further presses up do nothing, then Movies. */
const toMovies: Step[] = [...repeat('DPAD_UP', 'up to nav', 3, 900), press('DPAD_RIGHT', 'nav → Movies'), press('DPAD_CENTER', 'open Movies', 6000)];

/** A scenario: after launch and `settle` ms, `setup` presses (not measured) bring the app where
 * it starts, then `steps` run under the trace. */
export const SCENARIOS: Record<string, { settle: number; setup?: Step[]; steps: Step[] }> = {
  home: {
    settle: 15000,
    steps: [
      ...repeat('DPAD_DOWN', 'home ↓', 3),
      ...repeat('DPAD_RIGHT', 'row →', 6),
      press('DPAD_DOWN', 'next row ↓'),
      ...repeat('DPAD_RIGHT', 'row 2 →', 4),
      ...repeat('DPAD_DOWN', 'rows ↓', 3),
      ...repeat('DPAD_LEFT', 'row ←', 2),
      ...repeat('DPAD_UP', 'rows ↑', 4),
    ],
  },
  movies: {
    settle: 15000,
    steps: [
      ...toMovies,
      ...repeat('DPAD_DOWN', 'rows ↓', 6),
      ...repeat('DPAD_RIGHT', 'row →', 4),
      ...repeat('DPAD_UP', 'rows ↑', 3),
    ],
  },
  /** Movies' Library grid (24,000 titles on the lab), opened by its deep link with focus on the first card. */
  library: {
    settle: 15000,
    setup: [{ link: MOVIES_GRID, wait: 7000 }],
    steps: [
      ...repeat('DPAD_DOWN', 'grid ↓', 8),
      ...repeat('DPAD_RIGHT', 'grid →', 4),
      ...repeat('DPAD_DOWN', 'grid deep ↓', 6),
      ...repeat('DPAD_UP', 'grid ↑', 3),
    ],
  },
  /** Vertical moves over grid rows already drawn, deep in a long library (setup draws them). */
  griddeep: {
    settle: 15000,
    setup: [{ link: MOVIES_GRID, wait: 7000 }, ...repeat('DPAD_DOWN', 'grid ↓', 16, 900), { wait: 12000 }],
    steps: [...repeat('DPAD_UP', 'drawn ↑', 6), ...repeat('DPAD_DOWN', 'drawn ↓', 6), ...repeat('DPAD_RIGHT', 'drawn →', 4)],
  },
  title: {
    settle: 15000,
    steps: [
      ...toMovies,
      ...repeat('DPAD_DOWN', 'rows ↓', 2),
      press('DPAD_CENTER', 'open title', 6000),
      ...repeat('DPAD_DOWN', 'title ↓', 4),
      ...repeat('DPAD_RIGHT', 'title →', 3),
      ...repeat('DPAD_UP', 'title ↑', 4),
      press('BACK', 'close title', 4000),
      press('DPAD_DOWN', 'rows ↓ after'),
    ],
  },
  idle: {
    settle: 15000,
    steps: [{ wait: 10000 }],
  },
  /** Plays the first Movies title (from its page's Play), then works the player's controls. Leaves
   * the player with Back, which stops the session. */
  player: {
    settle: 15000,
    setup: [...toMovies, press('DPAD_CENTER', 'open title', 6000), press('DPAD_CENTER', 'Play', 12000)],
    steps: [
      press('DPAD_CENTER', 'show controls', 2000),
      ...repeat('DPAD_RIGHT', 'controls →', 3),
      ...repeat('DPAD_LEFT', 'controls ←', 3),
      press('DPAD_DOWN', 'controls ↓'),
      press('DPAD_UP', 'controls ↑'),
      { wait: 8000 },
      press('DPAD_RIGHT', 'hidden → (seek)', 2500),
      press('DPAD_LEFT', 'hidden ← (seek)', 2500),
      { wait: 6000 },
      press('DPAD_CENTER', 'pause', 2000),
      press('DPAD_CENTER', 'play', 2000),
      { wait: 6000 },
      press('BACK', 'leave player', 4000),
      press('BACK', 'close title', 3000),
    ],
  },
  burst: {
    settle: 15000,
    steps: [
      ...repeat('DPAD_DOWN', 'home ↓', 3),
      { key: 'DPAD_RIGHT', label: 'row → ×10 burst', window: 4000, burst: 10 },
      { key: 'DPAD_LEFT', label: 'row ← ×10 burst', window: 4000, burst: 10 },
      { key: 'DPAD_DOWN', label: 'rows ↓ ×5 burst', window: 4000, burst: 5 },
    ],
  },
};

interface Options { serial: string; adb: string; tp: string; quietMs: number; keep?: string }

function run(cmd: string[], input?: string): string {
  const result = Bun.spawnSync(cmd, { stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`${cmd.slice(0, 4).join(' ')} failed: ${result.stderr.toString().slice(0, 400)}`);
  return result.stdout.toString();
}

const adb = (o: Options, ...args: string[]) => run([o.adb, '-s', o.serial, ...args]);
const shell = (o: Options, command: string) => adb(o, 'shell', command);

function traceConfig(seconds: number): string {
  return `buffers { size_kb: 98304 fill_policy: RING_BUFFER }
buffers { size_kb: 4096 fill_policy: RING_BUFFER }
data_sources { config { name: "linux.ftrace" target_buffer: 0 ftrace_config {
  ftrace_events: "sched/sched_switch" ftrace_events: "sched/sched_wakeup"
  atrace_categories: "gfx" atrace_categories: "view" atrace_categories: "input"
  atrace_apps: "${PACKAGE}" } } }
data_sources { config { name: "linux.process_stats" target_buffer: 1 process_stats_config { scan_all_processes_on_start: true } } }
duration_ms: ${Math.ceil(seconds * 1000)}
`;
}

/** One shell script on the device, so presses are paced by the device and not by adb round trips. */
export function deviceScript(steps: Step[]): string {
  const lines = ['#!/system/bin/sh'];
  for (const step of steps) {
    if ('link' in step) lines.push(`am start -a android.intent.action.VIEW -d '${step.link}' ${PACKAGE} >/dev/null 2>&1`, `sleep ${step.wait / 1000}`);
    else if ('wait' in step) lines.push(`sleep ${step.wait / 1000}`);
    else {
      const keys = Array.from({ length: step.burst ?? 1 }, () => `KEYCODE_${step.key}`).join(' ');
      lines.push(step.burst ? `input keyevent ${keys}` : `input keyevent --duration 80 ${keys}`);
      lines.push(`sleep ${(step.window ?? 1200) / 1000}`);
    }
  }
  return lines.join('\n') + '\n';
}

const EVENTS_SQL = `
with app as (select upid from process where name = '${PACKAGE}' limit 1),
main as (select utid from thread where upid = (select upid from app) and is_main_thread = 1
  union select utid from thread where upid = (select upid from app) and tid = (select pid from process where upid = (select upid from app))),
js as (select utid from thread where upid = (select upid from app) and name = 'mqt_v_js'),
render as (select utid from thread where upid = (select upid from app) and name = 'RenderThread'),
slices as (select s.ts, s.dur, s.name, tt.utid from slice s join thread_track tt on s.track_id = tt.id)
select 'key' kind, ts, dur from slices where utid in (select utid from main) and name like 'ImeInputStage id=%'
union all select 'focus', ts, dur from slices where utid in (select utid from main) and name = 'FabricEventEmitter.receiveEvent(''topFocus'')'
union all select 'mount', ts, dur from slices where utid in (select utid from main) and name like 'MountItemDispatcher::mountViews%'
union all select 'frame', ts, dur from slices where utid in (select utid from render) and name like 'DrawFrame%'
union all select 'js', ts, dur from sched where utid in (select utid from js)
union all select 'main', ts, dur from sched where utid in (select utid from main)
union all select 'render', ts, dur from sched where utid in (select utid from render)
order by ts;
`;

export function parseEvents(csv: string): TraceEvents {
  const events: TraceEvents = { keys: [], focus: [], mounts: [], frames: [], sched: { js: [], main: [], render: [] } };
  for (const line of csv.split('\n')) {
    const match = /^"(\w+)",(\d+),(-?\d+)/.exec(line.trim());
    if (!match) continue;
    const span: Span = { ts: Number(match[2]), dur: Math.max(0, Number(match[3])) };
    switch (match[1]) {
      case 'key': events.keys.push(span); break;
      case 'focus': events.focus.push(span); break;
      case 'mount': events.mounts.push(span); break;
      case 'frame': events.frames.push(span); break;
      case 'js': case 'main': case 'render': events.sched[match[1]].push(span); break;
    }
  }
  return events;
}

/** The whole measured run (presses and pauses): what the screen costs just being on show. */
export interface RunTotals { seconds: number; framesPerSecond: number; jsMsPerSecond: number; mainMsPerSecond: number; renderMsPerSecond: number }

export function runTotals(events: TraceEvents, from: number, to: number): RunTotals {
  const seconds = Math.max(0.001, (to - from) / 1e9);
  const per = (ms: number) => Math.round((ms / seconds) * 10) / 10;
  return {
    seconds: Math.round(seconds * 10) / 10,
    framesPerSecond: per(events.frames.filter(f => f.ts >= from && f.ts < to).length * 1000) / 1000,
    jsMsPerSecond: per(cpuIn(events.sched.js, from, to)),
    mainMsPerSecond: per(cpuIn(events.sched.main, from, to)),
    renderMsPerSecond: per(cpuIn(events.sched.render, from, to)),
  };
}

export interface RunReport {
  label: string;
  totals?: RunTotals;
  scenario: string;
  serial: string;
  measuredAt: string;
  presses: PressMetrics[];
  summary: Record<Metric, Summary>;
  warnings: string[];
}

async function measure(o: Options, name: string, label: string): Promise<RunReport> {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`unknown scenario ${name}; have ${Object.keys(SCENARIOS).join(', ')}`);
  const work = mkdtempSync(join(tmpdir(), 'tv-nav-'));
  try {
    const presses = scenario.steps.filter((s): s is Extract<Step, { key: string }> => 'key' in s);
    const seconds = scenario.steps.reduce((t, s) => t + ('key' in s ? (s.window ?? 1200) + 600 * (s.burst ?? 1) : s.wait), 0) / 1000 + 8;
    shell(o, `am force-stop ${PACKAGE}`);
    shell(o, `am start -n ${PACKAGE}/.MainActivity`);
    await Bun.sleep(scenario.settle);
    if (scenario.setup?.length) {
      writeFileSync(join(work, 'setup.sh'), deviceScript(scenario.setup));
      adb(o, 'push', join(work, 'setup.sh'), '/data/local/tmp/tv-nav-setup.sh');
      shell(o, 'sh /data/local/tmp/tv-nav-setup.sh');
    }
    writeFileSync(join(work, 'steps.sh'), deviceScript(scenario.steps));
    writeFileSync(join(work, 'trace.cfg'), traceConfig(seconds));
    adb(o, 'push', join(work, 'steps.sh'), '/data/local/tmp/tv-nav-steps.sh');
    adb(o, 'push', join(work, 'trace.cfg'), '/data/misc/perfetto-configs/tv-nav.cfg');
    const out = '/data/misc/perfetto-traces/tv-nav.pftrace';
    shell(o, `rm -f ${out}`);
    adb(o, 'logcat', '-c');
    const pid = shell(o, `perfetto --txt -c /data/misc/perfetto-configs/tv-nav.cfg -o ${out} --background`).trim().split('\n').pop()!.trim();
    await Bun.sleep(1500);
    shell(o, 'sh /data/local/tmp/tv-nav-steps.sh');
    await Bun.sleep(2000);
    // Stop our own session (it flushes on SIGTERM), then wait for the file to settle.
    if (/^\d+$/.test(pid)) shell(o, `kill -TERM ${pid} 2>/dev/null; true`);
    for (let i = 0; i < 30 && shell(o, `ls /proc/${pid} >/dev/null 2>&1 && echo up || echo done`).trim() === 'up'; i++) await Bun.sleep(500);
    // The service may still be finishing the file as the command exits: try a few times.
    for (let attempt = 1; ; attempt++) {
      try { adb(o, 'pull', out, join(work, 'trace.pftrace')); break; } catch (error) {
        if (attempt >= 10) throw error;
        await Bun.sleep(1000);
      }
    }
    const logcat = adb(o, 'logcat', '-d', '-v', 'monotonic', '-s', 'ReactNativeJS:I');
    writeFileSync(join(work, 'events.sql'), EVENTS_SQL);
    const events = parseEvents(run([o.tp, '-q', join(work, 'events.sql'), join(work, 'trace.pftrace')]));
    const probe = parseProbe(logcat);
    const probeJs = parseProbeJs(logcat);
    const starts = pressStarts(events.keys);
    const warnings: string[] = [];
    if (!events.sched.js.length) warnings.push('no JS thread scheduling in the trace');
    // A burst is one step: key-downs within its sending time belong to it.
    const metrics: PressMetrics[] = [];
    let at = 0;
    for (const step of presses) {
      const from = starts[at];
      if (from === undefined) {
        warnings.push(`saw ${starts.length} press starts in the trace; ran out at "${step.label ?? step.key}"`);
        break;
      }
      const span = step.burst ? step.burst * 150 * 1e6 : 0;
      do at++; while (starts[at] !== undefined && starts[at] <= from + span);
      const next = starts[at];
      const to = next ?? from + (step.window ?? 1200) * 1e6;
      metrics.push(analyzePress(events, probe, step.label ?? step.key, from, to, o.quietMs, probeJs));
    }
    // From the script's start (the trace began 1.5 s before it) to the trace's last scheduling.
    const traceEnd = events.sched.main.reduce((end, span) => Math.max(end, span.ts + span.dur), 0);
    const scriptStart = events.sched.main.reduce((start, span) => Math.min(start, span.ts), Infinity) + 1.5e9;
    const totals = runTotals(events, starts[0] ?? scriptStart, traceEnd);
    return { label, totals, scenario: name, serial: o.serial, measuredAt: new Date().toISOString(), presses: metrics, summary: summarizePresses(metrics), warnings };
  } finally {
    if (o.keep) Bun.spawnSync(['cp', join(work, 'trace.pftrace'), join(o.keep, `${name}-${label}.pftrace`)]);
    rmSync(work, { recursive: true, force: true });
  }
}

const cell = (s: Summary) => (s.median === null ? '–' : `${s.median} / ${s.p90}`);

export function formatReport(report: RunReport): string {
  const head = `| press | ${METRICS.join(' | ')} | heaviest commit | JS time |`;
  const rule = `|${' --- |'.repeat(METRICS.length + 3)}`;
  const rows = report.presses.map(p => `| ${p.label} | ${METRICS.map(m => p[m] ?? '–').join(' | ')} | ${p.top} | ${p.jsTop ?? ''} |`);
  const summary = `| **median / p90** | ${METRICS.map(m => cell(report.summary[m])).join(' | ')} | | |`;
  const totals = `| **total** | ${METRICS.map(m => report.summary[m].total).join(' | ')} | | |`;
  const t = report.totals;
  const whole = t ? `whole run ${t.seconds} s: ${t.framesPerSecond} frames/s, CPU ms/s JS ${t.jsMsPerSecond}, main ${t.mainMsPerSecond}, RenderThread ${t.renderMsPerSecond}` : '';
  return [`### ${report.scenario} (${report.label}, ${report.serial}, ${report.measuredAt})`, ...report.warnings.map(w => `> ${w}`), whole, '', head, rule, ...rows, summary, totals].join('\n');
}

export function formatComparison(before: RunReport, after: RunReport): string {
  const lines = [`### ${after.scenario}: ${before.label} → ${after.label} (median / p90; total)`, '', '| metric | before | after |', '| --- | --- | --- |'];
  for (const m of METRICS) lines.push(`| ${m} | ${cell(before.summary[m])}; ${before.summary[m].total} | ${cell(after.summary[m])}; ${after.summary[m].total} |`);
  for (const k of ['framesPerSecond', 'jsMsPerSecond', 'mainMsPerSecond', 'renderMsPerSecond'] as const) {
    if (before.totals && after.totals) lines.push(`| whole run ${k} | ${before.totals[k]} | ${after.totals[k]} |`);
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      serial: { type: 'string', default: process.env.ANDROID_SERIAL ?? '' },
      scenario: { type: 'string', default: 'home' },
      label: { type: 'string', default: 'run' },
      out: { type: 'string' },
      adb: { type: 'string', default: 'adb' },
      tp: { type: 'string', default: 'trace_processor' },
      quiet: { type: 'string', default: '400' },
      keep: { type: 'string' },
      compare: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (values.compare) {
    const [a, b] = process.argv.slice(process.argv.indexOf('--compare') + 1).map(file => JSON.parse(readFileSync(file, 'utf8')) as RunReport[]);
    for (const before of a) {
      const after = b.find(report => report.scenario === before.scenario);
      if (after) console.log(formatComparison(before, after) + '\n');
    }
  } else {
    if (!values.serial) throw new Error('--serial (or ANDROID_SERIAL) is required');
    const options: Options = { serial: values.serial, adb: values.adb!, tp: values.tp!, quietMs: Number(values.quiet), keep: values.keep };
    const reports: RunReport[] = [];
    for (const name of values.scenario!.split(',')) {
      const report = await measure(options, name, values.label!);
      reports.push(report);
      console.log(formatReport(report) + '\n');
    }
    if (values.out) writeFileSync(values.out, JSON.stringify(reports, null, 2));
  }
}
