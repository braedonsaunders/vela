// Capture the Listen parity views on the web with the host's playwright-cli (headless, muted Chrome).
//
//   bun tools/parity/capture-listen-web.ts --out <dir> --app http://localhost:8951
//     [--views home,album] [--viewports web-1440,web-390]
//   For Gallery, pass --experience gallery and start the mock with GALLERY_MOCK_ENV. Set
//   VELA_MOCK_GALLERY_ROWS=1 for --views home and leave it unset for the stock grid and photo views.
//   For Read, pass --experience read [--variant legacy] and start the mock with READ_MOCK_ENV.
//
// The mock must run with LISTEN_MOCK_ENV (listen-views.ts) and silent media, and Metro must build a
// mock app (EXPO_PUBLIC_VELA_MOCK=1) so the parity hook sets the listening state. Run a fresh mock
// per capture set: playing a queue records progress on the server, so two sets compare only when
// they ran the same views in the same order from the same start. The browser clock is pinned to
// LISTEN_NOW. Compare these document captures with the archived baselines. Each view is captured
// twice, 700 ms apart, for the moving-region mask.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { captureName, target } from './views';
import { LISTEN_NOW, LISTEN_VIEWS, LISTEN_WEB_VIEWPORTS, listenPath, listenReviewed, type Step } from './listen-views';
import { GALLERY_NOW, GALLERY_VIEWS, GALLERY_WEB_VIEWPORTS, galleryReviewed } from './gallery-views';
import { decodePng } from './png';
import { captureHasContent } from './settle';
import { READ_NOW, READ_VIEWS, READ_WEB_VIEWPORTS, readReviewed } from './read-views';

