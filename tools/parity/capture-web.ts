// Capture the Sports parity views on the web with the host's playwright-cli (headless, muted Chrome).
//
//   bun tools/parity/capture-web.ts --out <dir> --app http://localhost:8141 --mock http://127.0.0.1:7841
//
// Captures the Sports documents; the legacy hard-coded Sports was deleted in the hard cut and its
// captures are the archived baselines compare.ts reads.
//     [--views index-top,game-live] [--viewports web-1440,web-390]
//
// The mock must run with VELA_MOCK_SPORTS_FREEZE=1. The browser clock is set to the mock's frozen
// instant, so day chips and start times read the same on any day. Each view is captured twice,
// 700 ms apart: the first frame is the capture, and what differs between the two is the view's
// moving regions (the LIVE dot, the graph's end pulse), masked out of the comparison.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { captureName, DEFAULT_KNOBS, reviewed, target, VIEWS, WEB_VIEWPORTS, webPath, type Knobs, type Variant } from './views';

const { values } = parseArgs({ options: {
  variant: { type: 'string', default: 'document' }, out: { type: 'string' }, app: { type: 'string', default: 'http://localhost:8141' },
  mock: { type: 'string', default: 'http://127.0.0.1:7841' }, views: { type: 'string' }, viewports: { type: 'string' },
} });
const variant = values.variant as Variant;
if (variant !== 'legacy' && variant !== 'document') throw new Error('--variant is legacy or document');
if (!values.out) throw new Error('--out <dir> is required');
const out = resolve(values.out);
mkdirSync(join(out, 'frames'), { recursive: true });
const pick = <T extends { name: string }>(all: T[], list?: string) => list ? all.filter(item => list.split(',').includes(item.name)) : all;
const views = pick(VIEWS, values.views), viewports = pick(WEB_VIEWPORTS, values.viewports);

async function admin(knobs: Knobs): Promise<{ now: string; frozen: boolean }> {
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
  name = `w4-parity-${touch ? 'touch' : 'desk'}-${process.pid}`;
  const config = join(scratch, `${name}.json`);
  writeFileSync(config, JSON.stringify({ browser: { browserName: 'chromium',
    launchOptions: { channel: 'chrome', headless: true, args: ['--mute-audio'] },
    contextOptions: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion: 'no-preference' } } }));
  cli(name, ['open', `--config=${config}`]);
  cli(name, ['run-code', `async page => { await page.clock.install({ time: new Date(${JSON.stringify(state.now)}) }); }`]);
  sessions.set(touch, name);
  return name;
}

/** Scrolls the nearest scrolling ancestor so the element's top sits SCROLL_TOP px from the viewport's
 * top (clear of the shell's bar), the same way for both variants. */
const SCROLL = `el => {
  let box = el.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  const by = el.getBoundingClientRect().top - 96;
  if (box) box.scrollTop += by; else window.scrollBy(0, by);
}`;

interface Capture { viewport: string; view: string; file: string; frame: string; url: string; description: string; review?: string; ok: boolean; error?: string }
const captures: Capture[] = [];
try {
  for (const viewport of viewports) {
    const name = session(!!viewport.touch);
    for (const view of views) {
      if (view.only && !view.only.includes(viewport.name)) continue;
      const file = captureName(viewport.name, view.name), frame = join('frames', file.replace(/\.png$/, '.b.png'));
      const url = `${values.app}${webPath(variant, view.page)}`;
      const ready = target(view.ready), scroll = view.scrollTo ? target(view.scrollTo) : undefined;
      const code = `async page => {
        await page.setViewportSize({ width: ${viewport.width}, height: ${viewport.height} });
        await page.goto(${JSON.stringify(url)});
        ${'selector' in ready ? `await page.locator(${JSON.stringify(ready.selector)}).first().waitFor({ state: 'visible', timeout: 45000 });` : `await page.waitForTimeout(${ready.wait});`}
        await page.locator('[data-testid="vela-launch"]').waitFor({ state: 'detached', timeout: 45000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1800);
        ${scroll && 'selector' in scroll ? `await page.locator(${JSON.stringify(scroll.selector)}).first().evaluate(${SCROLL});
        await page.waitForTimeout(1500);` : ''}
        await page.screenshot({ path: ${JSON.stringify(join(out, file))} });
        await page.waitForTimeout(700);
        await page.screenshot({ path: ${JSON.stringify(join(out, frame))} });
        return page.url();
      }`;
      const capture: Capture = { viewport: viewport.name, view: view.name, file, frame, url, description: view.description, review: reviewed(view, viewport.name), ok: false };
      try {
        await admin({ ...DEFAULT_KNOBS, ...view.knobs });
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
}
