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
    let rowConflicts = 0;

    await app.restart();

    const rowRead = '**/vela/v0/rows/*';
    await browser.route(rowRead, async route => {
      const response = await route.fetch();
      if (response.status === 409) rowConflicts++;
      await route.fulfill({ status: response.status, headers: { ...response.headers }, body: await response.body() });
    });

    await expect(screen.getByRole('link', 'Home')).toBeVisible({ timeout: 30_000 });
    const oldLink = screen.getByRole('link', /^See all /).first();
    await revealRowLink(browser, oldLink);
    await expect(oldLink).toBeVisible({ timeout: 30_000 });
    const oldHref = await oldLink.getAttribute('href');
    const label = await oldLink.getAttribute('aria-label');
    expect(oldHref).toBeTruthy();
    expect(label).toMatch(/^See all /);
    // Simulate another client's feed change while the current Home still shows its old row id.
    expect(await browser.evaluate(async () => (await fetch('/__admin/remint-home', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bootstrapStaleReads: 1 }),
    })).status)).toBe(200);

    const recoveredLink = screen.getByRole('link', label!).first();
    await revealRowLink(browser, recoveredLink);
    await expect(recoveredLink).toHaveAttribute('href', oldHref!);
    await recoveredLink.tap();
    await expect(screen.getByRole('heading', label!.slice('See all '.length))).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByRole('link', /^Open /).first()).toBeVisible();
    await browser.mouse.move(720, 700);
    await expect.poll(async () => {
      if (rowConflicts === 0) await browser.mouse.wheel(0, 1_600);
      return rowConflicts;
    }, { timeout: 30_000 }).toBe(1);
    await expect.poll(() => browser.evaluate(async () => (await (await fetch('/__admin/faults')).json() as { bootstrapStaleReads: number }).bootstrapStaleReads),
      { timeout: 30_000 }).toBe(0);

    await browser.unroute(rowRead);
  });
});
