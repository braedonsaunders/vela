// Run with VELA_HANDOFF_E2E=1 bun test apps/vela/test/e2e/server-handoff.test.ts.
import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';
import { launchMock } from '../../../../mock-server/test/launch';
import type { fixture } from './handoff-player';

declare global { interface Window { handoff: typeof fixture } }

test.skipIf(process.env.VELA_HANDOFF_E2E !== '1')('Chromium defers the native switch while Ether completes the handoff', async () => {
  const build = await Bun.build({
    entrypoints: [`${import.meta.dir}/handoff-player.ts`], target: 'browser',
    plugins: [{ name: 'native-bridge-fixture', setup(builder) {
      builder.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native-bridge', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: "export const Platform = { OS: 'android', isTV: false }; export const AppState = { addEventListener: () => ({ remove() {} }) };",
      }));
    } }],
  });
  const script = await build.outputs[0]!.text();
  const mock = await launchMock();
  try {
    const browser = await chromium.launch({ channel: 'chrome', args: ['--mute-audio'] });
    try {
      for (const pending of [false, true]) {
        const fault = await fetch(`${mock.url}/__admin/faults`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverHandoffObservations: pending ? 1 : 0 }),
        });
        expect(fault.status).toBe(200);
        const page = await browser.newPage();
        page.setDefaultTimeout(8000);
        try {
          await page.route('**/__handoff', route => route.fulfill({
            contentType: 'text/html', body: '<main></main><script type="module" src="/__handoff.js"></script>',
          }));
          await page.route('**/__handoff.js', route => route.fulfill({ contentType: 'application/javascript', body: script }));
          const switches: unknown[] = [];
          page.on('request', request => {
            if (request.method() === 'POST' && request.url().endsWith('/commands') && request.postDataJSON()?.kind === 'switch') {
              switches.push(request.postDataJSON().pathId);
            }
          });
          page.on('pageerror', error => console.error(error));
          await page.goto(`${mock.url}/__handoff`);
          await page.evaluate(() => window.handoff.open());
          const initial = { handoff: pending ? 'pending' : null, path: 'direct', source: 1, seek: 1, adaptive: false, reason: null };
          await page.waitForFunction(expected => document.querySelector('output')?.textContent === JSON.stringify(expected), initial);
          await page.evaluate(() => window.handoff.starve());
          const switched = pending ? { handoff: 'completed', path: 'transcode', source: 2, seek: 2, adaptive: true, reason: 'source_delivery' }
            : { ...initial, path: 'transcode', source: 2, adaptive: true };
          if (pending) {
            expect(JSON.parse((await page.locator('output').textContent())!)).toEqual(initial);
            await page.evaluate(() => window.handoff.bufferingObservation());
          }
          await page.waitForFunction(expected => document.querySelector('output')?.textContent === JSON.stringify(expected), switched);
          expect(switches).toEqual(pending ? [] : ['transcode']);
          await page.evaluate(() => window.handoff.close());
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await mock.stop();
  }
}, 45_000);
