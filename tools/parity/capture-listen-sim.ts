// Capture the Listen parity views in an iOS or tvOS simulator, or an Android TV emulator (adb), as
// capture-sim.ts does for Sports: Metro is started for one view's start route (and its listening
// state, EXPO_PUBLIC_VELA_PARITY_AUDIO), the Debug app is relaunched on it, and the screen is shot
// twice, 700 ms apart. Views with steps are web-only unless they give `keys` (tvOS: axe HID keys).
//
//   bun tools/parity/capture-listen-sim.ts --udid <udid|adb serial> --platform ios|ios-fold|tvos|androidtv --variant legacy|document --out <dir>
//     [--mock http://127.0.0.1:7951] [--metro-port 8952] [--views home,album] [--settle 9000] [--app <Vela.app>] [--display <id>]
//
// The mock must run with LISTEN_MOCK_ENV and silent media (listen-mock.ts). The simulator plays the
// queued track's file through the Mac's speakers if it ever plays: the parity hook pauses it before
// it loads, the media are silent, and Debug start-route builds start muted (quiet-playback.ts).
// ios-fold unfolds the iPhone Duo first (axe hinge set 180) and shoots its inner display.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { captureName } from './views';
import { LISTEN_NOW, LISTEN_VIEWS, listenPath, type ListenView } from './listen-views';

const { values } = parseArgs({ options: {
  udid: { type: 'string' }, platform: { type: 'string', default: 'tvos' }, variant: { type: 'string', default: 'legacy' }, out: { type: 'string' },
  mock: { type: 'string', default: 'http://127.0.0.1:7951' }, views: { type: 'string' }, settle: { type: 'string', default: '9000' },
  'metro-port': { type: 'string', default: '8952' }, display: { type: 'string' }, app: { type: 'string' },
} });
if (!values.udid || !values.out) throw new Error('--udid and --out are required');
const variant = values.variant!, platform = values.platform!, udid = values.udid;
const out = resolve(values.out);
mkdirSync(join(out, 'frames'), { recursive: true });
const settle = Number(values.settle);
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer' };
const root = resolve(import.meta.dir, '../..');
const port = values['metro-port']!;
const viewport = platform === 'ios' ? 'ios-phone' : platform;

