import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

describe('Sports deterministic release gate', { session: 'mock-sports' }, () => {
  test('Tonight opens a game and its stream starts only once', async ({ app, browser, screen }) => {
    await app.open('/vela/');
    const tonight = screen.getByTestId('sports-tonight');
    await expect(screen.getByRole('link', 'Home')).toBeVisible({ timeout: 30_000 });
    await browser.mouse.move(720, 700);
    await expect.poll(async () => {
      if (await tonight.isVisible()) return true;
      await browser.mouse.wheel(0, 1_600);
      return false;
    }, { timeout: 30_000 }).toBe(true);
    await expect(tonight).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('heading', 'Tonight')).toBeVisible();

    await expect(screen.getByTestId(/^sports-tonight-/).first()).toBeVisible();

    await app.open('/vela/screen/sports');
    await expect(screen.getByTestId('sports-screen-sports')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('sports-hero')).toBeVisible();

    // The mock exercises the strict ref contract: game pages accept record refs,
    // while the index fixture's $key is deliberately a bare entity id.
    await app.open('/vela/screen/sports/game?event=event%3Asports%3Asports%3Anfl-nyg-phi');
    await expect(screen.getByTestId('sports-game')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('sports-game-centre')).toBeVisible();
    await expect(screen.getByTestId('sports-watch-row')).toBeVisible();

    let starts = 0;
    const playback = '**/vela/v0/playback';
    await browser.route(playback, route => {
      if (route.request.method === 'POST') starts += 1;
      return route.continue();
    });
    await screen.getByTestId('sports-watch-0').tap();
    await expect(screen.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Pause', { timeout: 30_000 });
    await browser.evaluate(() => new Promise<null>(resolve => setTimeout(() => resolve(null), 10_000)));
    expect(starts).toBe(1);
    await screen.getByTestId('watch-stage').tap();
    await expect(screen.getByTestId('player-failure-close')).toBeHidden();
    await screen.getByTestId('player-close').tap();
    await expect(screen.getByTestId('sports-game')).toBeVisible({ timeout: 30_000 });
    await browser.unroute(playback);
  });
});
