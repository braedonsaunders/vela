import { expect, secrets } from 'e2e';
import { describe, test } from '@e2e-dev/web';

test.setup('Home release gate: a fresh sign-in opens Home', { sessions: ['lab-viewer'] }, async ({ app, browser, screen, session }) => {
  await app.clearState();
  await screen.getByRole('textbox', 'Username').fill(secrets.get('viewerUsername'));
  await screen.getByRole('textbox', 'Password').fill(secrets.get('viewerPassword'));
  await screen.getByRole('button', 'Sign in').tap();

  await expect(screen.getByRole('navigation')).toBeVisible();
  await expect(screen.getByRole('link', 'Home')).toBeVisible();

  // Every run owns its watch-state baseline, including recovery after an interrupted prior run.
  const campus = '/vela/title/0000000000000001000e38bc2766e111';
  await app.open(campus);
  const watchAction = screen.getByTestId('detail-watch-played');
  await expect(watchAction).toBeVisible({ timeout: 30_000 });
  if (await watchAction.getAttribute('aria-label') === 'Mark unwatched') {
    await watchAction.tap();
    await expect(screen.getByRole('button', 'Mark watched')).toBeVisible();
  }

  try {
    await app.open('/vela/');
    const rowHeadings = screen.getByRole('heading', /^See all /);
    await expect(rowHeadings.first()).toBeVisible({ timeout: 30_000 });
    const rows = (await rowHeadings.allTextContents()).map(row => row.replace(/\s*›$/, ''));
    const bootstrapRows = await browser.evaluate(async () => {
      const response = await fetch('/__e2e/bootstrap-row-names');
      if (!response.ok) throw new Error(`bootstrap row capture HTTP ${response.status}`);
      return response.json() as Promise<string[]>;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows).size).toBe(rows.length);
    const rendered = new Set(rows);
    expect(rows).toEqual(bootstrapRows.filter(row => rendered.has(row)));
    for (const row of rows) {
      await expect(screen.getByRole('link', `See all ${row}`)).toHaveCount(2);
    }

    await app.open('/vela/search?q=Campus%20Drivers');
    const result = screen.getByRole('link', 'Open Campus Drivers, 2026').first();
    await expect(result).toBeVisible({ timeout: 30_000 });
    await result.tap();
    await expect(screen.getByRole('heading', 'Campus Drivers')).toBeVisible();
    await expect(screen.getByRole('status', 'Episodes · Loading more…')).toBeHidden({ timeout: 30_000 });
    await expect(screen.getByTestId('detail-frame')).toBeVisible();
    await expect(screen.getByRole('link', 'Play S1 · E1')).toBeVisible();
    expect(await browser.evaluate(() => Math.max(
      window.scrollY,
      ...Array.from(document.querySelectorAll<HTMLElement>('[data-testid="detail-frame"] *'), element => element.scrollTop),
    ))).toBe(0);

    await app.open('/vela/watch/0000000000000001000e38bc2766e111');
    await expect(screen.getByText('S1 · E1 · Heartbreak')).toBeVisible({ timeout: 30_000 });
    const scrubber = screen.getByTestId('player-scrub');
    await expect(scrubber).toBeEnabled({ timeout: 30_000 });
    await scrubber.press('End');
    await expect(screen.getByText('46:02')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Play').tap();
    await expect(screen.getByRole('button', 'Finished')).toBeVisible({ timeout: 45_000 });
    await screen.getByRole('button', 'Close player').tap();
    await expect(screen.getByRole('link', 'Home')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('heading', 'Up Next')).toHaveCount(1, { timeout: 30_000 });
    await expect(screen.getByRole('link', 'Open New Girl, 2026')).toHaveCount(2);
    await expect(screen.getByRole('link', 'Open New Girl, 2026').first()).toBeVisible();

    await screen.getByRole('link', 'See all Trending Now').last().tap();
    await expect(screen.getByRole('heading', 'Trending Now')).toBeVisible({ timeout: 30_000 });
  } finally {
    const close = screen.getByRole('button', 'Close player');
    if (await close.isVisible()) await close.tap();
    await app.open(campus);
    const cleanupWatchAction = screen.getByTestId('detail-watch-played');
    await expect(cleanupWatchAction).toBeVisible({ timeout: 30_000 });
    if (await cleanupWatchAction.getAttribute('aria-label') === 'Mark unwatched') await cleanupWatchAction.tap();
    await expect(cleanupWatchAction).toHaveAttribute('aria-label', 'Mark watched', { timeout: 30_000 });
  }

  await session.save('lab-viewer');
});

describe('Sports release gate', { session: 'lab-viewer' }, () => {
  test('index and a live game page expose the current airing', async ({ app, screen }) => {
    await app.open('/vela/screen/sports');
    await expect(screen.getByTestId('sports-screen-sports')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('heading', 'Sports')).toBeVisible();
    await expect(screen.getByTestId('sports-hero')).toBeVisible();
    await screen.getByTestId('sports-hero-details').tap();

    await expect(screen.getByTestId('sports-game')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('sports-game-centre')).toBeVisible();
  });
});
