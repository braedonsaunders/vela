import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { waitForVideoReady } from './player-ready';
import { signInMockViewer } from './sign-in';

describe('Sports deterministic release gate', () => {
  test('the phone Sports landing link uses the section menu and can return Home', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    await browser.setViewport({ width: 402, height: 874 });

    // The fully qualified landing address must enter the same shell as /screen/sports.
    await app.open('/vela/screen/sports/index?teamsLeague=nhl');
    await expect(screen.getByTestId('sports-screen-sports')).toBeVisible({ timeout: 30_000 });
    expect(await browser.evaluate(() => location.pathname)).toBe('/vela/screen/sports');
    expect(await browser.evaluate(() => new URLSearchParams(location.search).get('teamsLeague'))).toBe('nhl');
    const menu = screen.getByTestId('mobile-navigation');
    await expect(menu).toBeVisible();
    await expect(screen.getByTestId('profile-menu')).toBeVisible();

    await screen.getByTestId('sports-hero-details').tap();
    await expect(screen.getByTestId('sports-game')).toBeVisible({ timeout: 30_000 });
    const back = screen.getByTestId('screen-page-back');
    await expect(back).toBeVisible();
    await back.tap();
    await expect(back).toBeHidden();
    await expect(menu).toBeVisible();

    await menu.tap();
    const home = screen.getByRole('link', 'Home');
    await expect(home).toBeVisible();
    await home.tap();
    await expect(screen.getByTestId('section-home:home')).toBeVisible();
    expect(await browser.evaluate(() => location.pathname)).toBe('/vela/');
  });

  test('Tonight opens a game and its stream starts only once', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
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

describe('Sports catch-up release gate', () => {
  test('Watch from start shows only scores available at the picture time', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    const setFixture = (enabled: boolean) => browser.evaluate(async catchUpFixture => {
      const reply = await fetch('/__admin/faults', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catchUpFixture }) });
      return (await reply.json() as { catchUpFixture: boolean }).catchUpFixture;
    }, enabled);
    expect(await setFixture(true)).toBe(true);
    const scoreBug = screen.getByTestId('player-score-bug');
    const start = screen.getByTestId('sports-watch-from-start');
    const stage = screen.getByTestId('player-stage-input');
    const close = screen.getByTestId('player-close');
    const toggle = screen.getByTestId('player-toggle');
    const closeWatch = async () => {
      if (!await stage.isVisible()) return;
      if (await toggle.getAttribute('aria-label') === 'Pause') {
        await stage.press('k');
        await expect(toggle).toHaveAttribute('aria-label', 'Play');
      }
      await close.tap();
      await expect(stage).toBeHidden();
    };
    try {
      for (const [event, channel] of [['nfl-nyg-phi', 'channel-7'], ['nhl-tor-mtl', 'channel-29']] as const) {
        await app.open('/vela/screen/sports/game?event=' + encodeURIComponent('event:sports:sports:' + event));
        await expect(start).toBeVisible({ timeout: 30_000 });
        await app.screenshot('sports-watch-from-start-' + event);
        await start.tap();
        await expect(screen.getByTestId('player-live-timeline')).toBeVisible({ timeout: 35_000 });
        const request = await browser.evaluate(async () => (await fetch('/__e2e/last-playback')).json()) as {
          kind: string; channelId: string; from: string; programmeId: string;
        };
        expect(request).toMatchObject({ kind: 'channel', channelId: channel, from: 'start' });
        expect(request.programmeId).toMatch(/^catchup:/);
        await expect(scoreBug).toBeVisible({ timeout: 25_000 });
        if (event === 'nfl-nyg-phi') {
          await expect(scoreBug.getByText(/^17$/)).toBeVisible();
          await expect(scoreBug.getByText(/^24$/)).toBeVisible();
          await expect(scoreBug.getByText(/^27$/)).toBeHidden();
        } else {
          await expect(screen.getByTestId('player-scores-hidden')).toHaveText('Scores hidden while behind live');
          await expect(screen.getByTestId('score-bug-reveal')).toBeHidden();
        }
        await waitForVideoReady(browser, screen);
        await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 30_000 });
        await stage.press('k');
        await expect(toggle).toHaveAttribute('aria-label', 'Play');
        await app.screenshot('sports-score-' + event);
        await closeWatch();
        await expect(start).toBeVisible({ timeout: 30_000 });
      }
    } finally {
      try { await closeWatch(); }
      finally { expect(await setFixture(false)).toBe(false); }
    }
  });
});
