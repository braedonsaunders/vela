import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { waitForVideoReady } from './player-ready';

describe('Live TV catch-up release gate', { session: 'mock-catch-up' }, () => {
  test('the guide replays an archive and Start over can pause, rewind and return live', async ({ app, browser, screen }) => {
    await app.open('/vela/');
    const guide = await browser.evaluate(async () => {
      const flags = await fetch('/__admin/faults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catchUpFixture: true }),
      }).then(reply => reply.json()) as { catchUpFixture: boolean };
      const programmes = await fetch('/__admin/catch-up-fixture').then(reply => reply.json()) as { id: string; start: string }[];
      return { ...flags, programmes };
    });
    const commands: string[] = [];
    let pausedReports = 0;
    const sessionRoute = /\/vela\/v0\/sessions\/[^/]+\/(commands|observations)$/;
    await browser.route(sessionRoute, route => {
      const body = JSON.parse(route.request.postData ?? '{}') as { kind?: string; state?: string };
      if (body.kind) commands.push(body.kind);
      if (body.state === 'paused') pausedReports++;
      return route.continue();
    });
    const openProgramme = async (programme: { id: string; start: string }) => {
      const at = new Date(Date.parse(programme.start) + 5 * 60_000).toISOString();
      await app.open('/vela/live?' + new URLSearchParams({ ch: 'channel-1', prog: programme.id, at }));
    };
    const stage = screen.getByTestId('player-stage-input');
    const close = screen.getByTestId('player-close');
    const toggle = screen.getByTestId('player-toggle');
    const timeline = screen.getByTestId('player-live-timeline');
    const pause = async () => {
      await waitForVideoReady(browser, screen);
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await stage.press('k');
      await expect(toggle).toHaveAttribute('aria-label', 'Play');
    };
    const closeWatch = async () => {
      if (!await stage.isVisible()) return;
      if (await toggle.getAttribute('aria-label') === 'Pause') await pause();
      await close.tap();
      await expect(stage).toBeHidden();
    };
    try {
      expect(guide.catchUpFixture).toBe(true);
      expect(guide.programmes).toHaveLength(2);
      await openProgramme(guide.programmes[0]!);
      await expect(screen.getByTestId('guide-replay')).toBeVisible({ timeout: 30_000 });
      await app.screenshot('guide-catch-up');
      await screen.getByTestId('guide-replay').tap();
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await expect(screen.getByTestId('player-scrub')).toBeVisible();
      await expect(timeline).toBeHidden();
      await closeWatch();

      await openProgramme(guide.programmes[1]!);
      await expect(screen.getByTestId('guide-start-over')).toBeVisible({ timeout: 30_000 });
      await app.screenshot('guide-start-over');
      await screen.getByTestId('guide-start-over').tap();
      await expect(timeline).toBeVisible({ timeout: 35_000 });
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await pause();
      await expect.poll(() => pausedReports).toBeGreaterThanOrEqual(2);

      const goLive = screen.getByTestId('player-go-live');
      await expect(goLive).toHaveAttribute('aria-label', 'Go live');
      await goLive.tap();
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await expect(screen.getByTestId('player-live-mark')).toBeVisible();
      await pause();
      const seeks = commands.filter(kind => kind === 'seek').length;
      await screen.getByTestId('player-scrub').press('PageDown');
      await expect.poll(() => commands.filter(kind => kind === 'seek').length).toBe(seeks + 1);
      await expect(screen.getByTestId('player-live-delay')).toHaveText(/ · -\d+:[0-5]\d$/, { timeout: 35_000 });
      await expect(toggle).toHaveAttribute('aria-label', 'Play');
      await expect(screen.getByTestId('player-live-status')).toHaveText(/behind live/);
      await waitForVideoReady(browser, screen);
      await app.screenshot('paused-live-rewind');
      await expect(goLive).toBeVisible();
      await goLive.tap();
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      expect(commands.filter(kind => kind === 'goLive')).toHaveLength(2);
    } finally {
      try { await closeWatch(); }
      finally {
        await browser.unroute(sessionRoute);
        await browser.evaluate(async () => {
          await fetch('/__admin/faults', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catchUpFixture: false }),
          });
        });
      }
    }
  });
});
