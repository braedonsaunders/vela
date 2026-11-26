import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { videoState, waitForVideoPlayback, waitForVideoReady } from './player-ready';
import { signInMockViewer } from './sign-in';

describe('Live TV catch-up release gate', () => {
  test('the guide replays an archive and Start over can pause, rewind and return live', async ({ app, browser, screen }) => {
    // Full navigations rotate the grant. Give each repetition its own grant.
    await signInMockViewer(app, screen);
    const guide = await browser.evaluate(async () => {
      const flags = await fetch('/__admin/faults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catchUpFixture: true }),
      }).then(reply => reply.json()) as { catchUpFixture: boolean };
      const programmes = await fetch('/__admin/catch-up-fixture').then(reply => reply.json()) as { id: string; start: string }[];
      return { ...flags, programmes };
    });
    const commands: string[] = [];
    const starts: string[] = [];
    const seekPositions: number[] = [];
    const playbackRoute = /\/vela\/v0\/playback$/;
    await browser.route(playbackRoute, route => {
      const body = JSON.parse(route.request.postData ?? '{}') as { from?: string };
      if (body.from) starts.push(body.from);
      return route.continue();
    });
    let pausedReports = 0;
    const sessionRoute = /\/vela\/v0\/sessions\/[^/]+\/(commands|observations)$/;
    await browser.route(sessionRoute, route => {
      const body = JSON.parse(route.request.postData ?? '{}') as { kind?: string; state?: string; positionSeconds?: number };
      if (body.kind) commands.push(body.kind);
      if (body.kind === 'seek' && body.positionSeconds !== undefined) seekPositions.push(body.positionSeconds);
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
      await expect.poll(() => browser.evaluate(() => [2, 3, 5].every(channel =>
        Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="guide-programme-channel-${channel}|"]`))
          .some(cell => {
            const box = cell.getBoundingClientRect();
            return box.width > 12 && box.right > 310 && box.left < window.innerWidth && box.top < window.innerHeight;
          })))).toBe(true);
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
      await waitForVideoPlayback(browser, screen);
      await pause();
      const positionBeforeRewind = (await videoState(browser)).position;
      const seeks = commands.filter(kind => kind === 'seek').length;
      await screen.getByTestId('player-scrub').press('PageDown');
      await expect.poll(() => commands.filter(kind => kind === 'seek').length).toBe(seeks + 1);
      const requested = seekPositions.at(-1) ?? NaN;
      expect(Math.abs(positionBeforeRewind - requested - 60)).toBeLessThan(2);
      await expect(screen.getByTestId('player-live-edge-time')).toHaveText(/^\d{1,2}:[0-5]\d [AP]M · LIVE$/, { timeout: 35_000 });
      await expect(toggle).toHaveAttribute('aria-label', 'Play');
      await expect(screen.getByTestId('player-live-status')).toHaveText(/^\d+:\d+ behind live$/);
      await expect(screen.getByTestId('player-live-mark')).toBeHidden();
      await expect(screen.getByTestId('player-start-over')).toBeHidden();
      await expect(screen.getByTestId('player-status')).toBeHidden();
      const progress = async () => {
        const video = await videoState(browser);
        return { ...video, rewind: positionBeforeRewind - video.position };
      };
      try {
        await expect.poll(async () => {
          const video = await progress();
          return video.hasFrame && video.paused && !video.seeking && Math.abs(video.position - requested) < 0.5;
        }, { timeout: 15_000 }).toBe(true);
      } catch (error) {
        console.info('Rewind picture state', { before: positionBeforeRewind, requested, ...(await progress()) });
        await app.screenshot('paused-live-rewind-diagnostic');
        throw error;
      }
      await app.screenshot('paused-live-rewind');
      await browser.setViewport({ width: 390, height: 844 });
      await expect(goLive).toBeVisible();
      await expect.poll(() => browser.evaluate(() => {
        const status = document.querySelector('[data-testid="player-live-status"]')?.getBoundingClientRect();
        const chip = document.querySelector('[data-testid="player-go-live"]');
        const controls = document.querySelector('[data-testid="player-phone-controls"]');
        const button = chip?.getBoundingClientRect();
        return !!(status && button && controls && !controls.contains(chip)
          && button.left >= status.right && button.top <= status.top && button.bottom >= status.bottom);
      })).toBe(true);
      await app.screenshot('compact-go-live');
      await goLive.tap();
      await expect(screen.getByTestId('player-status')).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      expect(commands.filter(kind => kind === 'goLive')).toHaveLength(2);
      await browser.setViewport({ width: 1440, height: 900 });

      const fromPlayer = screen.getByTestId('player-start-over');
      await expect(fromPlayer).toBeVisible();
      const previousStarts = starts.length;
      await fromPlayer.tap();
      await expect.poll(() => starts.slice(previousStarts)).toEqual(['start']);
      await waitForVideoReady(browser, screen);
      await expect(timeline).toHaveText(/Start over/);
      await expect(goLive).toBeVisible();
    } finally {
      try { await closeWatch(); }
      finally {
        await browser.unroute(sessionRoute);
        await browser.unroute(playbackRoute);
        await browser.evaluate(async () => {
          await fetch('/__admin/faults', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catchUpFixture: false }),
          });
        });
      }
    }
  });
});
