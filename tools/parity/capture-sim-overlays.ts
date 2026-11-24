// Capture the Sports overlay parity views (score bug, ticker, alert toast) in a tvOS simulator or an
// Android TV emulator. A simulator takes no remote presses from here, so each run opens a live
// channel through the app's EXPO_PUBLIC_VELA_START_ROUTES (Metro started for it, the Debug app
// relaunched on it, as capture-sim.ts does) and shoots a burst: the chrome stands at first and hides
// on its own after the TV's idle time, so one burst holds the chrome-up and chrome-hidden views. A
// run's burst is kept whole (burst/<run>/NN.png); `--pick` then names which shots are which view.
// Playback is silent: the mock serves silent media (VELA_MOCK_SILENT_MEDIA=1) and start-route
// builds start muted (quiet-playback.ts).
//
//   bun tools/parity/capture-sim-overlays.ts --udid <udid|serial> --platform tvos|androidtv --variant legacy|document --out <dir>
//     [--mock http://127.0.0.1:7861] [--metro-port 8163] [--runs live,spoiler,ticker,field] [--shots 22] [--every 2000]
//   bun tools/parity/capture-sim-overlays.ts --out <dir> --platform tvos --variant legacy --pick scorebug-chrome=live/03,scorebug-live=live/18,...
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_KNOBS, type Knobs } from './views';
import { OVERLAY_VIEWS } from './capture-overlays';

const { values } = parseArgs({ options: {
  udid: { type: 'string' }, platform: { type: 'string', default: 'tvos' }, variant: { type: 'string', default: 'legacy' }, out: { type: 'string' },
  mock: { type: 'string', default: 'http://127.0.0.1:7861' }, 'metro-port': { type: 'string', default: '8163' }, runs: { type: 'string' },
  shots: { type: 'string', default: '22' }, every: { type: 'string', default: '2000' }, settle: { type: 'string', default: '45000' }, pick: { type: 'string' },
} });
if (!values.out) throw new Error('--out is required');
const out = resolve(values.out), platform = values.platform!, variant = values.variant!;
const viewport = platform === 'androidtv' ? 'androidtv' : 'tvos';
mkdirSync(join(out, 'frames'), { recursive: true });

/** A run: a route opened on a fresh launch, with mock knobs, build flags and an alert sent once the picture plays. */
interface Run { name: string; route: string; knobs?: Knobs; env?: Record<string, string>; alert?: { kind: 'close'; eventId: string }; alertAt?: number }
const RUNS: Run[] = [
  { name: 'live', route: '/watch/channel-7?kind=channel' },
  { name: 'spoiler', route: '/watch/channel-7?kind=channel', knobs: { spoilerFree: true } },
  { name: 'ticker', route: '/watch/channel-7?kind=channel', env: { EXPO_PUBLIC_VELA_TICKER: '1' } },
  { name: 'field', route: '/watch/channel-20?kind=channel' },
  // The alert once the chrome has hidden (the TV's idle time is 6 s).
  { name: 'toast', route: '/watch/channel-20?kind=channel', alert: { kind: 'close', eventId: 'sports:sports:nhl-tor-mtl' }, alertAt: 5 },
];

if (values.pick) {
  // name=run/NN pairs: the shot and the one after it (the moving-region mask) become the view's capture.
  const captures = values.pick.split(',').map(pair => {
    const [view, at] = pair.split('=') as [string, string];
    // `run/NN!`: the shot alone (the next one shows another state), so only the other set masks its motion.
    const alone = at.endsWith('!');
    const [run, n] = at.replace(/!$/, '').split('/') as [string, string];
    const file = `${viewport}--${view}.png`, frame = join('frames', file.replace(/\.png$/, '.b.png'));
    const next = String(Number(n) + 1).padStart(2, '0');
    copyFileSync(join(out, 'burst', run, `${n}.png`), join(out, file));
    copyFileSync(join(out, 'burst', run, `${!alone && existsSync(join(out, 'burst', run, `${next}.png`)) ? next : n}.png`), join(out, frame));
    const described = OVERLAY_VIEWS.find(v => v.name === view);
    return { viewport, view, file, frame, url: RUNS.find(r => r.name === run)?.route ?? '', description: described?.description ?? view, ok: true, shot: at };
  });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ variant, platform, now: '2026-11-24T20:00:00.000Z', capturedAt: new Date().toISOString(), captures }, null, 2));
  console.log(`picked ${captures.length}`);
  process.exit(0);
}

if (!values.udid) throw new Error('--udid is required');
const udid = values.udid;
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer' };
const root = resolve(import.meta.dir, '../..');
const port = values['metro-port']!;

function run(command: string[]): Buffer {
  const result = Bun.spawnSync(command, { env, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`${command.slice(0, 3).join(' ')}: ${result.stderr.toString().trim()}`);
  return result.stdout;
}
const simctl = (...args: string[]) => run(['xcrun', 'simctl', ...args]);
const adb = (...args: string[]) => run([process.env.ADB ?? 'adb', '-s', udid, ...args]);
const APP = 'app.ether.vela';

async function metroFor(route: string, extra: Record<string, string>): Promise<() => void> {
  const log: string[] = [];
  const child = Bun.spawn(['bun', 'x', 'expo', 'start', '--port', port, '--clear', '--no-dev'], {
    cwd: join(root, 'apps/vela'), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, EXPO_PUBLIC_VELA_SERVER: values.mock!, EXPO_PUBLIC_VELA_MOCK: '1', EXPO_PUBLIC_VELA_START_ROUTES: route,
      ...(variant === 'document' ? { EXPO_PUBLIC_VELA_SCREENS: '1' } : {}), ...extra, CI: '1' },
  });
  const reader = async (stream: ReadableStream<Uint8Array>) => {
    const read = stream.getReader();
    for (let next = await read.read(); !next.done; next = await read.read()) log.push(new TextDecoder().decode(next.value));
  };
  void reader(child.stdout); void reader(child.stderr);
  const started = Date.now();
  while (!log.join('').includes(`localhost:${port}`) && Date.now() - started < 120_000) await Bun.sleep(500);
  return () => { child.kill(); };
}

