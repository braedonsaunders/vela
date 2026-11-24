// Capture the Sports overlay parity views (score bug, scores ticker, alert toast) on the web with
// the host's playwright-cli (headless, muted Chrome).
//
//   bun tools/parity/capture-overlays.ts --variant legacy --out <dir> --app http://localhost:8145 --mock http://127.0.0.1:7845
//     [--views scorebug-live,ticker-live] [--viewports web-1440,web-390]
//
// The mock must run with VELA_MOCK_SPORTS_FREEZE=1. Each view is captured twice, 700 ms apart:
// the first frame is the capture, and what differs between the two (the LIVE dot, the ticker's
// scroll, the toast's countdown bar) is masked out of the comparison.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { decodePng, encodePng } from './png';
import { sheet } from './sheet';
import { captureName, DEFAULT_KNOBS, WEB_VIEWPORTS, type Knobs, type Variant } from './views';

export interface OverlayView {
  name: string;
  description: string;
  path: string;
  knobs?: Knobs & { alert?: { kind: 'started' | 'close' | 'final'; eventId: string } };
  ready: string;
  hideChrome?: boolean;
  toggleTicker?: boolean;
  review?: string;
}

export const OVERLAY_VIEWS: OverlayView[] = [
  {
    name: 'scorebug-live',
    description: 'Live player score bug (NFL live, team crests, score, Q4 · 2:14, Down/Ball situation, chrome hidden)',
    path: '/watch/channel-7?kind=channel',
    ready: '[data-testid="player-score-bug"]',
    hideChrome: true,
  },
  {
    name: 'scorebug-chrome',
    description: 'Live player score bug with player chrome standing (glided below top bar)',
    path: '/watch/channel-7?kind=channel',
    ready: '[data-testid="player-score-bug"]',
  },
  {
    name: 'scorebug-spoiler',
    description: 'Live player score bug with scores hidden and Reveal pill',
    path: '/watch/channel-7?kind=channel',
    knobs: { spoilerFree: true },
    ready: '[data-testid="score-bug-reveal"]',
  },
  {
    name: 'scorebug-field',
    description: 'Live player score bug for an N-competitor field event (F1 Las Vegas GP, Lap 31/50, VER P1)',
    path: '/watch/channel-20?kind=channel',
    ready: '[data-testid="player-score-bug"]',
    hideChrome: true,
  },
  {
    name: 'ticker-live',
    description: 'Scores ticker along the bottom of the live player',
    path: '/watch/channel-7?kind=channel',
    ready: '[data-testid="player-score-bug"]',
    toggleTicker: true,
    hideChrome: true,
  },
  {
    name: 'alert-toast',
    description: 'Live favourite-team alert toast at the top right with Watch and Multiview actions and countdown bar',
    path: '/watch/channel-20?kind=channel',
    knobs: { alert: { kind: 'close', eventId: 'sports:sports:nhl-tor-mtl' } },
    ready: '[data-testid="live-alert"]',
    hideChrome: true,
  },
];

const HIDE_MEDIA = `() => {
  const hide = root => {
    for (const el of root.querySelectorAll('video, canvas')) el.style.opacity = '0';
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) hide(el.shadowRoot);
  };
  hide(document);
}`;

