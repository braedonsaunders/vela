import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { signInMockViewer } from './sign-in';

describe('Playlists layout release gate', () => {
  test('a phone stacks the create row under a one-line heading and wraps three cards into two columns; wider screens keep one row and three columns', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    const geometry = () => browser.evaluate(() => {
      const box = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const heading = [...document.querySelectorAll('div')].filter(element => element.textContent === 'Playlists' && !element.children.length && element.getClientRects().length > 0).pop();
      const input = document.querySelector('[aria-label="New playlist name"]');
      return {
        heading: heading ? box(heading) : null,
        input: input ? box(input) : null,
        cards: [...document.querySelectorAll('[aria-label^="Open "]')].filter(card => card.getBoundingClientRect().width > 0).map(box)
          .sort((a, b) => a.top - b.top || a.left - b.left),
        page: document.documentElement.scrollWidth,
      };
    });

    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/vela/playlists');
    await expect(screen.getByRole('textbox', 'New playlist name')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole('button', 'Open Weekend watch')).toBeVisible();
    await expect(screen.getByRole('button', 'Open Recently added')).toBeVisible();
    // A third playlist: two cards fit side by side whatever the column count, three do not.
    await screen.getByRole('textbox', 'New playlist name').fill('Late night films');
    await screen.getByRole('button', 'New').tap();
    await expect(screen.getByRole('button', 'Open Late night films')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await geometry()).cards.length).toBe(3);
    const phone = await geometry();
    expect(phone.heading!.width).toBeGreaterThan(100);
    expect(phone.heading!.height).toBeLessThan(50);
    expect(phone.input!.top).toBeGreaterThanOrEqual(phone.heading!.bottom);
    const [first, second, third] = phone.cards;
    expect(second!.top).toBe(first!.top);
    expect(second!.right).toBeLessThanOrEqual(390);
    // The third card starts the second row, in the first column and no wider than the cards above.
    expect(third!.top).toBeGreaterThan(first!.bottom);
    expect(third!.left).toBe(first!.left);
    expect(third!.width).toBe(first!.width);
    expect(phone.page).toBe(390);

    for (const [width, height] of [[844, 390], [820, 1180]] as const) {
      await browser.setViewport({ width, height });
      await expect.poll(async () => { const view = await geometry(); return view.input!.top < view.heading!.bottom && view.cards.length === 3 && view.cards[2]!.top === view.cards[0]!.top; }, { timeout: 10_000 }).toBe(true);
      const wide = await geometry();
      expect(wide.heading!.height).toBeLessThan(50);
      expect(wide.cards.map(card => card.top)).toEqual([wide.cards[0]!.top, wide.cards[0]!.top, wide.cards[0]!.top]);
      expect(wide.page).toBe(width);
    }

    // Restore the mock's playlists.
    await screen.getByRole('button', 'Open Late night films').tap();
    await screen.getByTestId('manage-playlist').tap();
    await screen.getByTestId('delete-playlist').tap();
    await screen.getByTestId('confirm-delete-playlist').tap();
    await expect(screen.getByRole('textbox', 'New playlist name')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await geometry()).cards.length, { timeout: 10_000 }).toBe(2);
    await browser.setViewport({ width: 1440, height: 900 });
  });
});
