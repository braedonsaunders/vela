import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, type App, type Screen } from 'e2e';
import { test } from '@e2e-dev/web';
import { webkit, type Locator, type Page } from 'playwright-core';
import { mutePageMedia, runningBrowserPage } from '../muted-browser';

const titleId = 'title-1-1';
const titleName = 'The Last Observatory';
const titleRoute = `/vela/title/${titleId}`;
const watchPath = `/__admin/download-watch/${titleId}`;
const ticket = /\/vela\/v0\/download\/[a-f0-9-]+$/;
type Watch = { positionSeconds: number; played: boolean; lastViewedAt?: string };

async function admin(page: Page, path: string, method = 'GET', body?: Record<string, unknown> | null) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(`Mock admin HTTP ${response.status}`);
    return response.json();
  }, { path, method, body });
}

async function signIn(app: App, screen: Screen) {
  await app.clearState();
  await screen.getByRole('textbox', { name: 'Username', exact: true }).fill('demo');
  await screen.getByRole('textbox', { name: 'Password', exact: true }).fill('vela');
  await screen.getByRole('button', { name: 'Sign in', exact: true }).press('Enter');
  await expect(screen.getByRole('link', { name: 'Home', exact: true })).toBeVisible({ timeout: 30_000 });
}

function stubPersistence(allow: boolean) {
  let persisted = false;
  Object.defineProperties(navigator.storage, {
    persisted: { configurable: true, value: async () => persisted },
    persist: { configurable: true, value: async () => (persisted = allow) },
  });
  return null;
}

