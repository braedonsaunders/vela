import { expect, secrets } from 'e2e';
import { describe, test } from '@e2e-dev/web';

describe('Home release gate', () => {
  test('a fresh sign-in opens Home', async ({ agent, app, browser, screen }) => {
    await app.clearState();

    await agent.act('sign in with the dedicated viewer credentials', {
      params: {
        username: secrets.get('viewerUsername'),
        password: secrets.get('viewerPassword'),
      },
    });

    await expect(screen.getByRole('navigation')).toBeVisible();
    await expect(screen.getByRole('link', 'Home')).toBeVisible();

    const rowHeadings = screen.getByRole('heading', /^See all /);
    await expect(rowHeadings.first()).toBeVisible({ timeout: 30_000 });
    const rows = (await rowHeadings.allTextContents()).map(row => row.replace(/\s*›$/, ''));
    const offset = rows[0] === 'New & Noteworthy' ? 1 : 0;
    expect(rows).toHaveLength(9 + offset);
    expect(rows[offset]).toBe('Trending Now');
    expect(rows.slice(offset + 1, offset + 4).every(row => row.startsWith('Acclaimed '))).toBe(true);
    expect(rows.slice(offset + 4)).toEqual([
      'Popular on Ether On Air Lab',
      'TVmaze acclaimed series',
      'Top Rated',
      'Short on Time',
      'On Now',
    ]);
    for (const row of rows) {
      await expect(screen.getByRole('link', `See all ${row}`)).toHaveCount(2);
    }

    // Every run owns its watch-state baseline, including recovery after an interrupted prior run.
    await app.open('/vela/title/0000000000000001000e38bc2766e111');
    const watchAction = screen.getByTestId('detail-watch-played');
    await expect(watchAction).toBeVisible({ timeout: 30_000 });
    if (await watchAction.getAttribute('aria-label') === 'Mark unwatched') {
      await watchAction.tap();
      await expect(screen.getByRole('button', 'Mark watched')).toBeVisible();
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

    await app.open('/vela/title/0000000000000001000e38bc2766e111');
    await expect(screen.getByRole('button', 'Mark unwatched')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Mark unwatched').tap();
    await expect(screen.getByRole('button', 'Mark watched')).toBeVisible();
  });
});
