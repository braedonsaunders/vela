// Android TV D-pad responsiveness, per press, on an emulator or device (adb). Drives a named scenario
// with real key presses under a Perfetto trace and reports, for every press, how long focus, the JS
// answer and the frame showing it took, and the CPU each thread spent (tools/perf/tv-nav-analysis.ts).
// With a probe build (tools/perf/repack-js.sh --probe) it also counts React commits and components.
//
//   bun tools/perf/tv-nav.ts --serial emulator-5704 --scenario home [--label before] [--out run.json]
//   bun tools/perf/tv-nav.ts --compare before.json after.json      (Markdown table of the medians)
//   --keep <dir> keeps each run's trace (<scenario>-<label>.pftrace) for ui.perfetto.dev
//   bun tools/perf/tv-nav.ts --lab tx1-box --owner <claim owner> --scenario cold,home   (on the lab host,
//     through the claimed device's `lab shell`; --settle <ms> and --buffer-mb for slow, small devices)
//   --light: for a kernel without tracing (tx1-box): frames from framestats, CPU from schedstat (no focus
//     or mount times); see lightScript and analyzeLightPress
//   --focus: where focus is, not what it costs (scenarios grid05, grid10, grid16, gridhold, homefocus, homerow): presses at a remote's pace
//     and held keys, through the device's own remote input device, and the focused view at checkpoints
//
// Scenarios start the app afresh (force-stop, launch, wait), so runs are comparable; the build decides
// the server (a lab or mock sign-in build). Software-rendered emulators make renderMs and frame times
// relative only: compare builds on the same emulator. Needs adb and trace_processor (Perfetto) on PATH,
// or --adb / --tp. Kills nothing but the Perfetto session it started on the device (and its own netcat).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  analyzeLightPress, analyzePress, anchorPresses, cpuIn, jsQuietMs, parseCpuSamples, parseFramestats, parseJsSamples, parseMarks, parseProbe, parseProbeJs, pressStarts, summarizePresses, METRICS,
  type PressMetrics, type Span, type TraceEvents, type Metric, type Summary,
} from './tv-nav-analysis';

const PACKAGE = 'app.ether.vela';
/** The log tag of the device script's press markers. */
const MARK = 'VELANAV';

/** A press (`key`, Android KEYCODE_ name without the prefix) or a pause. `window` is how long the
 * press is measured for (the next press waits that long); `burst` sends several keys back to back. */
export type Step =
  | { key: string; label?: string; window?: number; burst?: number; hold?: number }
  /** --focus: the focused view at this point (uiautomator), reported under `label`. */
  | { focus: string }
  | { wait: number }
  /** Opens a deep link (an unmeasured jump to where the presses start) and waits `wait` ms. */
  | { link: string; wait: number }
  /** Starts the app (force-stopped by the scenario) under the trace: measured like a press, from its
   * marker (cold start to first content and to rest). */
  | { launch: true; label: string; window: number };

const press = (key: string, label: string, window = 1200): Step => ({ key, label, window });
const repeat = (key: string, label: string, count: number, window = 1200): Step[] =>
  Array.from({ length: count }, (_, i) => press(key, `${label} ${i + 1}`, window));

/** The lab's Movies library, in its grid view. */
const MOVIES_GRID = 'vela://library/1?view=library';

/** `count` presses of `key` `gap` ms apart, the next step after the last one's gap. */
const quick = (key: string, label: string, count: number, gap: number): Step[] =>
  Array.from({ length: count }, (_, i) => ({ key, label: `${label} ${i + 1}`, window: gap }));

function gridFocusScenarios(): Record<string, { settle: number; setup: Step[]; steps: Step[] }> {
  const runs = [['grid05', 500, 12], ['grid10', 1000, 10], ['grid16', 1600, 8]] as const;
  return Object.fromEntries(runs.map(([name, gap, count]) => [name, {
    settle: 15000,
    setup: [{ link: MOVIES_GRID, wait: 8000 }],
    steps: [
      { focus: 'start' },
      ...quick('DPAD_DOWN', `↓ ${gap / 1000} s`, count, gap), { wait: 8000 }, { focus: `after ${count} ↓ ${gap / 1000} s apart` },
      ...quick('DPAD_UP', '↑', count, 2500), { wait: 3000 }, { focus: `after ${count} slow ↑ (the first card again)` },
    ],
  }]));
}

/** From Home on launch (focus on the hero's Play, or on search when the account has no hero):
 * up to the navigation bar, where further presses up do nothing, then Movies. */
const toMovies: Step[] = [...repeat('DPAD_UP', 'up to nav', 3, 900), press('DPAD_RIGHT', 'nav → Movies'), press('DPAD_CENTER', 'open Movies', 6000)];

/** A scenario: after launch and `settle` ms, `setup` presses (not measured) bring the app where
 * it starts, then `steps` run under the trace. */
