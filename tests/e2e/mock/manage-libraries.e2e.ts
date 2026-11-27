import { expect, type Screen } from 'e2e';
import { describe, test, type Browser } from '@e2e-dev/web';
import { signInMockViewer } from './sign-in';

const PREFERENCE = 'vela.pref.library-order';
// The manager's rows in order, a hidden one marked.
const managerRows = (browser: Browser) => browser.evaluate(() => [...document.querySelectorAll('[data-testid^="library-row-"]')]
  .filter(row => row.getBoundingClientRect().width > 0)
  .map(row => `${row.getAttribute('data-testid')!.slice('library-row-'.length)}${row.textContent?.includes('Hidden') ? ' (hidden)' : ''}`));
const openManager = async (screen: Screen) => {
  await screen.getByTestId('profile-menu').tap();
  await screen.getByTestId('manage-libraries').tap();
  await expect(screen.getByRole('heading', 'Manage libraries')).toBeVisible({ timeout: 30_000 });
};
const clearPreference = (browser: Browser) =>
  browser.evaluate(key => { try { localStorage.removeItem(key); } catch { /* No page to clear. */ } }, PREFERENCE).catch(() => {});
// The mock's libraries after its first three, in the server's order.
const later = ['live', 'videos', 'all', 'music', 'books', 'audiobooks', 'podcasts', 'photos'];
// The skin a viewer picked is kept per server and viewer (vela.pref.skin.<origin>.<viewer>).
const clearSkin = (browser: Browser) => browser.evaluate(() => {
  try { for (const key of Object.keys(localStorage)) if (key.startsWith('vela.pref.skin')) localStorage.removeItem(key); } catch { /* No page to clear. */ }
}).catch(() => {});
const pickSkin = async (screen: Screen, name: string) => {
  await expect(screen.getByRole('heading', 'Appearance')).toBeVisible();
  await screen.getByRole('button', name).tap();
  await expect(screen.getByRole('heading', 'Appearance')).toBeHidden();
};
// The library row that holds the focused control, and that control's name.
const focusedRow = (browser: Browser) => browser.evaluate(() => {
  const focused = document.activeElement;
  return { row: focused?.closest('[data-testid^="library-row-"]')?.getAttribute('data-testid') ?? '', label: focused?.getAttribute('aria-label') ?? '' };
});