interface Capture { viewport: string; view: string; file: string; frame: string; url: string; description: string; review?: string; ok: boolean; error?: string }

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    variant: { type: 'string', default: 'legacy' }, out: { type: 'string' }, app: { type: 'string', default: 'http://localhost:8145' },
    mock: { type: 'string', default: 'http://127.0.0.1:7845' }, views: { type: 'string' }, viewports: { type: 'string' },
  } });
  const variant = values.variant as Variant;
  if (variant !== 'legacy' && variant !== 'document') throw new Error('--variant is legacy or document');
  if (!values.out) throw new Error('--out <dir> is required');
  const out = resolve(values.out);
  mkdirSync(join(out, 'frames'), { recursive: true });
  const pick = <T extends { name: string }>(all: T[], list?: string) => list ? all.filter(item => list.split(',').includes(item.name)) : all;
  const views = pick(OVERLAY_VIEWS, values.views), viewports = pick(WEB_VIEWPORTS, values.viewports);

  async function admin(knobs: Record<string, unknown>): Promise<{ now: string; frozen: boolean }> {
    const response = await fetch(`${values.mock}/__admin/sports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(knobs) });
    if (!response.ok) throw new Error(`mock admin answered ${response.status}`);
    return response.json() as Promise<{ now: string; frozen: boolean }>;
  }

  const scratch = join(out, '.playwright');
  mkdirSync(scratch, { recursive: true });
  function cli(session: string, args: string[]): string {
    const run = Bun.spawnSync(['playwright-cli', `-s=${session}`, ...args], { cwd: scratch, stdout: 'pipe', stderr: 'pipe' });
    const text = `${run.stdout.toString()}${run.stderr.toString()}`;
    if (run.exitCode !== 0 || /^### Error/m.test(text)) throw new Error(text.split('\n').filter(line => !/[═║]/.test(line)).slice(0, 12).join('\n'));
    return text;
  }
  const result = (text: string) => { const match = /### Result\n([^\n]*)/.exec(text); return match ? JSON.parse(match[1]!) : undefined; };

  const state = await admin(DEFAULT_KNOBS);
  if (!state.frozen) throw new Error('start the mock with VELA_MOCK_SPORTS_FREEZE=1');

  const sessions = new Map<boolean, string>();
  function session(touch: boolean): string {
    let name = sessions.get(touch);
    if (name) return name;
    name = `w5-parity-${touch ? 'touch' : 'desk'}-${process.pid}`;
    const config = join(scratch, `${name}.json`);
    writeFileSync(config, JSON.stringify({ browser: { browserName: 'chromium',
      launchOptions: { channel: 'chrome', headless: true, args: ['--mute-audio'] },
      contextOptions: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion: 'no-preference' } } }));
    cli(name, ['open', `--config=${config}`]);
    sessions.set(touch, name);
    return name;
  }

  const captures: Capture[] = [];
  try {
    for (const viewport of viewports) {
      const name = session(!!viewport.touch);
      for (const view of views) {
        const file = captureName(viewport.name, view.name), frame = join('frames', file.replace(/\.png$/, '.b.png'));
        const url = `${values.app}${view.path}`;
        const alertKnob = view.knobs?.alert;
        const baseKnobs = { ...DEFAULT_KNOBS, ...view.knobs };
        delete (baseKnobs as Record<string, unknown>).alert;
        const code = `async page => {
          await page.setViewportSize({ width: ${viewport.width}, height: ${viewport.height} });
          await page.goto(${JSON.stringify(url)});
          await page.locator('[data-testid="player-score-bug"]').first().waitFor({ state: 'visible', timeout: 45000 });
          await page.locator('[data-testid="vela-launch"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(${HIDE_MEDIA});
          ${view.toggleTicker ? `
          const tickerShown = await page.locator('[data-testid="live-ticker"]').first().isVisible().catch(() => false);
          if (!tickerShown) {
            const btn = page.locator('[data-testid="player-ticker-button"]').first();
            await btn.waitFor({ state: 'visible', timeout: 30000 });
            await btn.click();
          }
          await page.locator('[data-testid="live-ticker"]').first().waitFor({ state: 'visible', timeout: 15000 });
          ` : `
          const tickerShown = await page.locator('[data-testid="live-ticker"]').first().isVisible().catch(() => false);
          if (tickerShown) {
            const btn = page.locator('[data-testid="player-ticker-button"]').first();
            if (await btn.isVisible().catch(() => false)) await btn.click();
          }
          `}
          ${alertKnob ? `
          await page.waitForTimeout(400);
          await page.evaluate(async ({ mock, alert }) => {
            await fetch(mock + '/__admin/sports', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ alert }),
            });
          }, { mock: ${JSON.stringify(values.app)}, alert: ${JSON.stringify(alertKnob)} });
          ` : ''}
          await page.locator(${JSON.stringify(view.ready)}).first().waitFor({ state: 'visible', timeout: 30000 });
          ${view.hideChrome ? `await page.waitForTimeout(4200);` : `await page.mouse.move(200, 200); await page.waitForTimeout(800);`}
          await page.evaluate(${HIDE_MEDIA});
          await page.screenshot({ path: ${JSON.stringify(join(out, file))} });
          await page.waitForTimeout(700);
          await page.screenshot({ path: ${JSON.stringify(join(out, frame))} });
          return page.url();
        }`;
        const capture: Capture = { viewport: viewport.name, view: view.name, file, frame, url, description: view.description, review: view.review, ok: false };
        try {
          await admin(baseKnobs);
          capture.url = result(cli(name, ['run-code', code])) ?? url;
          capture.ok = true;
          console.log(`ok   ${viewport.name} ${view.name}`);
        } catch (error) {
          capture.error = String((error as Error).message ?? error);
          console.log(`FAIL ${viewport.name} ${view.name}\n${capture.error}`);
        } finally {
          await admin(DEFAULT_KNOBS);
        }
        captures.push(capture);
      }
    }
  } finally {
    for (const name of sessions.values()) { try { cli(name, ['close']); } catch {} }
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ variant, platform: 'web', now: state.now, capturedAt: new Date().toISOString(), app: values.app, captures }, null, 2));
    for (const viewport of viewports) {
      const files = captures.filter(c => c.viewport === viewport.name && c.ok).map(c => join(out, c.file));
      if (files.length) {
        const images = files.map(f => decodePng(new Uint8Array(readFileSync(f))));
        writeFileSync(join(out, `sheet-${viewport.name}.png`), encodePng(sheet(images, 360, 3)));
      }
    }
  }
}