/** Metro for one start route and listening state; returns a stop function (only its own PID). */
async function metroFor(route: string, audio: string): Promise<() => void> {
  const log: string[] = [];
  const child = Bun.spawn(['bun', 'x', 'expo', 'start', '--port', port, '--clear', '--no-dev'], {
    cwd: join(root, 'apps/vela'), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, EXPO_PUBLIC_VELA_SERVER: values.mock!, EXPO_PUBLIC_VELA_MOCK: '1', EXPO_PUBLIC_VELA_START_ROUTES: route,
      EXPO_PUBLIC_VELA_PARITY_AUDIO: audio, ...(variant === 'document' ? { EXPO_PUBLIC_VELA_LISTEN: 'documents' } : {}), CI: '1' },
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
const axe = (...args: string[]) => run(['axe', ...args, '--udid', udid]);

interface Device { relaunch(): void; shoot(file: string): void; keys?(codes: number[]): Promise<void> }
const APP = 'app.ether.vela';
const apple: Device = {
  relaunch() {
    try { simctl('terminate', udid, APP); } catch {}
    simctl('spawn', udid, 'defaults', 'write', APP, 'RCT_jsLocation', `localhost:${port}`);
    simctl('spawn', udid, 'defaults', 'write', APP, 'RCT_enableDev', '-bool', 'NO');
    simctl('launch', udid, APP);
  },
  // simctl cannot write into ~/.scratch (TCC), so shoot to /tmp and copy.
  shoot(file) {
    const temporary = `/tmp/l2-parity-${process.pid}.png`;
    simctl('io', udid, 'screenshot', '--type=png', ...(values.display ? [`--display=${values.display}`] : []), temporary);
    copyFileSync(temporary, file);
    rmSync(temporary);
  },
  async keys(codes) { for (const code of codes) { axe('key', String(code)); await Bun.sleep(900); } },
};
const android: Device = {
  relaunch() {
    adb('shell', 'am', 'force-stop', APP);
    adb('reverse', `tcp:${port}`, `tcp:${port}`);
    const mockPort = new URL(values.mock!).port;
    if (mockPort) adb('reverse', `tcp:${mockPort}`, `tcp:${mockPort}`);
    const prefs = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?><map><string name="debug_http_host">localhost:${port}</string><boolean name="js_dev_mode_debug" value="false" /></map>`;
    const temporary = join(out, '.prefs.xml');
    writeFileSync(temporary, prefs);
    adb('push', temporary, '/data/local/tmp/l2-parity-prefs.xml');
    rmSync(temporary);
    adb('shell', `run-as ${APP} sh -c 'mkdir -p shared_prefs && cp /data/local/tmp/l2-parity-prefs.xml shared_prefs/${APP}_preferences.xml'`);
    adb('shell', 'monkey', '-p', APP, '-c', 'android.intent.category.LEANBACK_LAUNCHER', '1');
  },
  shoot(file) { writeFileSync(file, adb('exec-out', 'screencap', '-p')); },
  async keys(codes) {
    // HID usage codes (as axe takes them) to Android key codes: Return, Escape, arrows.
    const map: Record<number, number> = { 40: 23, 41: 4, 79: 22, 80: 21, 81: 20, 82: 19 };
    for (const code of codes) { adb('shell', 'input', 'keyevent', String(map[code] ?? code)); await Bun.sleep(900); }
  },
};
const device = platform === 'androidtv' ? android : apple;
if (platform === 'androidtv') {
  adb('shell', 'pm', 'clear', APP);
  adb('shell', 'monkey', '-p', APP, '-c', 'android.intent.category.LEANBACK_LAUNCHER', '1');
  await Bun.sleep(20_000);
  adb('shell', 'am', 'force-stop', APP);
} else {
  simctl('keychain', udid, 'reset');
  if (values.app) { try { simctl('uninstall', udid, APP); } catch {} simctl('install', udid, values.app); }
  if (platform === 'ios-fold') axe('hinge', 'set', '180');
}

/** A view on this platform: TV and phone views without web-only steps, and the platform's own list. */
function runs(view: ListenView): boolean {
  if (view.only && !view.only.some(name => name === viewport || (viewport === 'ios-fold' && name === 'web-951') || (viewport === 'ios-phone' && name === 'web-466'))) return false;
  if (view.scrollTo) return false;
  if (view.steps?.length && !(view.keys && device.keys)) return false;
  return true;
}
const views = LISTEN_VIEWS.filter(view => runs(view) && (!values.views || values.views.split(',').includes(view.name)));
const captures: object[] = [];
for (const view of views) {
  const file = captureName(viewport, view.name), frame = join('frames', file.replace(/\.png$/, '.b.png'));
  const route = listenPath(view);
  const audio = new URLSearchParams(route.split('?')[1] ?? '').get('parityAudio') ?? '';
  const capture: Record<string, unknown> = { viewport, view: view.name, file, frame, url: route, description: view.description, ok: false };
  try {
    const stop = await metroFor(route, audio);
    try {
      device.relaunch();
      // The bundle builds on first request (a cold cache), then home loads, then the route opens.
      await Bun.sleep(settle + 25_000);
      if (view.keys && device.keys) { await device.keys(view.keys); await Bun.sleep(2500); }
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
  }
  captures.push(capture);
}
const manifest = join(out, 'manifest.json');
const earlier = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as { captures: { view: string }[] }).captures : [];
const merged = [...earlier.filter(c => !captures.some(n => (n as { view: string }).view === c.view)), ...captures];
writeFileSync(manifest, JSON.stringify({ variant, experience: 'listen', platform, now: LISTEN_NOW, capturedAt: new Date().toISOString(), udid, captures: merged }, null, 2));