export const SCENARIOS: Record<string, { settle: number; setup?: Step[]; steps: Step[]; cold?: boolean }> = {
  /** Cold start: the app launched under the trace (contentMs: first content; settleMs: Home at rest),
   * then the first presses on the Home it lands on. */
  cold: {
    settle: 0,
    cold: true,
    steps: [{ launch: true, label: 'cold start', window: 25000 }, ...repeat('DPAD_DOWN', 'first ↓', 2, 2000)],
  },
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
  /** --focus: Down presses quicker than a slow box draws grid rows (grid05: 0.5 s apart, grid10: 1 s,
   * grid16: 1.6 s), then as many slow Up presses: focus is back on the first card when every press moved
   * exactly one row, and on a card throughout. */
  ...gridFocusScenarios(),
  /** --focus: a held Down in the grid, then one slow Up and one Down: focus stays on a card in its column. */
  gridhold: {
    settle: 15000,
    setup: [{ link: MOVIES_GRID, wait: 8000 }],
    steps: [
      { focus: 'start' },
      { key: 'DPAD_DOWN', label: 'held ↓ 5 s', hold: 5000, window: 10000 }, { focus: 'after ↓ held 5 s' },
      ...quick('DPAD_UP', '↑', 1, 2500), { focus: 'after 1 slow ↑' },
      ...quick('DPAD_DOWN', '↓', 1, 2500), { focus: 'after 1 slow ↓' },
    ],
  },
  /** --focus: Home's rows, drawn as they come within reach, with quick presses and a held Down. */
  homefocus: {
    settle: 20000,
    steps: [
      { focus: 'start' },
      ...quick('DPAD_DOWN', '↓ 0.5 s', 10, 500), { wait: 8000 }, { focus: 'after 10 ↓ 0.5 s apart' },
      { key: 'DPAD_DOWN', label: 'held ↓ 4 s', hold: 4000, window: 10000 }, { focus: 'after ↓ held 4 s' },
      ...quick('DPAD_UP', '↑', 2, 2500), { focus: 'after 2 slow ↑' },
    ],
  },
  /** --focus: along one of Home's rows, whose cards are drawn as they come within reach: a held Right,
   * then quick presses; focus stays on the row's cards. */
  homerow: {
    settle: 20000,
    steps: [
      ...quick('DPAD_DOWN', '↓ to a row', 4, 2500), { focus: 'on the fourth row' },
      { key: 'DPAD_RIGHT', label: 'held → 4 s', hold: 4000, window: 10000 }, { focus: 'after → held 4 s' },
      ...quick('DPAD_RIGHT', '→ 0.5 s', 10, 500), { wait: 8000 }, { focus: 'after 10 → 0.5 s apart' },
      ...quick('DPAD_LEFT', '←', 2, 2500), { focus: 'after 2 slow ←' },
    ],
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
  /** What Home costs just being on show: one press that does nothing (KEYCODE_UNKNOWN), measured for 10 s. */
  idle: {
    settle: 15000,
    steps: [press('UNKNOWN', 'idle 10 s', 10000)],
  },
  /** Screen transitions, each measured to its first content (contentMs): Movies, a title page and
   * back, Movies' Library grid, Home. */
  transitions: {
    settle: 15000,
    steps: [
      ...repeat('DPAD_UP', 'up to nav', 3, 900),
      press('DPAD_RIGHT', 'nav → Movies'),
      press('DPAD_CENTER', 'open Movies', 6000),
      press('DPAD_CENTER', 'open title', 6000),
      press('BACK', 'close title', 4000),
      press('DPAD_UP', 'up to the chips', 1500),
      press('DPAD_RIGHT', 'chip → Library', 1500),
      press('DPAD_CENTER', 'open Library grid', 6000),
      ...repeat('DPAD_UP', 'up to nav', 2, 1500),
      press('DPAD_LEFT', 'nav → Home'),
      press('DPAD_CENTER', 'open Home', 6000),
    ],
  },
  /** Plays the first Movies title (from its page's Play), then works the player's controls. Leaves
   * the player with Back, which stops the session. */
  player: {
    settle: 15000,
    setup: [...toMovies, press('DPAD_CENTER', 'open title', 6000), press('DPAD_CENTER', 'Play', 12000)],
    steps: [
      // What playback costs untouched, chrome hidden (a key nothing handles): the rate a press's own JS stands on.
      press('UNKNOWN', 'playing untouched 10 s', 10000),
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

/** `player` reaches playback through a title's watch link instead (--watch <id>): a library's first title
 * may have no media, and only a stereo or decoded title is safe to play on a device with its sound on. */
function withWatch(scenario: (typeof SCENARIOS)[string] | undefined, name: string, watch?: string) {
  if (!scenario || name !== 'player' || !watch) return scenario;
  return { ...scenario, setup: [{ link: `vela://watch/${watch}`, wait: 25000 }],
    steps: scenario.steps.filter(step => !('label' in step) || step.label !== 'close title') };
}

interface Options { device: Device; tp: string; quietMs: number; keep?: string; settle?: number; bufferMb?: number; light?: boolean; watch?: string }

/** How the runner reaches the device: adb, or the device lab's guarded shell (`lab shell`) on the
 * lab host, which has no push or pull: files go in as base64 and traces come back over the lab
 * network (netcat), else as base64 chunks. */
export interface Device {
  serial: string;
  shell(command: string, timeoutS?: number): string;
  push(local: string, remote: string): void;
  pull(remote: string, local: string): Promise<void>;
}

function run(cmd: string[], input?: string): string {
  const result = Bun.spawnSync(cmd, { stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input), stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`${cmd.slice(0, 4).join(' ')} failed: ${result.stderr.toString().slice(0, 400)}`);
  return result.stdout.toString();
}

export function adbDevice(adbPath: string, serial: string): Device {
  const adb = (...args: string[]) => run([adbPath, '-s', serial, ...args]);
  return {
    serial,
    shell: command => adb('shell', command),
    push: (local, remote) => { adb('push', local, remote); },
    pull: async (remote, local) => { adb('pull', remote, local); },
  };
}

/** `lab shell` prints the command's output, then `[stderr]` and its text if any, then `[exit N]`. */
export function parseLabShell(text: string): { out: string; err: string; exit: number } {
  const exit = /\n?\[exit (-?\d+)\]\s*$/.exec(text);
  let body = exit ? text.slice(0, exit.index) : text;
  let err = '';
  const at = body.lastIndexOf('\n[stderr]\n');
  if (at >= 0) { err = body.slice(at + 10); body = body.slice(0, at); }
  return { out: body, err, exit: exit ? Number(exit[1]) : 1 };
}

export function labDevice(device: string, owner: string, address?: string): Device {
  const shell = (command: string, timeoutS = 60) => {
    const result = Bun.spawnSync(['lab', '--owner', owner, 'shell', '--timeout', String(timeoutS), device, command], { stdout: 'pipe', stderr: 'pipe' });
    const parsed = parseLabShell(result.stdout.toString());
    if (result.exitCode !== 0 || parsed.exit !== 0) {
      throw new Error(`lab shell ${device} "${command.slice(0, 60)}" failed: ${(parsed.err || result.stderr.toString() || parsed.out).slice(0, 400)}`);
    }
    return parsed.out;
  };
  let ip = address;
  const deviceIp = () => ip ??= /inet (?:addr:)?(\d+\.\d+\.\d+\.\d+)/.exec(shell('ifconfig wlan0 2>/dev/null || ip -4 addr show wlan0'))?.[1];
  return {
    serial: device,
    shell,
    push(local, remote) {
      const data = readFileSync(local).toString('base64');
      shell(`: > ${remote}`);
      for (let i = 0; i < data.length; i += 48000) shell(`echo '${data.slice(i, i + 48000)}' | base64 -d >> ${remote}`);
    },
    async pull(remote, local) {
      const size = Number(shell(`wc -c < ${remote}`).trim());
      if (!(size > 0)) throw new Error(`${remote} is empty on ${device}`);
      const host = deviceIp();
      if (host) {
        try { return writeFileSync(local, await netcatPull(shell, host, remote, size)); } catch (error) {
          console.error(`netcat pull failed (${(error as Error).message}); falling back to base64`);
        }
      }
      // gzip makes a trace several times smaller; each call returns under the lab's 100 kB cap.
      shell(`gzip -c ${remote} > ${remote}.gz`);
      const gz = Number(shell(`wc -c < ${remote}.gz`).trim());
      const chunks: Buffer[] = [];
      for (let block = 0; block * 65536 < gz; block++) {
        chunks.push(Buffer.from(shell(`dd if=${remote}.gz bs=65536 skip=${block} count=1 2>/dev/null | base64`, 120).replace(/\s+/g, ''), 'base64'));
      }
      shell(`rm -f ${remote}.gz`);
      writeFileSync(local, Bun.gunzipSync(Buffer.concat(chunks)));
    },
  };
}

/** The device serves the file once on a port (toybox nc), the host reads exactly `size` bytes. */
async function netcatPull(shell: (command: string, timeoutS?: number) => string, host: string, remote: string, size: number): Promise<Buffer> {
  const port = 47000 + Math.floor(Math.random() * 900);
  shell(`(nohup nc -l -p ${port} < ${remote} > /dev/null 2>&1 &) ; sleep 1`);
  const chunks: Buffer[] = [];
  let got = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${got} of ${size} bytes`)), 120000);
    Bun.connect({
      hostname: host, port,
      socket: {
        data(socket, data) {
          chunks.push(Buffer.from(data)); got += data.length;
          if (got >= size) { clearTimeout(timer); socket.end(); resolve(); }
        },
        close() { clearTimeout(timer); got >= size ? resolve() : reject(new Error(`closed after ${got} of ${size} bytes`)); },
        error(_socket, error) { clearTimeout(timer); reject(error); },
        connectError(_socket, error) { clearTimeout(timer); reject(error); },
      },
    }).catch(reject);
  });
  return Buffer.concat(chunks).subarray(0, size);
}

function traceConfig(seconds: number, bufferMb = 96): string {
  return `buffers { size_kb: ${bufferMb * 1024} fill_policy: RING_BUFFER }
buffers { size_kb: 4096 fill_policy: RING_BUFFER }
data_sources { config { name: "linux.ftrace" target_buffer: 0 ftrace_config {
  ftrace_events: "sched/sched_switch" ftrace_events: "sched/sched_wakeup"
  ftrace_events: "task/task_newtask" ftrace_events: "task/task_rename" ftrace_events: "sched/sched_process_free"
  atrace_categories: "gfx" atrace_categories: "view" atrace_categories: "input"
  atrace_apps: "${PACKAGE}" } } }
data_sources { config { name: "linux.process_stats" target_buffer: 1 process_stats_config { scan_all_processes_on_start: true } } }
duration_ms: ${Math.ceil(seconds * 1000)}
`;
}

/** One shell script on the device, so presses are paced by the device and not by adb round trips.
 * `hold` sends each key as an 80 ms press (`input keyevent --duration`, Android 12+): an instant
 * down/up can let JS see the key-up before the focus change. Older Androids only have instant keys. */
export function deviceScript(steps: Step[], hold = true): string {
  const lines = ['#!/system/bin/sh'];
  let press = 0;
  for (const step of steps) {
    if ('focus' in step) continue;
    if ('link' in step) lines.push(`am start -a android.intent.action.VIEW -d '${step.link}' ${PACKAGE} >/dev/null 2>&1`, `sleep ${step.wait / 1000}`);
    else if ('wait' in step) lines.push(`sleep ${step.wait / 1000}`);
    else if ('launch' in step) {
      lines.push(`log -t ${MARK} ${press++}`, `am start -n ${PACKAGE}/.MainActivity >/dev/null 2>&1`, `sleep ${step.window / 1000}`);
    } else {
      const keys = Array.from({ length: step.burst ?? 1 }, () => `KEYCODE_${step.key}`).join(' ');
      // A marker in the log names the press, so presses map to steps even if one leaves no input slice.
      lines.push(`log -t ${MARK} ${press++}`);
      lines.push(step.burst || !hold ? `input keyevent ${keys}` : `input keyevent --duration 80 ${keys}`);
      lines.push(`sleep ${(step.window ?? 1200) / 1000}`);
    }
  }
  return lines.join('\n') + '\n';
}


/** The light-mode device script (no kernel tracing): per press a mark before the key, the key (Android 10's
 * `input` returns once the app has handled it), a mark after it, the app's JS, UI and RenderThread run time
 * from schedstat before the key and at the window's end, and framestats dumped through the window (its
 * buffer holds about two seconds of continuous frames). */
export function lightScript(steps: Step[], hold = true): string {
  const lines = [
    '#!/system/bin/sh',
    'C=/data/local/tmp/tv-nav-cpu.txt; F=/data/local/tmp/tv-nav-frames.txt; : > $C; : > $F',
    // The app's main thread, its busiest JS thread and its RenderThread. sort, not shell arithmetic: a
    // 32-bit userland's mksh compares in 32 bits, and run times in ns pass 2^31 within seconds.
    `threads() { P=$(pidof ${PACKAGE}); JS=$(for t in /proc/$P/task/*; do [ "$(cat $t/comm 2>/dev/null)" = mqt_v_js ] && ` +
      `echo "$(cut -d' ' -f1 $t/schedstat) \${t##*/}"; done | sort -n | tail -1 | cut -d' ' -f2); R=; ` +
      `for t in /proc/$P/task/*; do [ "$(cat $t/comm 2>/dev/null)" = RenderThread ] && R=\${t##*/}; done; }`,
    'run() { [ -n "$P" ] && cut -d" " -f1 /proc/$P/task/$1/schedstat 2>/dev/null || echo 0; }',
    'cpu() { echo "$1 $2 $(run $JS) $(run $P) $(run $R)" >> $C; }',
    `frames() { dumpsys gfxinfo ${PACKAGE} framestats | grep -E '^(Flags|[0-9]+,|---)' >> $F; }`,
    // While a launch window runs (LAUNCH=1), each chunk also logs the threads' run time, for when JS went quiet.
    'wait_() { left=$1; while [ $left -gt 0 ]; do chunk=$(( left > 1500 ? 1500 : left )); sleep $(( chunk / 1000 )).$(printf %03d $(( chunk % 1000 ))); frames; ' +
      '[ -n "$LAUNCH" ] && { threads; log -t VELACPU "$(run $JS) $(run $P) $(run $R)"; }; left=$(( left - chunk )); done; }',
    'threads',
  ];
  let press = 0;
  for (const step of steps) {
    if ('focus' in step) continue;
    if ('link' in step) lines.push(`am start -a android.intent.action.VIEW -d '${step.link}' ${PACKAGE} >/dev/null 2>&1`, `sleep ${step.wait / 1000}`, 'threads');
    else if ('wait' in step) lines.push(`wait_ ${step.wait}`);
    else if ('launch' in step) {
      const n = press++;
      lines.push(`echo "p ${n} 0 0 0" >> $C`, `log -t ${MARK} ${n}`, `am start -n ${PACKAGE}/.MainActivity >/dev/null 2>&1`, `log -t VELAKEY ${n}`,
        'LAUNCH=1', `wait_ ${step.window}`, 'LAUNCH=', 'threads', `cpu e ${n}`);
    } else {
      const n = press++;
      const keys = Array.from({ length: step.burst ?? 1 }, () => `KEYCODE_${step.key}`).join(' ');
      lines.push(`log -t ${MARK} ${n}`, `cpu p ${n}`, step.burst || !hold ? `input keyevent ${keys}` : `input keyevent --duration 80 ${keys}`,
        `log -t VELAKEY ${n}`, `wait_ ${step.window ?? 1200}`, `cpu e ${n}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** A remote's input device: its event node and the scan code of each Android key it sends. */
export interface Remote { path: string; scan: Record<string, number> }

/** The device's remote, from `dumpsys input` and the key layout files it names: the first input device
 * whose layout sends the D-pad (`key <scan> DPAD_DOWN`). `layout` reads a layout file. A real remote's
 * events go through Android's own key repeat, so a held key repeats as a viewer's does; `input keyevent`
 * cannot hold a key and on Android 10 takes a second or more to send each press. */
export function findRemote(dumpsys: string, layout: (file: string) => string): Remote | undefined {
  for (const block of dumpsys.split(/\n\s+\d+: /).slice(1)) {
    const path = /Path: (\/dev\/input\/event\d+)/.exec(block)?.[1];
    const file = /KeyLayoutFile: (\S+)/.exec(block)?.[1];
    if (!path || !file) continue;
    const scan: Record<string, number> = {};
    for (const match of layout(file).matchAll(/^key\s+(\d+)\s+([A-Z_0-9]+)/gm)) scan[match[2]!] ??= Number(match[1]);
    if (scan.DPAD_DOWN !== undefined && scan.DPAD_UP !== undefined) return { path, scan };
  }
  return undefined;
}

/** The focus-mode device script: presses as the remote's key events (`hold` ms down, else 80 ms) on a
 * timeline kept against /proc/uptime (a slow box spends a tenth of a second starting each sendevent),
 * and at each checkpoint the focused node of a uiautomator dump, to /data/local/tmp/tv-nav-focus-<n>.txt. */
export function focusScript(steps: Step[], remote: Remote | undefined, shots = false): string {
  const lines = ['#!/system/bin/sh', `E=${remote?.path ?? ''}`,
    // Centiseconds of uptime: small enough for a 32-bit shell's arithmetic.
    'now() { read u _ < /proc/uptime; echo ${u%.*}${u#*.}; }',
    'at() { while [ $(now) -lt $(( B + $1 )) ]; do sleep 0.02; done; }',
    'down() { sendevent $E 1 $1 1; sendevent $E 0 0 0; }',
    // A busy app can keep uiautomator from finding the UI idle: one more try, else the failure is the record.
    // No focused node: what Android itself has focused. A slow box's accessibility tree can miss a focus
    // just moved (tx1-box, a card focused as its row was drawn): the app's view with the focused flag.
    `dump() { for i in 1 2; do o=$(uiautomator dump /data/local/tmp/tv-nav-ui.xml 2>&1); case "$o" in *dumped*) grep -o '<node [^>]*focused="true"[^>]*>' /data/local/tmp/tv-nav-ui.xml > $1; ` +
      `[ -s $1 ] || { dumpsys window | grep -m1 mCurrentFocus; dumpsys activity top | awk '/ACTIVITY /{on = index($0, "${PACKAGE}/") > 0} on' | grep -m3 -E ' [.R]F[.S]'; } > \${1%.txt}.native 2>/dev/null; return;; esac; sleep 1; done; echo "dump failed: $o" > $1; }`,
    'up() { sendevent $E 1 $1 0; sendevent $E 0 0 0; }',
    'B=$(now)'];
  const cs = (ms: number) => Math.round(ms / 10);
  let t = 0;
  let check = 0;
  for (const step of steps) {
    if ('focus' in step) {
      const file = `/data/local/tmp/tv-nav-focus-${check++}.txt`;
      lines.push(`at ${cs(t)}`, ...(shots ? [`screencap -p ${file.replace(/\.txt$/, '.png')}`] : []), `dump ${file}`, 'B=$(now)');
      t = 0;
    } else if ('link' in step) {
      lines.push(`at ${cs(t)}`, `am start -a android.intent.action.VIEW -d '${step.link}' ${PACKAGE} >/dev/null 2>&1`);
      t += step.wait;
    } else if ('wait' in step) t += step.wait;
    else if ('launch' in step) {
      lines.push(`at ${cs(t)}`, `am start -n ${PACKAGE}/.MainActivity >/dev/null 2>&1`);
      t += step.window;
    } else {
      const scan = remote?.scan[step.key];
      if (remote && scan === undefined) throw new Error(`the remote sends no ${step.key}`);
      const hold = step.hold ?? 80;
      const window = step.window ?? 1200;
      const gap = window / (step.burst ?? 1);
      for (let i = 0; i < (step.burst ?? 1); i++) {
        lines.push(`at ${cs(t + i * gap)}`);
        // Without a writable remote (an emulator's SELinux keeps the shell off /dev/input): input
        // keyevent, held with --duration (Android 12+); a slow box cannot keep the pace this way.
        if (!remote) lines.push(`input keyevent --duration ${Math.min(hold, gap)} KEYCODE_${step.key}`);
        else lines.push(`down ${scan}`, `at ${cs(t + i * gap + Math.min(hold, gap))}`, `up ${scan}`);
      }
      t += window;
    }
  }
  lines.push(`at ${cs(t)}`);
  return lines.join('\n') + '\n';
}

export interface FocusCheck { label: string; focused: { cls: string; desc: string; bounds: [number, number, number, number] }[]; error?: string; native?: string }

/** The focused nodes of a checkpoint's grep of a uiautomator dump: none when focus was lost. */
export function parseFocused(text: string): FocusCheck['focused'] {
  return [...text.matchAll(/<node [^>]*>/g)].map(([node]) => {
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(node)?.[1] ?? '';
    const box = attr('bounds').match(/-?\d+/g)?.map(Number) ?? [];
    return { cls: attr('class').replace(/^.*\./, ''), desc: attr('content-desc') || attr('text'), bounds: [box[0] ?? 0, box[1] ?? 0, box[2] ?? 0, box[3] ?? 0] as [number, number, number, number] };
  });
}

export function formatFocus(name: string, label: string, serial: string, checks: FocusCheck[]): string {
  const rows = checks.map(check => `| ${check.label} | ${check.error ? `(${check.error})` : check.focused.length ? check.focused.map(f => `${f.cls} "${f.desc}" [${f.bounds.join(',')}]`).join('; ') : check.native ? `no focused node in the accessibility tree; Android has focus on ${check.native}` : '**nothing focused**'} |`);
  return [`### ${name} focus (${label}, ${serial}, ${new Date().toISOString()})`, '', '| checkpoint | focused |', '| --- | --- |', ...rows].join('\n');
}

async function measureFocus(o: Options, name: string, label: string): Promise<FocusCheck[]> {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`unknown scenario ${name}; have ${Object.keys(SCENARIOS).join(', ')}`);
  const d = o.device;
  const found = findRemote(d.shell('dumpsys input'), file => d.shell(`cat ${file}`));
  const remote = found && d.shell(`sendevent ${found.path} 0 0 0 2>/dev/null && echo ok; true`).trim() === 'ok' ? found : undefined;
  if (!remote && Number(d.shell('getprop ro.build.version.sdk').trim()) < 31) throw new Error('no writable remote input device, and input keyevent cannot hold keys before Android 12');
  if (!remote) console.error('no writable remote input device: presses go through input keyevent');
  const work = mkdtempSync(join(tmpdir(), 'tv-nav-'));
  try {
    d.shell(`am force-stop ${PACKAGE}`);
    d.shell(`am start -n ${PACKAGE}/.MainActivity`);
    await Bun.sleep(o.settle ?? scenario.settle);
    d.shell('rm -f /data/local/tmp/tv-nav-focus-*.txt /data/local/tmp/tv-nav-focus-*.native /data/local/tmp/tv-nav-focus-*.png /data/local/tmp/tv-nav-focus.sh.done');
    writeFileSync(join(work, 'focus.sh'), focusScript([...(scenario.setup ?? []), ...scenario.steps], remote, !!o.keep));
    d.push(join(work, 'focus.sh'), '/data/local/tmp/tv-nav-focus.sh');
    d.shell(`(nohup sh -c 'sh /data/local/tmp/tv-nav-focus.sh; echo ok > /data/local/tmp/tv-nav-focus.sh.done' > /dev/null 2>&1 &)`);
    while (d.shell('cat /data/local/tmp/tv-nav-focus.sh.done 2>/dev/null; true').trim() !== 'ok') await Bun.sleep(1500);
    const labels = scenario.steps.flatMap(s => ('focus' in s ? [s.focus] : []));
    // --keep: each checkpoint's screen beside the report, <scenario>-<label>-<n>.png.
    if (o.keep) for (let i = 0; i < labels.length; i++) await d.pull(`/data/local/tmp/tv-nav-focus-${i}.png`, join(o.keep, `${name}-${label}-${i}.png`));
    return labels.map((check, i) => {
      const text = d.shell(`cat /data/local/tmp/tv-nav-focus-${i}.txt 2>/dev/null; true`);
      const error = /^dump failed: (.*)/.exec(text.trim())?.[1];
      const native = d.shell(`cat /data/local/tmp/tv-nav-focus-${i}.native 2>/dev/null; true`).replace(/\s+/g, ' ').trim();
      return { label: check, focused: parseFocused(text), ...(error !== undefined ? { error: `uiautomator: ${error.trim() || 'no output'}` } : {}), ...(native ? { native } : {}) };
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function measureLight(o: Options, name: string, label: string): Promise<RunReport> {
  const scenario = withWatch(SCENARIOS[name], name, o.watch);
  if (!scenario) throw new Error(`unknown scenario ${name}; have ${Object.keys(SCENARIOS).join(', ')}`);
  const work = mkdtempSync(join(tmpdir(), 'tv-nav-'));
  const d = o.device;
  try {
    const presses = scenario.steps.filter((s): s is Extract<Step, { key: string } | { launch: true }> => 'key' in s || 'launch' in s);
    const hold = Number(d.shell('getprop ro.build.version.sdk').trim()) >= 31;
    d.shell(`am force-stop ${PACKAGE}`);
    if (!scenario.cold) {
      d.shell(`am start -n ${PACKAGE}/.MainActivity`);
      await Bun.sleep(o.settle ?? scenario.settle);
    } else await Bun.sleep(3000);
    const runScript = async (file: string) => {
      d.shell(`rm -f ${file}.done; (nohup sh -c 'sh ${file}; echo ok > ${file}.done' > /dev/null 2>&1 &)`);
      while (d.shell(`cat ${file}.done 2>/dev/null; true`).trim() !== 'ok') await Bun.sleep(1500);
    };
    if (scenario.setup?.length) {
      writeFileSync(join(work, 'setup.sh'), deviceScript(scenario.setup, hold));
      d.push(join(work, 'setup.sh'), '/data/local/tmp/tv-nav-setup.sh');
      await runScript('/data/local/tmp/tv-nav-setup.sh');
    }
    writeFileSync(join(work, 'steps.sh'), lightScript(scenario.steps, hold));
    d.push(join(work, 'steps.sh'), '/data/local/tmp/tv-nav-steps.sh');
    d.shell('logcat -c');
    await runScript('/data/local/tmp/tv-nav-steps.sh');
    await d.pull('/data/local/tmp/tv-nav-frames.txt', join(work, 'frames.txt'));
    const cpu = parseCpuSamples(d.shell('cat /data/local/tmp/tv-nav-cpu.txt'));
    const frames = parseFramestats(readFileSync(join(work, 'frames.txt'), 'utf8'));
    const logcat = d.shell(`logcat -d -v monotonic -s ReactNativeJS:I ${MARK}:I ${MARK}:D VELAKEY:I VELAKEY:D VELACPU:I VELACPU:D`);
    const before = parseMarks(logcat, MARK);
    const handled = parseMarks(logcat, 'VELAKEY');
    const probe = parseProbe(logcat);
    const warnings: string[] = [];
    if (!frames.length) warnings.push('no frames in framestats');
    if (handled.length < presses.length) warnings.push(`saw ${handled.length} key marks for ${presses.length} presses`);
    const metrics: PressMetrics[] = [];
    presses.forEach((step, i) => {
      const from = handled[i];
      if (from === undefined) return;
      const window = ('window' in step ? step.window : undefined) ?? 1200;
      const to = before[i + 1] ?? from + window * 1e6;
      const quiet = window >= 4000 ? 1000 : o.quietMs;
      const press = analyzeLightPress(frames, cpu, i, step.label ?? ('key' in step ? step.key : 'launch'), from, to, quiet);
      // A launch is interactive once its JS thread goes quiet (contentMs here).
      if ('launch' in step) press.contentMs = jsQuietMs(parseJsSamples(logcat), from, to);
      const commits = probe.filter(commit => commit.ts >= from && commit.ts < to);
      const windowMs = Math.round(((before[i + 1] ?? to) - (before[i] ?? from)) / 1e5) / 10;
      metrics.push({ ...press, commits: commits.length, comps: commits.reduce((sum, c) => sum + c.comps, 0), windowMs });
    });
    const first = cpu.find(sample => sample.tag === 'p');
    const last = [...cpu].reverse().find(sample => sample.tag === 'e');
    const start = before[0] ?? 0;
    const end = (handled[handled.length - 1] ?? start) + (((presses[presses.length - 1] as { window?: number })?.window ?? 1200) * 1e6);
    const seconds = Math.max(0.001, (end - start) / 1e9);
    const per = (ns: number) => Math.round((ns / 1e6 / seconds) * 10) / 10;
    const totals: RunTotals = {
      seconds: Math.round(seconds * 10) / 10,
      framesPerSecond: Math.round((frames.filter(f => f.ts >= start && f.ts < end).length / seconds) * 10) / 10,
      jsMsPerSecond: first && last ? per(last.js - first.js) : 0,
      mainMsPerSecond: first && last ? per(last.main - first.main) : 0,
      renderMsPerSecond: first && last ? per(last.render - first.render) : 0,
    };
    return { label, totals, scenario: name, serial: d.serial, measuredAt: new Date().toISOString(), presses: metrics, summary: summarizePresses(metrics), warnings };
  } finally {
    if (o.keep) Bun.spawnSync(['cp', join(work, 'frames.txt'), join(o.keep, `${name}-${label}.framestats.txt`)]);
    rmSync(work, { recursive: true, force: true });
  }
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
union all select 'view', s.ts, s.dur from slice s join thread_track tt on s.track_id = tt.id
  where tt.utid in (select utid from main) and s.name like 'SurfaceMountingManager::createViewUnsafe%'
union all select 'js', ts, dur from sched where utid in (select utid from js)
union all select 'main', ts, dur from sched where utid in (select utid from main)
union all select 'render', ts, dur from sched where utid in (select utid from render)
union all select * from (select 'clock', ts - clock_value, 0 from clock_snapshot where clock_name = 'MONOTONIC' limit 1)
order by ts;
`;

export function parseEvents(csv: string): TraceEvents {
  const events: TraceEvents = { keys: [], focus: [], mounts: [], frames: [], views: [], sched: { js: [], main: [], render: [] }, monotonicOffset: 0 };
  for (const line of csv.split('\n')) {
    const match = /^"(\w+)",(\d+),(-?\d+)/.exec(line.trim());
    if (!match) continue;
    const span: Span = { ts: Number(match[2]), dur: Math.max(0, Number(match[3])) };
    switch (match[1]) {
      case 'key': events.keys.push(span); break;
      case 'focus': events.focus.push(span); break;
      case 'mount': events.mounts.push(span); break;
      case 'frame': events.frames.push(span); break;
      case 'view': events.views!.push(span); break;
      case 'js': case 'main': case 'render': events.sched[match[1]].push(span); break;
      case 'clock': events.monotonicOffset = span.ts; break;
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
  const scenario = withWatch(SCENARIOS[name], name, o.watch);
  if (!scenario) throw new Error(`unknown scenario ${name}; have ${Object.keys(SCENARIOS).join(', ')}`);
  const work = mkdtempSync(join(tmpdir(), 'tv-nav-'));
  const d = o.device;
  try {
    const presses = scenario.steps.filter((s): s is Extract<Step, { key: string } | { launch: true }> => 'key' in s || 'launch' in s);
    // Slow devices take a second or more to start each `input`: the trace runs long and is stopped
    // when the script is done.
    const seconds = 3 * scenario.steps.reduce((t, s) => t + ('key' in s ? (s.window ?? 1200) + 600 * (s.burst ?? 1) : 'launch' in s ? s.window : 'wait' in s ? s.wait : 0), 0) / 1000 + 30;
    const hold = Number(d.shell('getprop ro.build.version.sdk').trim()) >= 31;
    d.shell(`am force-stop ${PACKAGE}`);
    if (!scenario.cold) {
      d.shell(`am start -n ${PACKAGE}/.MainActivity`);
      await Bun.sleep(o.settle ?? scenario.settle);
    } else await Bun.sleep(3000);
    const runScript = async (file: string) => {
      // In the background with a done marker: a run can outlast one shell call (`lab shell` stops at 120 s).
      d.shell(`rm -f ${file}.done; (nohup sh -c 'sh ${file}; echo ok > ${file}.done' > /dev/null 2>&1 &)`);
      while (d.shell(`cat ${file}.done 2>/dev/null; true`).trim() !== 'ok') await Bun.sleep(1500);
    };
    if (scenario.setup?.length) {
      writeFileSync(join(work, 'setup.sh'), deviceScript(scenario.setup, hold));
      d.push(join(work, 'setup.sh'), '/data/local/tmp/tv-nav-setup.sh');
      await runScript('/data/local/tmp/tv-nav-setup.sh');
    }
    writeFileSync(join(work, 'steps.sh'), deviceScript(scenario.steps, hold));
    writeFileSync(join(work, 'trace.cfg'), traceConfig(seconds, o.bufferMb));
    d.push(join(work, 'steps.sh'), '/data/local/tmp/tv-nav-steps.sh');
    d.push(join(work, 'trace.cfg'), '/data/local/tmp/tv-nav.cfg');
    // Some Android 10 builds ship no perfetto-traces directory: the shell's own temp dir then.
    const traces = d.shell('[ -d /data/misc/perfetto-traces ] && echo /data/misc/perfetto-traces || echo /data/local/tmp').trim();
    const out = `${traces}/tv-nav.pftrace`;
    d.shell(`rm -f ${out}`);
    d.shell('logcat -c');
    // The config on stdin, through a pipe: Android 10 has no /data/misc/perfetto-configs, and newer
    // Androids do not let perfetto read a shell file handed over by redirection.
    const pid = d.shell(`cat /data/local/tmp/tv-nav.cfg | perfetto --txt -c - -o ${out} --background`).trim().split('\n').pop()!.trim();
    await Bun.sleep(1500);
    await runScript('/data/local/tmp/tv-nav-steps.sh');
    await Bun.sleep(2000);
    // Stop our own session (it flushes on SIGTERM), then wait for the file to settle.
    if (/^\d+$/.test(pid)) d.shell(`kill -TERM ${pid} 2>/dev/null; true`);
    for (let i = 0; i < 30 && d.shell(`ls /proc/${pid} >/dev/null 2>&1 && echo up || echo done`).trim() === 'up'; i++) await Bun.sleep(500);
    // The service may still be finishing the file as the command exits: try a few times.
    for (let attempt = 1; ; attempt++) {
      try { await d.pull(out, join(work, 'trace.pftrace')); break; } catch (error) {
        if (attempt >= 10) throw error;
        await Bun.sleep(1000);
      }
    }
    const logcat = d.shell(`logcat -d -v monotonic -s ReactNativeJS:I ${MARK}:I ${MARK}:D`);
    writeFileSync(join(work, 'events.sql'), EVENTS_SQL);
    const events = parseEvents(run([o.tp, '-q', join(work, 'events.sql'), join(work, 'trace.pftrace')]));
    // Logcat's monotonic times on the trace's clock.
    const shift = events.monotonicOffset ?? 0;
    const probe = parseProbe(logcat).map(c => ({ ...c, ts: c.ts + shift }));
    const probeJs = parseProbeJs(logcat).map(w => ({ ...w, ts: w.ts + shift }));
    const marks = parseMarks(logcat, MARK).map(m => m + shift);
    const starts = marks.length ? anchorPresses(marks, pressStarts(events.keys)) : pressStarts(events.keys);
    const warnings: string[] = [];
    if (!events.sched.js.length) warnings.push('no JS thread scheduling in the trace');
    if (!events.keys.length) warnings.push('no input slices in the trace: presses start at their markers');
    // A burst is one step: key-downs within its sending time belong to it.
    const metrics: PressMetrics[] = [];
    let at = 0;
    for (const step of presses) {
      const from = starts[at];
      if (from === undefined) {
        warnings.push(`saw ${starts.length} press starts in the trace; ran out at "${step.label ?? ('key' in step ? step.key : 'launch')}"`);
        break;
      }
      const span = 'burst' in step && step.burst ? step.burst * 150 * 1e6 : 0;
      if (marks.length) at++;
      else do at++; while (starts[at] !== undefined && starts[at] <= from + span);
      const next = starts[at];
      const to = next ?? from + (step.window ?? 1200) * 1e6;
      metrics.push(analyzePress(events, probe, step.label ?? ('key' in step ? step.key : 'launch'), from, to, o.quietMs, probeJs));
    }
    // From the script's start (the trace began 1.5 s before it) to the trace's last scheduling.
    const traceEnd = events.sched.main.reduce((end, span) => Math.max(end, span.ts + span.dur), 0);
    const scriptStart = events.sched.main.reduce((start, span) => Math.min(start, span.ts), Infinity) + 1.5e9;
    const totals = runTotals(events, starts[0] ?? scriptStart, traceEnd);
    return { label, totals, scenario: name, serial: d.serial, measuredAt: new Date().toISOString(), presses: metrics, summary: summarizePresses(metrics), warnings };
  } finally {
    if (o.keep) Bun.spawnSync(['cp', join(work, 'trace.pftrace'), join(o.keep, `${name}-${label}.pftrace`)]);
    rmSync(work, { recursive: true, force: true });
  }
}

const cell = (s: Summary | undefined) => (!s || s.median === null ? '–' : `${s.median} / ${s.p90}`);

export function formatReport(report: RunReport): string {
  const head = `| press | ${METRICS.join(' | ')} | heaviest commit | JS time |`;
  const rule = `|${' --- |'.repeat(METRICS.length + 3)}`;
  const rows = report.presses.map(p => `| ${p.label} | ${METRICS.map(m => p[m] ?? '–').join(' | ')} | ${p.top} | ${p.jsTop ?? ''} |`);
  const summary = `| **median / p90** | ${METRICS.map(m => cell(report.summary[m])).join(' | ')} | | |`;
  const totals = `| **total** | ${METRICS.map(m => report.summary[m]?.total ?? '–').join(' | ')} | | |`;
  const t = report.totals;
  const whole = t ? `whole run ${t.seconds} s: ${t.framesPerSecond} frames/s, CPU ms/s JS ${t.jsMsPerSecond}, main ${t.mainMsPerSecond}, RenderThread ${t.renderMsPerSecond}` : '';
  return [`### ${report.scenario} (${report.label}, ${report.serial}, ${report.measuredAt})`, ...report.warnings.map(w => `> ${w}`), whole, '', head, rule, ...rows, summary, totals].join('\n');
}

export function formatComparison(before: RunReport, after: RunReport): string {
  const lines = [`### ${after.scenario}: ${before.label} → ${after.label} (median / p90; total)`, '', '| metric | before | after |', '| --- | --- | --- |'];
  // Reports from before a metric existed have no summary for it.
  for (const m of METRICS) lines.push(`| ${m} | ${cell(before.summary[m])}; ${before.summary[m]?.total ?? '–'} | ${cell(after.summary[m])}; ${after.summary[m]?.total ?? '–'} |`);
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
      lab: { type: 'string' },
      owner: { type: 'string', default: process.env.LAB_OWNER ?? '' },
      'device-ip': { type: 'string' },
      settle: { type: 'string' },
      'buffer-mb': { type: 'string', default: '96' },
      light: { type: 'boolean', default: false },
      focus: { type: 'boolean', default: false },
      watch: { type: 'string' },
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
    if (!values.serial && !values.lab) throw new Error('--serial (or ANDROID_SERIAL), or --lab <device> --owner <claim owner>, is required');
    if (values.lab && !values.owner) throw new Error('--lab needs --owner (the claim owner) or LAB_OWNER');
    const device = values.lab ? labDevice(values.lab, values.owner!, values['device-ip']) : adbDevice(values.adb!, values.serial!);
    const options: Options = {
      device, tp: values.tp!, quietMs: Number(values.quiet), keep: values.keep,
      settle: values.settle ? Number(values.settle) : undefined, bufferMb: Number(values['buffer-mb']), light: values.light, watch: values.watch,
    };
    if (values.focus) {
      const all: Record<string, FocusCheck[]> = {};
      for (const name of values.scenario!.split(',')) {
        all[name] = await measureFocus(options, name, values.label!);
        console.log(formatFocus(name, values.label!, device.serial, all[name]!) + '\n');
      }
      if (values.out) writeFileSync(values.out, JSON.stringify(all, null, 2));
      process.exit(0);
    }
    const reports: RunReport[] = [];
    for (const name of values.scenario!.split(',')) {
      const report = await (options.light ? measureLight : measure)(options, name, values.label!);
      reports.push(report);
      console.log(formatReport(report) + '\n');
    }
    if (values.out) writeFileSync(values.out, JSON.stringify(reports, null, 2));
  }
}