async function opfsPage(page: Page): Promise<{ page: Page; close(): Promise<void> }> {
  const engine = page.context().browser()?.browserType().name();
  if (engine !== 'webkit' || await page.evaluate(() => navigator.storage.getDirectory().then(() => true, () => false))) {
    return { page, close: async () => {} };
  }

  // macOS WebKit rejects OPFS in Playwright's ephemeral contexts. A disposable
  // normal profile exercises the real browser filesystem and service worker.
  const scratch = join(homedir(), '.scratch', 'tmp', process.env.BB_THREAD_ID ?? 'vela-downloads-e2e');
  await mkdir(scratch, { recursive: true });
  const profile = await mkdtemp(join(scratch, 'webkit-downloads-'));
  const url = new URL('/vela/', page.url()).href;
  const context = await webkit.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
  }).catch(async error => {
    await rm(profile, { recursive: true, force: true });
    throw error;
  });
  const close = async () => {
    try { await context.close(); } finally { await rm(profile, { recursive: true, force: true }); }
  };
  try {
    await context.addInitScript(mutePageMedia);
    const fresh = context.pages()[0] ?? await context.newPage();
    fresh.setDefaultTimeout(15_000);
    await fresh.goto(url);
    await fresh.getByRole('textbox', { name: 'Username', exact: true }).fill('demo');
    await fresh.getByRole('textbox', { name: 'Password', exact: true }).fill('vela');
    await fresh.getByRole('button', { name: 'Sign in', exact: true }).press('Enter');
    await fresh.getByRole('link', { name: 'Home', exact: true }).waitFor();
    return { page: fresh, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function visible(locator: Locator, timeout = 15_000) {
  await expect.poll(() => locator.isVisible(), { timeout }).toBe(true);
}

async function evidence(page: Page, label: string, release: boolean) {
  const root = process.env.VELA_E2E_DOWNLOADS_EVIDENCE;
  if (!root) return;
  const engine = await page.evaluate(() => /HeadlessChrome/.test(navigator.userAgent) ? 'chromium' : 'webkit');
  await page.screenshot({ path: join(root, `${release ? 'release' : 'mock'}-${engine}-${label}.png`) });
}

test('persists a movie, resumes a partial, plays offline, replays progress and deletes it', async ({ app, browser, screen }) => {
  await signIn(app, screen);
  const origin = new URL(await browser.url()).origin;
  const fixturePage = runningBrowserPage(origin);
  const download = await opfsPage(fixturePage);
  const page = download.page;
  const context = page.context();
  try {
    // WebKit can share OPFS backing storage for this mock origin across
    // disposable profiles. Each case owns this origin's test downloads.
    await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        if (registration.active?.scriptURL.endsWith('/vela/__e2e/offline-shell.js')) await registration.unregister();
      }
      const root = await navigator.storage.getDirectory();
      try {
        await root.removeEntry('vela-downloads', { recursive: true });
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
      }
    });
    const baseline = await admin(page, watchPath) as Watch | null;
    await admin(page, watchPath, 'PUT', { positionSeconds: 0, played: false, favorite: false, watchlisted: false });
    try {
      await page.addInitScript(stubPersistence, true);
      await page.goto(origin + titleRoute);
      const release = await page.evaluate(() =>
        typeof (window as Window & { velaPwa?: { prepareOffline?: () => boolean } }).velaPwa?.prepareOffline === 'function');
      if (release) await expect.poll(() => page.evaluate(() =>
        navigator.serviceWorker.controller?.scriptURL.endsWith('/vela/sw.js') === true)).toBe(true);
      const action = page.getByTestId('detail-download');
      const row = page.getByTestId(`download-${titleId}`);
      await expect.poll(() => action.getAttribute('aria-label'), { timeout: 30_000 }).toBe('Download');
      await admin(page, '/__admin/faults', 'POST', { downloadTruncate: 1, bandwidthBps: 24_000_000 });
      await page.evaluate(stubPersistence, true);
      await action.press('Enter');
      await expect.poll(() => action.getAttribute('aria-label'), { timeout: 30_000 }).toBe('Downloading');
      await action.press('Enter');
      await visible(page.getByTestId('downloads-screen'));
      await visible(row.getByRole('progressbar'));
      await visible(row.getByText(/ · [1-9]\d*%$/));
      await evidence(page, 'progress', release);
      await visible(row.getByText(/^Paused · /), 45_000);
      await admin(page, '/__admin/faults', 'POST', { bandwidthBps: 0 });

      const [resumed] = await Promise.all([
        page.waitForResponse(response => ticket.test(response.url())),
        row.getByRole('button', { name: 'Resume', exact: true }).press('Enter'),
      ]);
      expect(resumed.status()).toBe(206);
      expect(resumed.headers()['content-range']).toMatch(/^bytes [1-9]\d*-\d+\/\d+$/);
      const play = row.getByRole('button', { name: 'Play', exact: true });
      await visible(play, 60_000);
      expect(await page.getByTestId('downloads-storage-notice').innerText()).toBe(
        "Downloads are kept in this browser's storage for this site. Clearing site data or uninstalling the app removes them.",
      );

      if (release) {
        await expect.poll(() => page.evaluate(async () => !!await caches.match('/vela/.offline-complete')),
          { timeout: 45_000 }).toBe(true);
      } else {
        await page.evaluate(async () => {
          await navigator.serviceWorker.register('/vela/__e2e/offline-shell.js', { scope: '/vela/' });
        });
        await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      }

      await context.setOffline(true);
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      await page.goto(origin + '/vela/downloads', { waitUntil: 'domcontentloaded' });
      await visible(page.getByTestId('downloads-screen'), 45_000);
      await visible(play);
      await expect.poll(() => page.getByTestId('vela-launch').isVisible()).toBe(false);
      await evidence(page, 'cold-offline', release);
      await play.press('Enter');
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/vela/watch/${titleId}`);
      if (release) await page.reload({ waitUntil: 'domcontentloaded' });
      await visible(page.getByTestId('watch-stage'), 45_000);
      const scrubber = page.getByTestId('player-scrub');
      await expect.poll(() => scrubber.isEnabled(), { timeout: 45_000 }).toBe(true);
      const toggle = page.getByTestId('player-toggle');
      if (await toggle.getAttribute('aria-label') === 'Play') await toggle.press('Enter');
      const start = Number(await scrubber.getAttribute('aria-valuenow'));
      await expect.poll(async () => Number(await scrubber.getAttribute('aria-valuenow')), { timeout: 20_000 })
        .toBeGreaterThan(start + 5);
      await evidence(page, 'offline-playback', release);
      await page.getByRole('button', { name: 'Close player', exact: true }).press('Enter');
      await visible(page.getByTestId('downloads-screen'));
      await expect.poll(() => page.evaluate(async id => {
        const opfs = await navigator.storage.getDirectory();
        const downloads = await opfs.getDirectoryHandle('vela-downloads');
        const file = await (await downloads.getFileHandle('outbox.json')).getFile();
        const entries = JSON.parse(await file.text()) as { titleId: string; positionSeconds: number }[];
        return entries.find(entry => entry.titleId === id)?.positionSeconds ?? 0;
      }, titleId)).toBeGreaterThan(5);
      await context.setOffline(false);
      await expect.poll(async () => (await admin(page, watchPath) as Watch).positionSeconds).toBeGreaterThan(5);

      let confirmation: string[] | undefined;
      if (page === fixturePage) {
        await browser.onDialog(async dialog => {
          confirmation = [dialog.type, dialog.message];
          await dialog.accept();
        });
      } else {
        page.once('dialog', async dialog => {
          confirmation = [dialog.type(), dialog.message()];
          await dialog.accept();
        });
      }
      await page.getByTestId(`download-delete-${titleId}`).press('Enter');
      expect(confirmation).toEqual(['confirm', `Delete download?\n\n${titleName}`]);
      await expect.poll(() => row.count()).toBe(0);
    } finally {
      await context.setOffline(false);
      const close = page.getByRole('button', { name: 'Close player', exact: true });
      if (await close.isVisible()) await close.press('Enter');
      await admin(page, '/__admin/faults', 'POST', { downloadTruncate: 0, bandwidthBps: 0 });
      await admin(page, watchPath, 'PUT', baseline);
    }
  } finally {
    await download.close();
  }
});

test('denied persistence offers Save file and saves an Ether grant through the browser', async ({ app, browser, screen }) => {
  await signIn(app, screen);
  await app.open(titleRoute);
  await browser.evaluate(stubPersistence, false);
  const action = screen.getByTestId('detail-download');
  await expect(action).toHaveAttribute('aria-label', 'Download', { timeout: 30_000 });
  await action.press('Enter');
  await expect(screen.getByText('This browser may clear stored videos, so Vela saves the file to your downloads instead.')).toBeVisible();
  await expect(action).toHaveAttribute('aria-label', 'Save file');
  await app.screenshot('save-file');
  const saved = await browser.waitForDownload(() => action.press('Enter'), { timeout: 60_000 });
  expect(saved.suggestedFilename).toBe('The Last Observatory (2012).mp4');
  await app.open('/vela/downloads');
  await expect(screen.getByTestId(`download-${titleId}`)).toHaveCount(0);
});
