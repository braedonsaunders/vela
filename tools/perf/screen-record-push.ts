/**
 * Integrated record-push check on the web (docs/plugin-screens.md: Data, records and live updates):
 * the real app (ScreenView, the blocks, the Sports index document served by the frozen mock) in
 * headless, muted Chrome. One event record is pushed through the app's own record store (as a
 * `records` stream frame lands), and every node that draws afterwards is counted: a node drawn
 * inside an item bound to that record is expected; any other is the blast radius this guards.
 *
 *   PORT=8791 VELA_MOCK_SPORTS_FREEZE=1 bun run mock-server/main.ts
 *   cd apps/vela && EXPO_PUBLIC_VELA_SERVER=http://127.0.0.1:8791 EXPO_PUBLIC_VELA_MOCK=1 bun x expo start --web --port 8792 --clear
 *   bun tools/perf/screen-record-push.ts [--app http://localhost:8792] [--event event:sports:sports:nfl-nyg-phi] [--budget 12]
 *
 * Needs a development bundle (the store and the render probe are exposed only under __DEV__).
 * Exits 1 when more nodes than --budget draw outside the items showing the record, or the pushed
 * score does not reach the screen.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  app: { type: 'string', default: 'http://localhost:8792' },
  event: { type: 'string', default: 'event:sports:sports:nfl-nyg-phi' },
  budget: { type: 'string', default: '12' },
} });

const scratch = join(process.env.HOME ? join(process.env.HOME, '.scratch/tmp') : tmpdir(), `screen-record-push-${process.pid}`);
mkdirSync(scratch, { recursive: true });
const session = `w1-record-push-${process.pid}`;
function cli(args: string[]): string {
  const run = Bun.spawnSync(['playwright-cli', `-s=${session}`, ...args], { cwd: scratch, stdout: 'pipe', stderr: 'pipe' });
  const text = `${run.stdout.toString()}${run.stderr.toString()}`;
  if (run.exitCode !== 0 || /^### Error/m.test(text)) throw new Error(text.split('\n').filter(line => !/[═║]/.test(line)).slice(0, 12).join('\n'));
  return text;
}
const result = (text: string) => { const match = /### Result\n([^\n]*)/.exec(text); return match ? JSON.parse(match[1]!) : undefined; };

/** In the page: wait for the index, install the probe, push one record, and count who drew. */
const code = (key: string) => `async page => {
  await page.goto(${JSON.stringify(`${values.app}/screen/sports`)});
  await page.waitForSelector('[data-testid="sports-screen-sports"]', { timeout: 60000 });
  await page.waitForTimeout(4000);
  return await page.evaluate(async key => {
    const store = globalThis.__velaStore;
    if (!store) throw new Error('not a development bundle: no __velaStore');
    const records = store.screens.records;
    const entry = records.get(key);
    if (!entry) throw new Error('the page does not show ' + key);
    const bound = ctx => Object.values(ctx?.screen?.items ?? {}).some(b => b && b.value && b.value.$record === key);
    const drawn = [];
    globalThis.__velaRenderProbe = (node, ctx) => drawn.push({ kind: node.kind, inside: bound(ctx), testId: typeof node.testId === 'string' ? node.testId : '' });
    const score = String(Number(entry.value.sides[1].score) + 1);
    records.merge({ [key]: { rev: entry.rev + 1, value: { ...entry.value, sides: entry.value.sides.map((s, i) => (i === 1 ? { ...s, score } : s)) } } });
    await new Promise(resolve => setTimeout(resolve, 1500));
    globalThis.__velaRenderProbe = undefined;
    const shown = [...document.querySelectorAll('[data-testid="sports-hero-home-score"], [data-testid="sports-game-home-score"]')].map(e => e.textContent);
    const outside = drawn.filter(d => !d.inside);
    return { score, shown, total: drawn.length, inside: drawn.length - outside.length,
      outside: outside.length, outsideNodes: outside.map(d => d.kind + (d.testId ? ':' + d.testId : '')).slice(0, 20) };
  }, ${JSON.stringify(key)});
}`;

const config = join(scratch, 'config.json');
writeFileSync(config, JSON.stringify({ browser: { browserName: 'chromium', launchOptions: { channel: 'chrome', headless: true, args: ['--mute-audio'] },
  contextOptions: { viewport: { width: 1440, height: 900 } } } }));
let failed = false;
try {
  cli(['open', `--config=${config}`]);
  const report = result(cli(['run-code', code(values.event!)])) as { score: string; shown: string[]; total: number; inside: number; outside: number; outsideNodes: string[] };
  console.log(JSON.stringify(report, null, 2));
  const budget = Number(values.budget);
  if (report.outside > budget) { console.log(`FAIL ${report.outside} nodes drew outside the items showing ${values.event} (budget ${budget})`); failed = true; }
  if (!report.shown.includes(report.score)) { console.log(`FAIL the pushed score ${report.score} is not on screen (${report.shown.join(', ')})`); failed = true; }
  if (!failed) console.log(`pass: ${report.inside} nodes in the items showing the record, ${report.outside} outside`);
} finally {
  try { cli(['close']); } catch { /* already closed */ }
}
process.exit(failed ? 1 : 0);
