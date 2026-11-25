import { expect, type Locator } from 'e2e';
import { describe, test } from '@e2e-dev/web';

async function seekFraction(scrubber: Locator, fraction: number) {
  const box = await scrubber.boundingBox();
  expect(box).not.toBeNull();
  await scrubber.tap({ position: { x: Math.max(1, box!.width * fraction), y: Math.max(1, box!.height / 2) } });
}

describe('Film deterministic release gate', { session: 'mock-film' }, () => {
  test('versions report the release actually playing after failover', async ({ app, browser, screen }) => {
    await app.open('/vela/title/title-1-1');
    await expect(screen.getByRole('heading', 'The Last Observatory')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', /^Versions,/).tap();
    await expect(screen.getByTestId('versions-sheet')).toBeVisible();
    await expect(screen.getByText('Your choice')).toBeVisible();
    await expect(screen.getByRole('radio', /4K HDR10 Blu-ray/)).toBeEnabled();
    await expect(screen.getByRole('radio', /Director’s Cut/)).toBeDisabled();
    await screen.getByRole('radio', /4K Dolby Vision Remux/).tap();

    await expect(screen.getByRole('button', 'Close player')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('progressbar', 'Preparing your screening')).toBeHidden({ timeout: 30_000 });
    expect(await browser.evaluate(async () => (await fetch('/__admin/failover', { method: 'POST' })).status)).toBe(200);
    await screen.getByTestId('player-quality-button').tap();
    await expect(screen.getByRole('radio', /1080p WEB-DL · DD\+ 5\.1.*Playing now/)).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('player-quality-button').tap();
    await screen.getByRole('button', 'Close player').tap();
  });

  test('intro, credits, and final credits expose the right actions', async ({ app, screen }) => {
    await app.open('/vela/watch/episode-1-3');
    await expect(screen.getByText('S1 · E3 · Pressure Drop')).toBeVisible({ timeout: 30_000 });
    const scrubber = screen.getByTestId('player-scrub');
    await expect(scrubber).toBeEnabled({ timeout: 30_000 });
    await expect(screen.getByRole('progressbar', 'Preparing your screening')).toBeHidden({ timeout: 30_000 });

    await seekFraction(scrubber, 10 / 180);
    await expect(screen.getByTestId('player-skip-intro')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('player-skip-intro').tap();
    await seekFraction(scrubber, 30 / 180);
    await expect(screen.getByTestId('player-skip-intro')).toBeHidden();

    await seekFraction(scrubber, 145 / 180);
    await expect(screen.getByTestId('player-skip-credits')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('player-skip-credits').tap();
    await seekFraction(scrubber, 160 / 180);
    await expect(screen.getByTestId('player-skip-credits')).toBeHidden();

    await seekFraction(scrubber, 170 / 180);
    await expect(screen.getByTestId('player-skip-next')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('player-skip-next').tap();
    await expect(screen.getByText('S1 · E4 · A Distant Light')).toBeVisible({ timeout: 30_000 });
    await screen.getByRole('button', 'Close player').tap();
  });
});