describe('Manage libraries release gate', () => {
  test('a phone viewer reorders and hides libraries in the menu from the profile menu, keeps it after a reload, and resets it', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    await browser.setViewport({ width: 390, height: 844 });
    // The libraries in the manager, and the destinations of the phone's navigation menu, in order.
    const rows = () => managerRows(browser);
    const menu = async (names: string[]) => {
      await screen.getByTestId('mobile-navigation').tap();
      const navigation = screen.getByRole('navigation', 'Main navigation');
      await expect(navigation).toBeVisible();
      await expect.poll(() => browser.evaluate(() => [...document.querySelectorAll('[role=navigation][aria-label="Main navigation"] [aria-label]')]
        .filter(item => item.getBoundingClientRect().width > 0).map(item => item.getAttribute('aria-label')))).toEqual(names);
      await screen.getByTestId('mobile-navigation').tap();
      await expect(navigation).toBeHidden();
    };
    const manage = () => openManager(screen);
    const rest = ['Creator videos', 'Studio Collection', 'Music', 'Books', 'Audiobooks', 'Podcasts', 'Photos'];
    const serverMenu = ['Home', 'Movies', 'TV Shows', 'Our Living World', 'Live TV', 'Sports', ...rest];
    try {
      await menu(serverMenu);

      await manage();
      await expect.poll(rows).toEqual(['movies', 'shows', 'documentaries', ...later]);
      await expect(screen.getByRole('button', 'Move Movies up')).toBeDisabled();
      await screen.getByRole('button', 'Move TV Shows up').tap();
      await screen.getByRole('button', 'Hide Our Living World').tap();
      // The hidden library stays in its place in the list, marked hidden, with Show in place of Hide.
      await expect.poll(rows).toEqual(['shows', 'movies', 'documentaries (hidden)', ...later]);
      await expect(screen.getByRole('button', 'Show Our Living World')).toBeVisible();
      const page = await browser.evaluate(() => document.documentElement.scrollWidth);
      expect(page).toBe(390);

      await screen.getByRole('button', 'Back').tap();
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeHidden();
      const arranged = ['Home', 'TV Shows', 'Movies', 'Live TV', 'Sports', ...rest];
      await menu(arranged);

      // Kept on this device: the same order after a reload, and in the manager.
      await app.open('/vela/');
      await expect(screen.getByTestId('mobile-navigation')).toBeVisible({ timeout: 30_000 });
      await menu(arranged);
      await manage();
      await expect.poll(rows).toEqual(['shows', 'movies', 'documentaries (hidden)', ...later]);

      // Reset asks first, then puts back the server's order with every library shown.
      await screen.getByRole('button', 'Reset').tap();
      await screen.getByRole('button', 'Cancel').tap();
      await expect(screen.getByRole('button', 'Cancel')).toBeHidden();
      expect(await rows()).toEqual(['shows', 'movies', 'documentaries (hidden)', ...later]);
      await screen.getByRole('button', 'Reset').tap();
      await expect(screen.getByRole('button', 'Cancel')).toBeVisible();
      await screen.getByRole('button', 'Reset').tap();
      await expect.poll(rows).toEqual(['movies', 'shows', 'documentaries', ...later]);
      await expect.poll(() => browser.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), PREFERENCE)).toEqual({});
      await screen.getByRole('button', 'Back').tap();
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeHidden();
      await menu(serverMenu);
    } finally {
      // The choice lives in this browser only; nothing on the mock server changes.
      await clearPreference(browser);
    }
  });

  test('a library list the server could not give says so, and Try again reads it again', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    await browser.setViewport({ width: 390, height: 844 });
    const list = /\/vela\/v0\/libraries(\?|$)/;
    let refuse = true;
    await browser.route(list, async route => {
      if (!refuse) return route.continue();
      await route.fulfill({ status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ error: { class: 'transient', code: 'unavailable', message: 'Libraries are unavailable', retry: { allowed: false } } }) });
    });
    const failed = screen.getByText('Couldn’t load the libraries from this server.');
    try {
      await app.open('/vela/libraries');
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeVisible({ timeout: 30_000 });
      await expect(failed).toBeVisible({ timeout: 30_000 });
      expect(await managerRows(browser)).toEqual([]);
      refuse = false;
      await screen.getByRole('button', 'Try again').tap();
      await expect.poll(() => managerRows(browser)).toEqual(['movies', 'shows', 'documentaries', ...later]);
      await expect(failed).toBeHidden();
    } finally {
      await browser.unroute(list);
    }
  });

  test('Home still preparing offers the libraries in the viewer order, without the hidden ones', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    await browser.setViewport({ width: 390, height: 844 });
    const offered = () => browser.evaluate(() => [...document.querySelectorAll('[data-testid^="home-library-"]')]
      .filter(item => item.getBoundingClientRect().width > 0).map(item => item.getAttribute('data-testid')!.slice('home-library-'.length)));
    // Home's read is held past the point where it says it is still preparing.
    const bootstrap = /\/vela\/v0\/bootstrap(\?|$)/;
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    try {
      await openManager(screen);
      await screen.getByRole('button', 'Move TV Shows up').tap();
      await screen.getByRole('button', 'Hide Our Living World').tap();
      await expect.poll(() => managerRows(browser)).toEqual(['shows', 'movies', 'documentaries (hidden)', ...later]);
      await browser.route(bootstrap, async route => {
        await held;
        await route.continue().catch(() => { /* The page went on without it. */ });
      });
      await app.open('/vela/');
      await expect(screen.getByTestId('home-still-loading')).toBeVisible({ timeout: 30_000 });
      await expect.poll(offered).toEqual(['shows', 'movies', ...later]);
    } finally {
      release();
      await browser.unroute(bootstrap);
      await clearPreference(browser);
    }
  });

  test('two libraries with the same name and kind are told apart, and each Hide acts on its own', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    await browser.setViewport({ width: 390, height: 844 });
    // The server names a second library of kind movies "Movies" too.
    const list = /\/vela\/v0\/libraries(\?|$)/;
    await browser.route(list, async route => {
      const response = await route.fetch();
      if (response.status !== 200) return route.continue();
      const body = await response.json<{ items: { id: string; name: string; kind: string }[] }>();
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        json: { ...body, items: body.items.map(item => item.id === 'documentaries' ? { ...item, name: 'Movies' } : item) } });
    });
    const detail = (id: string) => browser.evaluate(row => document.querySelector(`[data-testid="library-row-${row}"]`)?.textContent ?? '', id);
    try {
      await app.open('/vela/libraries');
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => managerRows(browser)).toEqual(['movies', 'shows', 'documentaries', ...later]);
      expect(await detail('movies')).toContain('movies · 1');
      expect(await detail('documentaries')).toContain('movies · 2');
      await expect(screen.getByRole('button', 'Move Movies, movies 1 up')).toBeDisabled();
      await screen.getByRole('button', 'Hide Movies, movies 2').tap();
      await expect.poll(() => managerRows(browser)).toEqual(['movies', 'shows', 'documentaries (hidden)', ...later]);
      expect(await detail('documentaries')).toContain('movies · 2 · Hidden');
      await expect(screen.getByRole('button', 'Show Movies, movies 2')).toBeVisible();
      await screen.getByRole('button', 'Hide Movies, movies 1').tap();
      await expect.poll(() => managerRows(browser)).toEqual(['movies (hidden)', 'shows', 'documentaries (hidden)', ...later]);
      await screen.getByRole('button', 'Show Movies, movies 2').tap();
      await expect.poll(() => managerRows(browser)).toEqual(['movies (hidden)', 'shows', 'documentaries', ...later]);
      // The number is the server's place, so it stays with the library when the viewer moves it.
      await screen.getByRole('button', 'Move Movies, movies 2 up').tap();
      await screen.getByRole('button', 'Move Movies, movies 2 up').tap();
      await expect.poll(() => managerRows(browser)).toEqual(['documentaries', 'movies (hidden)', 'shows', ...later]);
      expect(await detail('documentaries')).toContain('movies · 2');
      expect(await detail('documentaries')).not.toContain('Hidden');
      expect(await detail('movies')).toContain('movies · 1 · Hidden');
    } finally {
      await browser.unroute(list);
      await clearPreference(browser);
    }
  });

  test('Enter on a move keeps focus in the moved row, also once it reaches the end', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    await browser.setViewport({ width: 1440, height: 900 });
    try {
      await openManager(screen);
      await expect.poll(() => managerRows(browser)).toEqual(['movies', 'shows', 'documentaries', ...later]);
      const middle = screen.getByRole('button', 'Move TV Shows down');
      await middle.focus();
      await middle.press('Enter');
      await expect.poll(() => managerRows(browser)).toEqual(['movies', 'documentaries', 'shows', ...later]);
      await expect.poll(() => focusedRow(browser)).toEqual({ row: 'library-row-shows', label: 'Move TV Shows down' });
      // Podcasts reaches the bottom: its Move down turns off and focus goes to its Move up.
      const end = screen.getByRole('button', 'Move Podcasts down');
      await end.focus();
      await end.press('Enter');
      await expect.poll(() => managerRows(browser)).toEqual(['movies', 'documentaries', 'shows', 'live', 'videos', 'all', 'music', 'books', 'audiobooks', 'photos', 'podcasts']);
      await expect(screen.getByRole('button', 'Move Podcasts down')).toBeDisabled();
      await expect.poll(() => focusedRow(browser)).toEqual({ row: 'library-row-podcasts', label: 'Move Podcasts up' });
    } finally {
      await clearPreference(browser);
    }
  });

  test('Broadcast and Index offer the manager, and a hidden Live TV leaves their navigation while Home still loads', async ({ app, browser, screen }) => {
    await signInMockViewer(app, screen);
    await browser.setViewport({ width: 1440, height: 900 });
    // Broadcast's home draws the live monitor and its in-page Full guide controls (env.canLive).
    const fullGuide = () => browser.evaluate(() => [...document.querySelectorAll('[aria-label="Full guide"]')].filter(item => item.getBoundingClientRect().width > 0).length);
    try {
      await openManager(screen);
      await screen.getByRole('button', 'Hide Live TV').tap();
      await expect(screen.getByRole('button', 'Show Live TV')).toBeVisible();
      await screen.getByRole('button', 'Back').tap();
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeHidden();

      await screen.getByTestId('profile-menu').tap();
      await screen.getByTestId('skin-picker').tap();
      await pickSkin(screen, 'Broadcast');
      await expect(screen.getByRole('link', 'Live')).toBeVisible({ timeout: 30_000 });
      await expect.poll(fullGuide, { timeout: 30_000 }).toBeGreaterThan(0);
      await expect(screen.getByRole('link', 'Guide')).toBeHidden();
      await screen.getByTestId('profile-menu').tap();
      await screen.getByTestId('manage-libraries').tap();
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('button', 'Show Live TV')).toBeVisible();
      await screen.getByRole('button', 'Back').tap();
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeHidden();

      await screen.getByTestId('profile-menu').tap();
      await screen.getByRole('button', 'Appearance').tap();
      await pickSkin(screen, 'Index');
      await expect(screen.getByRole('link', 'Home')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('link', 'Movies')).toBeVisible();
      await expect(screen.getByRole('link', 'Live TV')).toBeHidden();
      // Index's reader menu opens from the viewer's plate in its rail.
      await screen.getByTestId('profile-menu').tap();
      await screen.getByTestId('manage-libraries').tap();
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeVisible({ timeout: 30_000 });
      await screen.getByRole('button', 'Show Live TV').tap();
      await expect(screen.getByRole('button', 'Hide Live TV')).toBeVisible();
      await screen.getByRole('button', 'Back').tap();
      await expect(screen.getByRole('heading', 'Manage libraries')).toBeHidden();
      // Shown again, Live TV is back in Index's rail.
      await expect(screen.getByRole('link', 'Live TV')).toBeVisible();
    } finally {
      await clearPreference(browser);
      await clearSkin(browser);
    }
  });
});
