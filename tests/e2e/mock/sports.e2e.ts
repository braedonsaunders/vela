import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

describe('Sports deterministic release gate', { session: 'mock-sports' }, () => {
  test('Tonight opens a game and its stream starts only once', async ({ app, browser, screen }) => {
    await app.open('/vela/');
    const tonight = screen.getByTestId('sports-tonight');
    for (let page = 0; page < 6 && !await tonight.isVisible(); page++) {
      await browser.evaluate(() => {
        for (const element of [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')]) {
          if (element && element.scrollHeight > element.clientHeight) element.scrollTop = element.scrollHeight;
        }
        return null;
      });
      await browser.evaluate(() => new Promise<null>(resolve => setTimeout(() => resolve(null), 500)));
    }
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
    await expect(screen.getByRole('button', 'Close player')).toBeVisible({ timeout: 30_000 });
    await browser.evaluate(() => new Promise<null>(resolve => setTimeout(() => resolve(null), 10_000)));
    expect(starts).toBe(1);
    await screen.getByTestId('watch-stage').tap();
    await screen.getByRole('button', 'Close player').tap();
    await expect(screen.getByTestId('sports-game')).toBeVisible({ timeout: 30_000 });
    await browser.unroute(playback);
  });
});
