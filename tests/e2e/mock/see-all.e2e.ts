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
      if (rowConflicts === 0) {
        rowConflicts += 1;
        await route.fulfill({ status: 409, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
          body: JSON.stringify({ error: { class: 'conflict', code: 'cursor_expired', message: 'Refresh from first page', retry: { allowed: false } } }) });
        return;
      }
      const response = await route.fetch();
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
    const watchCard = screen.getByRole('link', /^Open /).first();
    const watchHref = await watchCard.getAttribute('href');
    expect(watchHref).toMatch(/^\/vela\/title\//);
    await watchCard.tap();
    await expect(screen.getByRole('button', 'Mark watched')).toBeVisible({ timeout: 30_000 });
    // The watch mutation's Home reconciliation gets the first stale bootstrap. See all then gets
    // the second after its old id answers 409, waits, and succeeds on the following fresh read.
    expect(await browser.evaluate(async () => (await fetch('/__admin/faults', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bootstrapStaleReads: 1 }),
    })).status)).toBe(200);
    await screen.getByRole('button', 'Mark watched').tap();
    await expect(screen.getByRole('button', 'Mark unwatched')).toBeVisible();

    await screen.getByTestId('detail-close').tap();
    await expect(screen.getByTestId('nav-Home')).toBeVisible({ timeout: 30_000 });
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

    await app.open(watchHref!);
    await screen.getByRole('button', 'Mark unwatched').tap();
    await expect(screen.getByRole('button', 'Mark watched')).toBeVisible();
    await browser.unroute(rowRead);
  });
});
