import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { signInMockViewer } from './sign-in';

describe('Library tab strip layout release gate', () => {
  test('a collections tab gives the tabs their own row on a phone and keeps one row from 820 px up', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    const geometry = () => browser.evaluate(() => {
      const box = (element: Element | null) => { if (!element) return null; const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }; };
      const visible = (element: Element) => element.getBoundingClientRect().width > 0;
      const search = [...document.querySelectorAll('input[aria-label="Search Collections"]')].find(visible) ?? null;
      return {
        strip: box([...document.querySelectorAll('[role=tablist]')].find(visible) ?? null),
        selected: box([...document.querySelectorAll('[role=tab][aria-selected=true]')].find(visible) ?? null),
        arrows: [...document.querySelectorAll('[role=button][aria-label$=" tabs"]')].filter(visible).map(box),
        search: box(search),
        same: !!search && search === (globalThis as { phoneSearch?: Element }).phoneSearch,
        value: (search as HTMLInputElement | null)?.value ?? null,
        page: document.documentElement.scrollWidth,
      };
    });

    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/vela/library/movies');
    await screen.getByRole('tab', 'Collections').first().tap();
    await expect(screen.getByRole('textbox', 'Search Collections')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => { const view = await geometry(); return view.search!.top >= view.strip!.bottom; }, { timeout: 10_000 }).toBe(true);
    // The strip scrolls the selected tab into view, smoothly on WebKit: wait until it has settled
    // wholly inside the strip and clear of the overflow arrows.
    await expect.poll(async () => {
      const view = await geometry();
      return view.selected!.left >= view.strip!.left && view.selected!.right <= view.strip!.right
        && view.arrows.every(arrow => arrow!.right <= view.selected!.left || arrow!.left >= view.selected!.right);
    }, { timeout: 10_000 }).toBe(true);
    const phone = await geometry();
    // The selected tab is wholly inside the strip and clear of its overflow arrows; the search fills the row below.
    expect(phone.selected!.width).toBeGreaterThan(60);
    expect(phone.selected!.left).toBeGreaterThanOrEqual(phone.strip!.left);
    expect(phone.selected!.right).toBeLessThanOrEqual(phone.strip!.right);
    for (const arrow of phone.arrows) expect(arrow!.right <= phone.selected!.left || arrow!.left >= phone.selected!.right).toBe(true);
    expect(phone.search!.width).toBeGreaterThan(300);
    expect(phone.page).toBe(390);

    // Fill the field, then check it is the same element with its text across the resizes.
    await screen.getByRole('textbox', 'Search Collections').fill('zz');
    await browser.evaluate(() => {
      const search = [...document.querySelectorAll('input[aria-label="Search Collections"]')].find((element) => element.getBoundingClientRect().width > 0);
      (globalThis as { phoneSearch?: Element }).phoneSearch = search;
    });
    for (const [width, height] of [[844, 390], [820, 1180], [1440, 900]] as const) {
      await browser.setViewport({ width, height });
      await expect.poll(async () => { const view = await geometry(); return view.search!.top < view.strip!.bottom; }, { timeout: 10_000 }).toBe(true);
      const wide = await geometry();
      expect(wide.search!.width).toBe(220);
      expect(wide.same).toBe(true);
      expect(wide.value).toBe('zz');
      expect(wide.page).toBe(width);
    }
    await expect(screen.getByRole('textbox', 'Search Collections')).toHaveValue('zz');
    await screen.getByRole('textbox', 'Search Collections').fill('');
  });
});