const { values } = parseArgs({ options: {
  out: { type: 'string' }, app: { type: 'string', default: 'http://localhost:8951' },
  views: { type: 'string' }, viewports: { type: 'string' }, experience: { type: 'string' }, variant: { type: 'string' },
} });
if (!values.out) throw new Error('--out <dir> is required');
const out = resolve(values.out);
mkdirSync(join(out, 'frames'), { recursive: true });
const pick = <T extends { name: string }>(all: T[], list?: string) => list ? all.filter(item => list.split(',').includes(item.name)) : all;
const experience = values.experience ?? 'listen';
const read = experience === 'read';
const gallery = experience === 'gallery';
const fixedTime = read || gallery;
if (!fixedTime && experience !== 'listen') throw new Error('--experience must be listen, read or gallery');
const variant = values.variant ?? 'document';
if (variant !== 'legacy' && variant !== 'document') throw new Error('--variant must be legacy or document');
const now = gallery ? GALLERY_NOW : read ? READ_NOW : LISTEN_NOW;
const listenViews = LISTEN_VIEWS.map(view => ({ ...view, path: listenPath(view) }));
type AnyView = (typeof GALLERY_VIEWS)[number] | (typeof READ_VIEWS)[number] | (typeof listenViews)[number];
const views = pick<AnyView>(gallery ? GALLERY_VIEWS : read ? READ_VIEWS : listenViews, values.views);
const viewports = pick(gallery ? GALLERY_WEB_VIEWPORTS : read ? READ_WEB_VIEWPORTS : LISTEN_WEB_VIEWPORTS, values.viewports);

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
  name = `parity-${experience}-${touch ? 'touch' : 'desk'}-${process.pid}`;
  const config = join(scratch, `${name}.json`);
  writeFileSync(config, JSON.stringify({ browser: { browserName: 'chromium',
    launchOptions: { channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] },
    contextOptions: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion: 'no-preference' } } }));
  cli(name, ['open', `--config=${config}`]);
  sessions.set(touch, name);
  const date = `new Date(${JSON.stringify(now)})`;
  cli(name, ['run-code', fixedTime
    ? `async page => { await page.clock.setFixedTime(${date}); }`
    : `async page => { await page.clock.install({ time: ${date} }); }`]);
  if (fixedTime) return name;
  // Warm up: the first queue a fresh mock sees records progress on the server (Jump back in), so
  // every capture after it sees the same history; the first view must not differ from the rest.
  cli(name, ['run-code', `async page => { await page.goto(${JSON.stringify(`${values.app}${listenPath({ name: 'warm', description: '', place: '', ready: '' })}`)});
    await page.locator('[data-testid^="music-main"]').first().waitFor({ state: 'visible', timeout: 90000 }); await page.waitForTimeout(4000); }`]);
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
      if ('only' in view && view.only && !view.only.includes(viewport.name)) continue;
      const file = captureName(viewport.name, view.name), frame = join('frames', file.replace(/\.png$/, '.b.png'));
      const url = `${values.app}${view.path}`;
      const scroll = 'scrollTo' in view && typeof view.scrollTo === 'string' ? target(view.scrollTo) : undefined;
      const page = 'document' in view ? view.document : view.path.startsWith('/read/') ? 'reader' : view.path.startsWith('/title/series-') ? 'series'
        : view.path.startsWith('/title/') ? 'book' : 'home';
      // A mock Metro build exposes its store. Check the intended document rendered before comparing
      // it with the legacy baseline, even where both paths give the same pixels.
      const verifyDocument = fixedTime && variant === 'document' ? `await page.waitForFunction(() => {
          const pages = globalThis.__velaStore?.getState().screens.pages;
          return !!pages && Object.values(pages).some(entry => entry.href === ${JSON.stringify(`vela:${experience}/${page}`)} && entry.load === 'ready');
        }, null, { timeout: 10000 });` : '';
      // Use the normal edge hover to bring the reader chrome up and keep it there while capturing.
      const showReaderChrome = read && page === 'reader' ? `
        await page.mouse.move(1, ${Math.round(viewport.height / 2)});
        await page.mouse.move(0, ${viewport.height - 1});
        const toolbar = page.getByTestId('reader-top');
        await page.waitForTimeout(100);
        if (await toolbar.evaluate(el => getComputedStyle(el).pointerEvents === 'none')) {
          await page.evaluate(() => document.activeElement?.blur());
          await page.keyboard.press('Enter');
        }` : '';
      const chromeVisible = read && 'readerChrome' in view && view.readerChrome ? `() => ['reader-top', 'reader-bottom'].every(id => {
        const bar = document.querySelector('[data-testid="' + id + '"]');
        return bar && getComputedStyle(bar).opacity === '1' && getComputedStyle(bar).pointerEvents === 'auto';
      })` : '';
      const shoot = fixedTime ? `
        let previous = await page.screenshot();
        for (let attempt = 0; attempt < 30; attempt++) {
          await page.waitForTimeout(700);
          const candidate = await page.screenshot();
          if (previous.equals(candidate)) {
            await page.waitForTimeout(700);
            const primary = await page.screenshot({ path: ${JSON.stringify(join(out, file))} });
            if (candidate.equals(primary)) {
              await page.waitForTimeout(700);
              const confirmed = await page.screenshot({ path: ${JSON.stringify(join(out, frame))} });
              if (primary.equals(confirmed)) {
                ${chromeVisible ? `if (!(await page.evaluate(${chromeVisible}))) throw new Error('Reader controls did not stay visible');` : ''}
                return { url: page.url() };
              }
              previous = confirmed;
              continue;
            }
            previous = primary;
            continue;
          }
          previous = candidate;
        }
        throw new Error('The capture did not settle');
      ` : `
        await page.screenshot({ path: ${JSON.stringify(join(out, file))} });
        await page.waitForTimeout(700);
        await page.screenshot({ path: ${JSON.stringify(join(out, frame))} });
        return { url: page.url() };
      `;
      const galleryChrome = gallery && page === 'photo' ? 'await page.getByRole("button", { name: "Close", exact: true }).first().waitFor({ state: "visible" });' : '';
      const code = `async page => {
        await page.setViewportSize({ width: ${viewport.width}, height: ${viewport.height} });
        await page.goto(${JSON.stringify(url)});
        ${waitFor(view.ready)}
        ${verifyDocument}
        ${galleryChrome}
        ${read && page === 'reader' ? `await page.getByTestId('reader-opening').waitFor({ state: 'detached', timeout: 30000 });` : ''}
        await page.locator('[data-testid="vela-launch"]').waitFor({ state: 'detached', timeout: 45000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(${fixedTime ? 250 : 2500});
        ${showReaderChrome}
        ${('steps' in view ? view.steps ?? [] : []).map(stepCode).join('\n        ')}
        ${'settled' in view && view.settled ? waitFor(view.settled) : ''}
        ${chromeVisible ? `await page.waitForFunction(${chromeVisible}, null, { timeout: 5000 });` : ''}
        ${scroll && 'selector' in scroll ? `await page.locator(${JSON.stringify(scroll.selector)}).first().evaluate(${SCROLL});` : ''}
        await page.mouse.move(0, ${viewport.height - 1});
        await page.waitForTimeout(${fixedTime ? 250 : 1800});
        ${shoot}
      }`;
      const capture: Capture = { viewport: viewport.name, view: view.name, file, frame, url, description: view.description, review: (gallery ? galleryReviewed : read ? readReviewed : listenReviewed)(view, viewport.name), ok: false };
      try {
        const answer = result(cli(name, ['run-code', code])) as { url: string } | undefined;
        if (gallery && !captureHasContent(decodePng(readFileSync(join(out, file))))) throw new Error('Blank Gallery capture');
        capture.url = answer?.url ?? url;
        capture.ok = true;
        console.log(`ok   ${viewport.name} ${view.name}`);
      } catch (error) {
        if (gallery) process.exitCode = 1;
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
  writeFileSync(manifest, JSON.stringify({ variant, experience, platform: 'web', now, capturedAt: new Date().toISOString(), app: values.app, captures: merged }, null, 2));
}
