// Capture the Sports parity views in an iOS or tvOS simulator, or an Android TV emulator (adb).
// A simulator takes no remote presses
// or touches from here and a deep link asks "Open in Vela?", so each view is opened by the app's
// own EXPO_PUBLIC_VELA_START_ROUTES: Metro is started for that one route, the Debug app (signed to
// run locally, RCT_jsLocation pointed at this Metro) is relaunched, and the view is shot. Scrolled
// views are web-only.
//
//   bun tools/parity/capture-sim.ts --udid <udid|adb serial> --platform tvos|ios|androidtv --variant legacy|document --out <dir>
//     [--mock http://127.0.0.1:7841] [--metro-port 8142] [--views index-top,game-live] [--settle 9000]
//
// The app must reach the frozen mock (VELA_MOCK_SPORTS_FREEZE=1). Nothing here starts playback: the
// views are browsing screens, and Debug builds keep playback quiet. Each view is captured twice,
// 700 ms apart, for the moving-region mask, as on the web.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { captureName, DEFAULT_KNOBS, VIEWS, webPath, type Knobs, type Variant } from './views';

const { values } = parseArgs({ options: {
  udid: { type: 'string' }, platform: { type: 'string', default: 'tvos' }, variant: { type: 'string', default: 'document' }, out: { type: 'string' },
  mock: { type: 'string', default: 'http://127.0.0.1:7841' }, views: { type: 'string' }, settle: { type: 'string', default: '9000' },
  'metro-port': { type: 'string', default: '8142' },
  /** The simulator display to shoot (a foldable iPhone shows the app on its cover display, "1"). */
  display: { type: 'string' },
} });
if (!values.udid || !values.out) throw new Error('--udid and --out are required');
const variant = values.variant as Variant, platform = values.platform!, udid = values.udid;
const out = resolve(values.out);
mkdirSync(join(out, 'frames'), { recursive: true });
const settle = Number(values.settle);
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer' };

/** The app route the document variant opens a page at (the web paths are the expo-router paths). */
export const appRoute = webPath;

