// Capture the Listen parity views on the web with the host's playwright-cli (headless, muted Chrome).
//
//   bun tools/parity/capture-listen-web.ts --variant legacy|document --out <dir> --app http://localhost:8951
//     [--views home,album] [--viewports web-1440,web-390]
//
// The mock must run with LISTEN_MOCK_ENV (listen-views.ts) and silent media, and Metro must build a
// mock app (EXPO_PUBLIC_VELA_MOCK=1) so the parity hook sets the listening state. Run a fresh mock
// per capture set: playing a queue records progress on the server, so two sets compare only when
// they ran the same views in the same order from the same start. The browser clock is pinned to
// LISTEN_NOW. The document variant needs a Metro built with EXPO_PUBLIC_VELA_LISTEN=documents (the
// legacy one without it). Each view is captured twice, 700 ms apart, for the moving-region mask.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { captureName, target } from './views';
import { LISTEN_NOW, LISTEN_VIEWS, LISTEN_WEB_VIEWPORTS, listenPath, listenReviewed, type Step } from './listen-views';

const { values } = parseArgs({ options: {
  variant: { type: 'string', default: 'legacy' }, out: { type: 'string' }, app: { type: 'string', default: 'http://localhost:8951' },
  views: { type: 'string' }, viewports: { type: 'string' },
} });
const variant = values.variant!;
if (variant !== 'legacy' && variant !== 'document') throw new Error('--variant is legacy or document');
if (!values.out) throw new Error('--out <dir> is required');
const out = resolve(values.out);
mkdirSync(join(out, 'frames'), { recursive: true });
const pick = <T extends { name: string }>(all: T[], list?: string) => list ? all.filter(item => list.split(',').includes(item.name)) : all;
const views = pick(LISTEN_VIEWS, values.views), viewports = pick(LISTEN_WEB_VIEWPORTS, values.viewports);

const scratch = join(out, '.playwright');
mkdirSync(scratch, { recursive: true });
function cli(session: string, args: string[]): string {
  const run = Bun.spawnSync(['playwright-cli', `-s=${session}`, ...args], { cwd: scratch, stdout: 'pipe', stderr: 'pipe' });
  const text = `${run.stdout.toString()}${run.stderr.toString()}`;
  if (run.exitCode !== 0 || /^### Error/m.test(text)) throw new Error(text.split('\n').filter(line => !/[═║]/.test(line)).slice(0, 12).join('\n'));
  return text;
}
const result = (text: string) => { const match = /### Result\n([^\n]*)/.exec(text); return match ? JSON.parse(match[1]!) : undefined; };

const sessions = new Map<boolean, string>();
function session(touch: boolean): string {
  let name = sessions.get(touch);
  if (name) return name;
  name = `l2-listen-${touch ? 'touch' : 'desk'}-${process.pid}`;
  const config = join(scratch, `${name}.json`);
  writeFileSync(config, JSON.stringify({ browser: { browserName: 'chromium',
    launchOptions: { channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] },
    contextOptions: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion: 'no-preference' } } }));
  cli(name, ['open', `--config=${config}`]);
  cli(name, ['run-code', `async page => { await page.clock.install({ time: new Date(${JSON.stringify(LISTEN_NOW)}) }); }`]);
  // Warm up: the first queue a fresh mock sees records progress on the server (Jump back in), so
  // every capture after it sees the same history; the first view must not differ from the rest.
  cli(name, ['run-code', `async page => { await page.goto(${JSON.stringify(`${values.app}${listenPath({ name: 'warm', description: '', place: '', ready: '' })}`)});
    await page.locator('[data-testid^="music-main"]').first().waitFor({ state: 'visible', timeout: 90000 }); await page.waitForTimeout(4000); }`]);
  sessions.set(touch, name);
  return name;
}

