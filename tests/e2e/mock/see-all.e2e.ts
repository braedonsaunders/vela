import { expect, type Locator } from 'e2e';
import { describe, test, type Browser } from '@e2e-dev/web';

async function revealRowLink(browser: Browser, link: Locator) {
  await browser.mouse.move(720, 700);
  await expect.poll(async () => {
    if (await link.isVisible()) return true;
    await browser.mouse.wheel(0, 1_600);
    return false;
  }, { timeout: 30_000 }).toBe(true);
}

describe('See all deterministic release gate', { session: 'mock-see-all' }, () => {
  test('a 409 row id recovers after one stale cached bootstrap', async ({ app, browser, screen }) => {
    await app.restart();

    await expect(screen.getByRole('link', 'Home')).toBeVisible({ timeout: 30_000 });
    const oldLink = screen.getByRole('link', /^See all /).first();
    await revealRowLink(browser, oldLink);
    await expect(oldLink).toBeVisible({ timeout: 30_000 });
    const oldHref = await oldLink.getAttribute('href');
    const label = await oldLink.getAttribute('aria-label');
    expect(oldHref).toBeTruthy();
    expect(label).toMatch(/^See all /);
    const oldRowId = decodeURIComponent(oldHref!.split('/').at(-1)!);
    const recoveredLink = screen.getByRole('link', label!).first();
    await expect(recoveredLink).toHaveAttribute('href', oldHref!);
    // Simulate another client's feed change while the current Home shows the old row id.
    expect(await browser.evaluate(async oldRowId => (await fetch('/__admin/remint-home', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bootstrapStaleReads: 1, oldRowId }),
    })).status, oldRowId)).toBe(200);

    try {
      await recoveredLink.tap();
      await expect(screen.getByRole('heading', label!.slice('See all '.length))).toBeVisible({ timeout: 45_000 });
      await expect(screen.getByRole('link', /^Open /).first()).toBeVisible();
      // Home can seed the first page. Scroll to its sentinel if opening the
      // collection did not already trigger a read of the old id.
      await browser.mouse.move(720, 700);
      await expect.poll(async () => {
        const observation = await browser.evaluate(async () => (await fetch('/__admin/remint-home')).json());
        if (observation.conflicts === 0) await browser.mouse.wheel(0, 1_600);
        return observation;
      }, { timeout: 30_000 }).toEqual({ oldRowId, conflicts: 1, staleReads: 1, recovered: true });
    } finally {
      expect(await browser.evaluate(async () => (await fetch('/__admin/remint-home', { method: 'DELETE' })).status))
        .toBe(200);
    }
  });
});