const root = resolve(import.meta.dir, '../..');
const port = values['metro-port']!;
/** Metro for one start route; resolves once it serves, and returns a stop function (only its own PIDs). */
async function metroFor(route: string): Promise<() => void> {
  const log: string[] = [];
  const child = Bun.spawn(['bun', 'x', 'expo', 'start', '--port', port, '--clear', '--no-dev'], {
    cwd: join(root, 'apps/vela'), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, EXPO_PUBLIC_VELA_SERVER: values.mock!, EXPO_PUBLIC_VELA_MOCK: '1', EXPO_PUBLIC_VELA_START_ROUTES: route, CI: '1' },
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

function run(command: string[]): Buffer {
  const result = Bun.spawnSync(command, { env, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`${command.slice(0, 3).join(' ')}: ${result.stderr.toString().trim()}`);
  return result.stdout;
}
const simctl = (...args: string[]) => run(['xcrun', 'simctl', ...args]);
const adb = (...args: string[]) => run([process.env.ADB ?? 'adb', '-s', udid, ...args]);

/** The device: relaunch the app on this view's Metro, and shoot the screen. */
interface Device { relaunch(): void; shoot(file: string): void }
const APP = 'app.ether.vela';
const apple: Device = {
  relaunch() {
    try { simctl('terminate', udid, APP); } catch {}
    simctl('spawn', udid, 'defaults', 'write', APP, 'RCT_jsLocation', `localhost:${port}`);
    // A production bundle (no LogBox toasts over the capture), as a Release build runs.
    simctl('spawn', udid, 'defaults', 'write', APP, 'RCT_enableDev', '-bool', 'NO');
    simctl('launch', udid, APP);
  },
  // simctl cannot write into ~/.scratch (TCC), so shoot to /tmp and copy.
  shoot(file) {
    const temporary = `/tmp/w4-parity-${process.pid}.png`;
    simctl('io', udid, 'screenshot', '--type=png', ...(values.display ? [`--display=${values.display}`] : []), temporary);
    copyFileSync(temporary, file);
    rmSync(temporary);
  },
};
const android: Device = {
  relaunch() {
    adb('shell', 'am', 'force-stop', APP);
    // The emulator reaches this machine's Metro and mock on its own localhost.
    adb('reverse', `tcp:${port}`, `tcp:${port}`);
    const mockPort = new URL(values.mock!).port;
    if (mockPort) adb('reverse', `tcp:${mockPort}`, `tcp:${mockPort}`);
    // React Native's dev settings: this Metro, and a production bundle (no LogBox over the capture).
    const prefs = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map><string name="debug_http_host">localhost:${port}</string><boolean name="js_dev_mode_debug" value="false" /></map>`;
    const temporary = join(out, '.prefs.xml');
    writeFileSync(temporary, prefs);
    adb('push', temporary, '/data/local/tmp/w4-parity-prefs.xml');
    rmSync(temporary);
    adb('shell', `run-as ${APP} sh -c 'mkdir -p shared_prefs && cp /data/local/tmp/w4-parity-prefs.xml shared_prefs/${APP}_preferences.xml'`);
    adb('shell', 'monkey', '-p', APP, '-c', 'android.intent.category.LEANBACK_LAUNCHER', '1');
  },
  shoot(file) { writeFileSync(file, adb('exec-out', 'screencap', '-p')); },
};
const device = platform === 'androidtv' ? android : apple;
// Start from a fresh install's data: an earlier session's sign-out would stop the mock's demo sign-in.
if (platform === 'androidtv') adb('shell', 'pm', 'clear', APP);
async function admin(knobs: Knobs): Promise<{ now: string; frozen: boolean }> {
  const response = await fetch(`${values.mock}/__admin/sports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(knobs) });
  return response.json() as Promise<{ now: string; frozen: boolean }>;
}

const state = await admin(DEFAULT_KNOBS);
if (!state.frozen) throw new Error('start the mock with VELA_MOCK_SPORTS_FREEZE=1');
const viewport = platform === 'ios' ? 'ios-phone' : platform === 'androidtv' ? 'androidtv' : 'tvos';
const views = VIEWS.filter(view => !view.scrollTo && (!values.views || values.views.split(',').includes(view.name)));
const captures: object[] = [];
for (const view of views) {
  const file = captureName(viewport, view.name), frame = join('frames', file.replace(/\.png$/, '.b.png'));
  const url = appRoute(variant, view.page);
  const capture: Record<string, unknown> = { viewport, view: view.name, file, frame, url, description: view.description, ok: false };
  try {
    await admin({ ...DEFAULT_KNOBS, ...view.knobs });
    const stop = await metroFor(url);
    try {
      // Relaunch so every view starts from a cold page, as a browser reload does on the web.
      device.relaunch();
      // The bundle builds on first request (a cold cache), then home loads, then the route opens.
      await Bun.sleep(settle + 25_000);
      device.shoot(join(out, file));
      await Bun.sleep(700);
      device.shoot(join(out, frame));
    } finally {
      stop();
    }
    capture.ok = true;
    console.log(`ok   ${viewport} ${view.name}`);
  } catch (error) {
    capture.error = String((error as Error).message ?? error);
    console.log(`FAIL ${viewport} ${view.name}: ${capture.error}`);
  } finally {
    await admin(DEFAULT_KNOBS);
  }
  captures.push(capture);
}
// A run of some views adds to (or replaces) those views in an earlier run's manifest.
const manifest = join(out, 'manifest.json');
const earlier = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as { captures: { view: string }[] }).captures : [];
const merged = [...earlier.filter(c => !captures.some(n => (n as { view: string }).view === c.view)), ...captures];
writeFileSync(manifest, JSON.stringify({ variant, platform, now: state.now, capturedAt: new Date().toISOString(), udid, captures: merged }, null, 2));
