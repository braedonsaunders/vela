// Capture the Listen parity views in an iOS or tvOS simulator, or an Android TV emulator (adb), as
// capture-sim.ts does for Sports: Metro is started for one view's start route (and its listening
// state, EXPO_PUBLIC_VELA_PARITY_AUDIO), the Debug app is relaunched on it, and the screen is shot
// twice, 700 ms apart. Views with steps are web-only unless they give `keys` (tvOS: axe HID keys).
//
//   bun tools/parity/capture-listen-sim.ts --udid <udid|adb serial> --platform ios|ios-fold|tvos|androidtv --out <dir>
//     [--mock http://127.0.0.1:7951] [--metro-port 8952] [--views home,album] [--settle 9000] [--app <Vela.app>] [--display <id>]
//
// The mock must run with LISTEN_MOCK_ENV and silent media (listen-mock.ts). The simulator plays the
// queued track's file through the Mac's speakers if it ever plays: the parity hook pauses it before
// it loads, the media are silent, and Debug start-route builds start muted (quiet-playback.ts).
// ios-fold unfolds the iPhone Duo first (axe hinge set 180) and shoots its inner display.
// For Read, add --experience read and --variant legacy|document. Use --embedded --app <Vela.app>
// on the Duo with the matching production JS and Expo DOM reader assets embedded together.
// Boot the muted device under the platform's lock and start the frozen Read mock first.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { captureName } from './views';
import { LISTEN_NOW, LISTEN_VIEWS, listenPath, type ListenView } from './listen-views';
import { READ_NOW, READ_VIEWS, readReviewed } from './read-views';
import { settledFrames } from './settle';

const { values } = parseArgs({ options: {
  udid: { type: 'string' }, platform: { type: 'string', default: 'tvos' }, out: { type: 'string' },
  mock: { type: 'string', default: 'http://127.0.0.1:7951' }, views: { type: 'string' }, settle: { type: 'string', default: '9000' },
  'metro-port': { type: 'string', default: '8952' }, display: { type: 'string' }, app: { type: 'string' },
  experience: { type: 'string', default: 'listen' }, variant: { type: 'string', default: 'document' },
  embedded: { type: 'boolean', default: false },
} });
if (!values.udid || !values.out) throw new Error('--udid and --out are required');
const platform = values.platform!, udid = values.udid;
const out = resolve(values.out);
mkdirSync(join(out, 'frames'), { recursive: true });
const settle = Number(values.settle);
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer' };
const root = resolve(import.meta.dir, '../..');
const port = values['metro-port']!;
const viewport = platform === 'ios' ? 'ios-phone' : platform;
const experience = values.experience!;
if (experience !== 'listen' && experience !== 'read') throw new Error('--experience must be listen or read');
if (values.variant !== 'legacy' && values.variant !== 'document') throw new Error('--variant must be legacy or document');
const read = experience === 'read';
const phone = platform === 'ios' || platform === 'ios-fold';
if (read && phone && !values.embedded) throw new Error('Duo Read captures need --embedded and the app with its embedded reader assets');
if (values.embedded && (!read || platform === 'androidtv' || !values.app)) throw new Error('--embedded requires Read on an Apple simulator and --app');
const display = values.display ?? (read && phone ? platform === 'ios-fold' ? '3' : '1' : undefined);

