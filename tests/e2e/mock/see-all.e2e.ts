import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';

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
    for (let page = 0; page < 6 && !await oldLink.isVisible(); page++) {
      await browser.evaluate(() => {
        for (const element of [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')]) {
          if (element && element.scrollHeight > element.clientHeight) element.scrollTop = element.scrollHeight;
        }
        return null;
      });
      await browser.evaluate(() => new Promise<null>(resolve => setTimeout(() => resolve(null), 500)));
    }
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
    for (let page = 0; page < 6 && !await recoveredLink.isVisible(); page++) {
      await browser.evaluate(() => {
        for (const element of [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')]) {
          if (element && element.scrollHeight > element.clientHeight) element.scrollTop = element.scrollHeight;
        }
        return null;
      });
      await browser.evaluate(() => new Promise<null>(resolve => setTimeout(() => resolve(null), 500)));
    }
    await expect(recoveredLink).toHaveAttribute('href', oldHref!);
    await recoveredLink.tap();
    await expect(screen.getByRole('heading', label!.slice('See all '.length))).toBeVisible({ timeout: 45_000 });
    await expect(screen.getByRole('link', /^Open /).first()).toBeVisible();
    for (let page = 0; page < 8 && rowConflicts === 0; page++) {
      await browser.evaluate(() => {
        for (const element of [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')]) {
          if (!element || element.scrollHeight <= element.clientHeight) continue;
          element.scrollTop = element.scrollHeight;
          element.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        return null;
      });
      await browser.evaluate(() => new Promise<null>(resolve => setTimeout(() => resolve(null), 500)));
    }
    expect(rowConflicts).toBe(1);
    expect(await browser.evaluate(async () => (await (await fetch('/__admin/faults')).json() as { bootstrapStaleReads: number }))).toMatchObject({ bootstrapStaleReads: 0 });

    await app.open(watchHref!);
    await screen.getByRole('button', 'Mark unwatched').tap();
    await expect(screen.getByRole('button', 'Mark watched')).toBeVisible();
    await browser.unroute(rowRead);
  });
});