const device = platform === 'androidtv' ? {
  relaunch() {
    adb('shell', 'am', 'force-stop', APP);
    adb('reverse', `tcp:${port}`, `tcp:${port}`);
    const mockPort = new URL(values.mock!).port;
    if (mockPort) adb('reverse', `tcp:${mockPort}`, `tcp:${mockPort}`);
    const prefs = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map><string name="debug_http_host">localhost:${port}</string><boolean name="js_dev_mode_debug" value="false" /></map>`;
    const temporary = join(out, '.prefs.xml');
    writeFileSync(temporary, prefs);
    adb('push', temporary, '/data/local/tmp/w6-parity-prefs.xml');
    rmSync(temporary);
    adb('shell', `run-as ${APP} sh -c 'mkdir -p shared_prefs && cp /data/local/tmp/w6-parity-prefs.xml shared_prefs/${APP}_preferences.xml'`);
    adb('shell', 'monkey', '-p', APP, '-c', 'android.intent.category.LEANBACK_LAUNCHER', '1');
  },
  stop() { adb('shell', 'am', 'force-stop', APP); },
  shoot(file: string) { writeFileSync(file, adb('exec-out', 'screencap', '-p')); },
} : {
  relaunch() {
    try { simctl('terminate', udid, APP); } catch {}
    simctl('spawn', udid, 'defaults', 'write', APP, 'RCT_jsLocation', `localhost:${port}`);
    simctl('spawn', udid, 'defaults', 'write', APP, 'RCT_enableDev', '-bool', 'NO');
    simctl('launch', udid, APP);
  },
  stop() { try { simctl('terminate', udid, APP); } catch {} },
  // simctl cannot write into ~/.scratch (TCC): shoot to /tmp and copy.
  shoot(file: string) {
    const temporary = `/tmp/w6-parity-${process.pid}.png`;
    simctl('io', udid, 'screenshot', '--type=png', temporary);
    copyFileSync(temporary, file);
    rmSync(temporary);
  },
};

async function admin(body: object): Promise<{ now: string; frozen: boolean }> {
  const response = await fetch(`${values.mock}/__admin/sports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json() as Promise<{ now: string; frozen: boolean }>;
}
const state = await admin(DEFAULT_KNOBS);
if (!state.frozen) throw new Error('start the mock with VELA_MOCK_SPORTS_FREEZE=1');
// A fresh sign-in: tokens from an earlier mock (or its sign-out) stop the mock's demo sign-in.
if (platform === 'androidtv') adb('shell', 'pm', 'clear', APP);
else { try { simctl('terminate', udid, APP); } catch {} simctl('keychain', udid, 'reset'); }

/** The document ticker is a viewer setting Ether remembers: switched on for the ticker run (and off after). */
async function tickerSetting(enabled: boolean): Promise<void> {
  const device = { id: 'w6-parity-device', name: 'Parity', platform: 'web', appVersion: '0.2.0' };
  const tokens = await (await fetch(`${values.mock}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'vela', device, idempotencyKey: crypto.randomUUID() }) })).json() as { accessToken: string };
  const key = crypto.randomUUID();
  const response = await fetch(`${values.mock}/vela/v0/surfaces/sports.ticker/setting`, { method: 'PUT',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id, 'X-Vela-Screen-Renderer': '19', 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ enabled, idempotencyKey: key }) });
  if (response.status !== 204) throw new Error(`ticker setting answered ${response.status}`);
}

const runs = RUNS.filter(r => !values.runs || values.runs.split(',').includes(r.name));
let metro = null as { key: string; stop(): void } | null;
try {
  for (const r of runs) {
    const key = JSON.stringify([r.route, r.env ?? {}]);
    if (metro?.key !== key) { metro?.stop(); metro = { key, stop: await metroFor(r.route, r.env ?? {}) }; }
    await admin({ ...DEFAULT_KNOBS, ...r.knobs });
    if (variant === 'document') await tickerSetting(r.name === 'ticker');
    const dir = join(out, 'burst', r.name);
    mkdirSync(dir, { recursive: true });
    device.relaunch();
    // The bundle builds on the first request, home loads, then the start route opens the channel.
    await Bun.sleep(Number(values.settle));
    const shots = Number(values.shots), every = Number(values.every);
    for (let n = 0; n < shots; n++) {
      if (r.alert && n === (r.alertAt ?? 2)) await admin({ alert: r.alert });
      device.shoot(join(dir, `${String(n).padStart(2, '0')}.png`));
      await Bun.sleep(every);
    }
    device.stop();
    console.log(`ok   ${viewport} ${r.name}: ${shots} shots`);
    await admin(DEFAULT_KNOBS);
  }
} finally {
  metro?.stop();
  device.stop();
}