const SCROLL = `el => {
  let box = el.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  const by = el.getBoundingClientRect().top - 120;
  if (box) box.scrollTop += by; else window.scrollBy(0, by);
}`;
const waitFor = (spec: string) => {
  const t = target(spec);
  return 'selector' in t ? `await page.locator(${JSON.stringify(t.selector)}).first().waitFor({ state: 'visible', timeout: 45000 });` : `await page.waitForTimeout(${t.wait});`;
};
function stepCode(step: Step): string {
  if ('wait' in step) return `await page.waitForTimeout(${step.wait});`;
  if ('press' in step) return `await page.keyboard.press(${JSON.stringify(step.press)});`;
  const spec = 'click' in step ? step.click : 'hover' in step ? step.hover : step.fill;
  const t = target(spec);
  if (!('selector' in t)) throw new Error(`step target ${spec}`);
  // A testid names the element itself; react-native-web puts it on the outer view, so fill its input.
  const locator = `page.locator(${JSON.stringify(t.selector)}).first()`;
  if ('click' in step) return `await ${locator}.click();`;
  if ('hover' in step) return `await ${locator}.hover();`;
  return `{ const field = ${locator}; const input = (await field.evaluate(e => e.matches('input,textarea'))) ? field : field.locator('input,textarea').first(); await input.fill(${JSON.stringify(step.text)}); }`;
}

interface Capture { viewport: string; view: string; file: string; frame: string; url: string; description: string; review?: string; ok: boolean; error?: string }
const captures: Capture[] = [];
try {
  for (const viewport of viewports) {
    const name = session(!!viewport.touch);
    for (const view of views) {
      if (view.only && !view.only.includes(viewport.name)) continue;
      const file = captureName(viewport.name, view.name), frame = join('frames', file.replace(/\.png$/, '.b.png'));
      const url = `${values.app}${listenPath(view)}`;
      const scroll = view.scrollTo ? target(view.scrollTo) : undefined;
      const code = `async page => {
        await page.setViewportSize({ width: ${viewport.width}, height: ${viewport.height} });
        await page.goto(${JSON.stringify(url)});
        ${waitFor(view.ready)}
        await page.locator('[data-testid="vela-launch"]').waitFor({ state: 'detached', timeout: 45000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2500);
        ${(view.steps ?? []).map(stepCode).join('\n        ')}
        ${view.settled ? waitFor(view.settled) : ''}
        ${scroll && 'selector' in scroll ? `await page.locator(${JSON.stringify(scroll.selector)}).first().evaluate(${SCROLL});` : ''}
        await page.mouse.move(0, ${viewport.height - 1});
        await page.waitForTimeout(1800);
        await page.screenshot({ path: ${JSON.stringify(join(out, file))} });
        await page.waitForTimeout(700);
        await page.screenshot({ path: ${JSON.stringify(join(out, frame))} });
        return { url: page.url() };
      }`;
      const capture: Capture = { viewport: viewport.name, view: view.name, file, frame, url, description: view.description, review: listenReviewed(view, viewport.name), ok: false };
      try {
        const answer = result(cli(name, ['run-code', code])) as { url: string } | undefined;
        capture.url = answer?.url ?? url;
        capture.ok = true;
        console.log(`ok   ${viewport.name} ${view.name}`);
      } catch (error) {
        capture.error = String((error as Error).message ?? error);
        console.log(`FAIL ${viewport.name} ${view.name}\n${capture.error}`);
      }
      captures.push(capture);
    }
  }
} finally {
  for (const name of sessions.values()) { try { cli(name, ['close']); } catch {} }
  // A run of some views or viewports adds to (or replaces) those captures in an earlier run's manifest.
  const manifest = join(out, 'manifest.json');
  const earlier = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as { captures: Capture[] }).captures : [];
  const merged = [...earlier.filter(c => !captures.some(n => n.viewport === c.viewport && n.view === c.view)), ...captures];
  writeFileSync(manifest, JSON.stringify({ variant, experience: 'listen', platform: 'web', now: LISTEN_NOW, capturedAt: new Date().toISOString(), app: values.app, captures: merged }, null, 2));
}