/** Metro for one start route and listening state; returns a stop function (only its own PID). */
async function metroFor(route: string, audio: string): Promise<() => void> {
  const log: string[] = [];
  const expo = read ? [process.execPath, join(root, 'node_modules/.bin/expo')] : ['bun', 'x', 'expo'];
  const child = Bun.spawn([...expo, 'start', '--port', port, '--clear', '--no-dev'], {
    cwd: join(root, 'apps/vela'), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, EXPO_PUBLIC_VELA_SERVER: values.mock!, EXPO_PUBLIC_VELA_MOCK: '1', EXPO_PUBLIC_VELA_START_ROUTES: route,
      EXPO_PUBLIC_VELA_PARITY_AUDIO: audio, CI: '1' },
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
const tapReader = () => axe('tap', '-x', viewport === 'ios-fold' ? '470' : '200', '-y', '310');
const readerHasControl = (id: string) => new RegExp(`"AXUniqueId"\\s*:\\s*"${id}"`).test(axe('describe-ui', '--minimal-keys').toString());

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
    try {
      simctl('io', udid, 'screenshot', '--type=png', ...(display ? [`--display=${display}`] : []), temporary);
      copyFileSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
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
if (platform === 'androidtv' && !read) {
  adb('shell', 'pm', 'clear', APP);
  adb('shell', 'monkey', '-p', APP, '-c', 'android.intent.category.LEANBACK_LAUNCHER', '1');
  await Bun.sleep(20_000);
  adb('shell', 'am', 'force-stop', APP);
} else if (platform !== 'androidtv') {
  simctl('keychain', udid, 'reset');
  if (values.app) { try { simctl('uninstall', udid, APP); } catch {} simctl('install', udid, values.app); }
  if (phone && read) {
    axe('hinge', 'set', platform === 'ios-fold' ? '180' : '0');
    simctl('io', udid, 'screenConfig', `--display=${display}`, 'power', 'on');
    await Bun.sleep(3000);
  } else if (platform === 'ios-fold') {
    axe('hinge', 'set', '180');
  }
}

/** A view on this platform: TV and phone views without web-only steps, and the platform's own list. */
function runs(view: ListenView): boolean {
  if (view.only && !view.only.some(name => name === viewport || (viewport === 'ios-fold' && name === 'web-951') || (viewport === 'ios-phone' && name === 'web-466'))) return false;
  if (view.scrollTo) return false;
  if (view.steps?.length && !(view.keys && device.keys)) return false;
  return true;
}
const asked = (name: string) => !values.views || values.views.split(',').includes(name);
const views = LISTEN_VIEWS.filter(view => runs(view) && asked(view.name));
const captures: object[] = [];
if (read) await captureRead();
else for (const view of views) {
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
writeFileSync(manifest, JSON.stringify({ variant: values.variant, experience, platform,
  now: read ? READ_NOW : LISTEN_NOW, capturedAt: new Date().toISOString(), udid, captures: merged }, null, 2));

async function captureRead(): Promise<void> {
  const stop = values.embedded ? undefined : await metroFor('/library/books', '');
  const go = (path: string) => platform === 'androidtv'
    ? adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'vela://${path}'`, '-p', APP)
    : simctl('openurl', udid, `vela://${path}`);
  try {
    if (phone) simctl('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active',
      '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'discharging', '--batteryLevel', '100');
    if (values.embedded) simctl('launch', udid, APP);
    else device.relaunch();
    await Bun.sleep(settle + (values.embedded ? 4000 : 25_000));
    for (const view of READ_VIEWS.filter(view => asked(view.name) && (!view.only || view.only.includes(viewport)))) {
      const file = captureName(viewport, view.name), frame = join('frames', file.replace(/\.png$/, '.b.png'));
      const capture: Record<string, unknown> = { viewport, view: view.name, file, frame, url: view.path, description: view.description,
        review: readReviewed(view, viewport), ok: false };
      try {
        if (phone && (view.path.startsWith('/title/') || view.path.startsWith('/read/'))) {
          go('/library/books');
          await Bun.sleep(2000);
        }
        const media = view.name === 'series' ? '&media=series' : view.name === 'book' || view.name === 'standalone' ? '&media=book' : '';
        go(view.path + (phone ? media : ''));
        await Bun.sleep(settle);
        const reader = view.path.startsWith('/read/');
        const probe = join(out, '.settle.png');
        const take = () => {
          device.shoot(probe);
          return readFileSync(probe);
        };
        try {
          if (phone && view.readerChrome) {
            await settledFrames(take, () => Bun.sleep(700), { reader });
            for (let i = 0; i < 10 && !readerHasControl('reader-hint'); i++) await Bun.sleep(300);
            if (!readerHasControl('reader-hint')) throw new Error('reader controls did not auto-hide');
            tapReader();
          }
          if (phone && (view.name === 'reader-contents' || view.name === 'reader-appearance')) {
            await settledFrames(take, () => Bun.sleep(700), { reader });
            const button = view.name === 'reader-contents' ? 'reader-contents' : 'reader-type';
            try {
              axe('tap', '--id', button);
            } catch (error) {
              if (!String(error).includes('No accessibility element matched')) throw error;
              tapReader();
              axe('tap', '--id', button);
            }
            await Bun.sleep(2000);
          }
          const stable = await settledFrames(take, () => Bun.sleep(reader ? 1700 : 700), { reader });
          if (phone && view.readerChrome && (readerHasControl('reader-hint') || !readerHasControl('reader-progress'))) {
            throw new Error('reader chrome did not stay visible');
          }
          writeFileSync(join(out, file), stable.primary);
          writeFileSync(join(out, frame), stable.confirmed);
        } finally {
          rmSync(probe, { force: true });
        }
        capture.ok = true;
        console.log(`ok   ${viewport} ${view.name}`);
      } catch (error) {
        capture.error = String((error as Error).message ?? error);
        process.exitCode = 1;
        console.log(`FAIL ${viewport} ${view.name}: ${capture.error}`);
      }
      captures.push(capture);
    }
  } finally {
    stop?.();
    if (phone) simctl('status_bar', udid, 'clear');
  }
}
