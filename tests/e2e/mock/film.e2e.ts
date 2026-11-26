import { expect, type Locator } from 'e2e';
import { describe, test, type Browser } from '@e2e-dev/web';

async function seekFraction(scrubber: Locator, fraction: number) {
  const box = await scrubber.boundingBox();
  expect(box).not.toBeNull();
  await scrubber.tap({ position: { x: Math.max(1, box!.width * fraction), y: Math.max(1, box!.height / 2) } });
}

async function admin(browser: Browser, path: string, body: Record<string, string | number | boolean>) {
  return browser.evaluate(async ({ path, body }) => (await fetch('/__admin/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).status, { path, body });
}

async function position(scrubber: Locator) {
  return Number(await scrubber.getAttribute('aria-valuenow'));
}

async function originalLostRemaining(browser: Browser) {
  return browser.evaluate(async () => ((await (await fetch('/__admin/faults')).json()) as { originalLost409: number }).originalLost409);
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

  test('a lost original reopens the replacement at the held position and names its release', async ({ app, browser, screen }) => {
    await app.open('/vela/title/title-1-1');
    expect(await admin(browser, 'sidecar', { enabled: true, pathId: 'direct' })).toBe(200);
    try {
      await expect(screen.getByRole('heading', 'The Last Observatory')).toBeVisible({ timeout: 30_000 });
      await screen.getByRole('button', /^Versions,/).tap();
      await screen.getByRole('radio', /4K Dolby Vision Remux/).tap();
      await expect(screen.getByRole('button', 'Close player')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('progressbar', 'Preparing your screening')).toBeHidden({ timeout: 30_000 });
      const scrubber = screen.getByTestId('player-scrub');
      await expect(scrubber).toBeEnabled({ timeout: 30_000 });
      await seekFraction(scrubber, 0.35);
      await expect.poll(() => position(scrubber), { timeout: 10_000 }).toBeGreaterThan(55);

      expect(await admin(browser, 'faults', { originalLost409: 1, originalLostVersionUnavailable: false })).toBe(200);
      await seekFraction(scrubber, 0.55);
      await screen.getByTestId('player-quality-button').tap();
      await expect(screen.getByRole('radio', /1080p WEB-DL · DD\+ 5\.1.*Playing now/)).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => position(scrubber), { timeout: 10_000 }).toBeGreaterThan(90);
      await screen.getByTestId('player-quality-button').tap();
      await screen.getByRole('button', 'Close player').tap();
    } finally {
      await admin(browser, 'faults', { originalLost409: 0, originalLostTruncate: 0, originalLostVersionUnavailable: false });
      await admin(browser, 'sidecar', { enabled: false });
    }
  });

  test('a pinned lost original opens the version picker without losing position', async ({ app, browser, screen }) => {
    await app.open('/vela/title/title-1-2');
    expect(await admin(browser, 'sidecar', { enabled: true, pathId: 'direct' })).toBe(200);
    try {
      await expect(screen.getByRole('button', /^Versions,/)).toBeVisible({ timeout: 30_000 });
      await screen.getByRole('button', /^Versions,/).tap();
      await screen.getByRole('radio', /4K Dolby Vision Remux/).tap();
      await expect(screen.getByRole('progressbar', 'Preparing your screening')).toBeHidden({ timeout: 30_000 });
      const scrubber = screen.getByTestId('player-scrub');
      await expect(scrubber).toBeEnabled({ timeout: 30_000 });
      await seekFraction(scrubber, 0.35);
      await expect.poll(() => position(scrubber), { timeout: 10_000 }).toBeGreaterThan(55);
      await screen.getByTestId('player-toggle').tap();
      await expect(screen.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Play');

      expect(await admin(browser, 'faults', { originalLost409: 1, originalLostVersionUnavailable: true })).toBe(200);
      await seekFraction(scrubber, 0.9);
      await expect.poll(() => originalLostRemaining(browser), { timeout: 60_000 }).toBe(0);
      await expect(screen.getByRole('radio', /4K Dolby Vision Remux.*Playing now/)).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => position(scrubber), { timeout: 10_000 }).toBeGreaterThan(155);
      await screen.getByTestId('player-quality-button').tap();
      await screen.getByRole('button', 'Close player').tap();
    } finally {
      await admin(browser, 'faults', { originalLost409: 0, originalLostTruncate: 0, originalLostVersionUnavailable: false });
      await admin(browser, 'sidecar', { enabled: false });
    }
  });
});
