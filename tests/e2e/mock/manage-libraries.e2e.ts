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
  await screen.getByTestId('server-libraries').tap();
  await expect(screen.getByRole('heading', 'Manage libraries')).toBeVisible({ timeout: 30_000 });
};
const clearPreference = (browser: Browser) =>
  browser.evaluate(key => { try { localStorage.removeItem(key); } catch { /* No page to clear. */ } }, PREFERENCE).catch(() => {});
// The mock's libraries after its first three, in the server's order.
const later = ['live', 'videos', 'all', 'music', 'books', 'audiobooks', 'podcasts', 'photos'];

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
});
