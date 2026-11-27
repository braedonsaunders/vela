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
        same: !!input && input === (globalThis as { phoneField?: Element }).phoneField,
        value: (input as HTMLInputElement | null)?.value ?? null,
        cards: [...document.querySelectorAll('[aria-label^="Open "]')].filter(card => card.getBoundingClientRect().width > 0).map(box)
          .sort((a, b) => a.top - b.top || a.left - b.left),
        page: document.documentElement.scrollWidth,
      };
    });

    // A name no other run or playlist uses, so the cleanup below can find it while its id is not known yet.
    const temporary = `Late night ${Math.random().toString(36).slice(2, 7)}`;
    // One session of its own on the mock's API for every call below, revoked at the end.
    const cleanup = await browser.evaluate(async () => {
      const device = `e2e-cleanup-${crypto.randomUUID()}`;
      const reply = await fetch('/vela/v0/auth/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'vela', device: { id: device, name: 'Playlists e2e cleanup', platform: 'web', appVersion: '0.1' }, idempotencyKey: crypto.randomUUID() }) });
      if (!reply.ok) throw new Error(`cleanup sign-in: ${reply.status}`);
      const tokens = await reply.json() as { accessToken: string; refreshToken: string };
      return { device, access: tokens.accessToken, refresh: tokens.refreshToken };
    });
    type Call = { session: typeof cleanup; method: string; path: string; body: Record<string, string> | null };
    const call = (input: Call) => browser.evaluate(async ({ session, method, path, body }: Call) => {
      const reply = await fetch(`/vela/v0${path}`, { method, cache: 'no-store',
        headers: { Authorization: `Bearer ${session.access}`, 'X-Vela-Device-Id': session.device, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }) } : {}) });
      return { status: reply.status, data: reply.ok ? await reply.json() as { items?: { id: string; name: string }[] } : null };
    }, input);
    // The id of the temporary playlist once the mock has stored it, else null.
    const stored = async () => {
      const list = await call({ session: cleanup, method: 'GET', path: '/playlists?limit=100', body: null });
      if (list.status !== 200) throw new Error(`cleanup list: ${list.status}`);
      return list.data!.items!.find(item => item.name === temporary)?.id ?? null;
    };
    let tapped = false;
    let id: string | null = null;
    try {
      await browser.setViewport({ width: 390, height: 844 });
      await app.open('/vela/playlists');
      await expect(screen.getByRole('textbox', 'New playlist name')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('button', 'Open Weekend watch')).toBeVisible();
      await expect(screen.getByRole('button', 'Open Recently added')).toBeVisible();
      // A third playlist: two cards fit side by side whatever the column count, three do not.
      await screen.getByRole('textbox', 'New playlist name').fill(temporary);
      tapped = true;
      await screen.getByRole('button', 'New').tap();
      // The card shows before the server answers: wait until the mock has the playlist, so a failing check below still leaves an id to delete.
      await expect.poll(async () => (id = await stored()) !== null, { timeout: 10_000 }).toBe(true);
      await expect(screen.getByRole('button', `Open ${temporary}`)).toBeVisible({ timeout: 10_000 });
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

      // A draft name: the field must stay the same element, text and all, when the header goes to one row.
      await screen.getByRole('textbox', 'New playlist name').fill('Draft');
      await browser.evaluate(() => { (globalThis as { phoneField?: Element }).phoneField = document.querySelector('[aria-label="New playlist name"]') ?? undefined; });

      for (const [width, height] of [[844, 390], [820, 1180]] as const) {
        await browser.setViewport({ width, height });
        await expect.poll(async () => { const view = await geometry(); return view.input!.top < view.heading!.bottom && view.cards.length === 3 && view.cards[2]!.top === view.cards[0]!.top; }, { timeout: 10_000 }).toBe(true);
        const wide = await geometry();
        expect(wide.heading!.height).toBeLessThan(50);
        expect(wide.cards.map(card => card.top)).toEqual([wide.cards[0]!.top, wide.cards[0]!.top, wide.cards[0]!.top]);
        expect(wide.page).toBe(width);
        expect(wide.same).toBe(true);
        expect(wide.value).toBe('Draft');
      }
      await screen.getByRole('textbox', 'New playlist name').fill('');

      // Delete it again through the screen, as a viewer would.
      await screen.getByRole('button', `Open ${temporary}`).tap();
      await screen.getByTestId('manage-playlist').tap();
      await screen.getByTestId('delete-playlist').tap();
      await screen.getByTestId('confirm-delete-playlist').tap();
      await expect(screen.getByRole('textbox', 'New playlist name')).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => (await geometry()).cards.length, { timeout: 10_000 }).toBe(2);
    } finally {
      // Leave the mock's playlists as they were, also when a check above failed: through the mock's API, not the screen.
      await browser.setViewport({ width: 1440, height: 900 }).catch(() => {});
      try {
        // Failed between the tap and the id: give a pending create a few seconds to land.
        const until = Date.now() + 5_000;
        while (tapped && id === null && Date.now() < until) {
          id = await stored();
          if (id === null) await new Promise(done => setTimeout(done, 250));
        }
        if (id !== null) {
          const reply = await call({ session: cleanup, method: 'DELETE', path: `/playlists/${encodeURIComponent(id)}`, body: {} });
          if (reply.status !== 200 && reply.status !== 404) throw new Error(`cleanup delete: ${reply.status}`);
        }
      } finally {
        const reply = await call({ session: cleanup, method: 'POST', path: '/auth/revoke', body: { refreshToken: cleanup.refresh } });
        if (reply.status !== 200) throw new Error(`cleanup sign-out: ${reply.status}`);
      }
    }
  });
});
