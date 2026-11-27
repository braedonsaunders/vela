import { expect } from 'e2e';
import { describe, test, type Browser } from '@e2e-dev/web';
import { waitForVideoPlayback } from './player-ready';

// A YouTube trailer offered for the client embed (features.trailerEmbed clientWhenPossible). The mock's
// stand-in plays YouTube's part at its own origin (mock-server/trailer-embed.ts), and nothing here may
// reach YouTube itself.
const TITLE = '/vela/title/title-1-2';
const YOUTUBE = /youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|doubleclick\.net/;

async function trailerEmbed(browser: Browser, body: Record<string, string | number | boolean>) {
  return browser.evaluate(async body => (await fetch('/__admin/trailer-embed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json() as Promise<{ mode: string; player: string; errorCode: number }>, body);
}

async function lastPlayback(browser: Browser) {
  return browser.evaluate(async () => {
    const response = await fetch('/__e2e/last-playback', { cache: 'no-store' });
    return response.status === 200 ? (await response.json()) as { extraId?: string } : null;
  });
}

describe('Trailer embed deterministic release gate', { session: 'mock-trailer-embed', serial: true }, () => {
  test('Watch trailer plays the embed, never YouTube itself, and Close returns to the title', async ({ app, browser, screen }) => {
    const youtube: string[] = [];
    const stub: string[] = [];
    await browser.route(YOUTUBE, route => { youtube.push(route.request.url); return route.abort(); });
    await browser.route(/\/embed\/VelaMock001\?/, route => { stub.push(route.request.url); return route.continue(); });
    try {
      await app.open(TITLE);
      await expect(screen.getByRole('heading', 'A Map of Quiet Stars')).toBeVisible({ timeout: 30_000 });
      // The stand-in reads its fault when the frame loads, so it is set before Watch trailer.
      expect(await trailerEmbed(browser, { reset: true })).toEqual({ mode: 'clientWhenPossible', player: 'play', errorCode: 150 });
      await browser.evaluate(async () => (await fetch('/__e2e/last-playback', { method: 'DELETE' })).status);
      await screen.getByTestId('detail-trailer').tap();

      const surface = screen.getByTestId('trailer-embed');
      await expect(surface).toBeVisible({ timeout: 30_000 });
      await expect(surface).toHaveAttribute('data-embed-state', 'ready', { timeout: 15_000 });
      await expect(screen.getByTestId('trailer-embed-title')).toHaveText('A Map of Quiet Stars — Trailer');
      const src = await screen.getByTestId('trailer-embed-player-frame').getAttribute('src');
      const url = new URL(src!);
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.pathname).toBe('/embed/VelaMock001');
      expect(Object.fromEntries(url.searchParams)).toEqual({ autoplay: '1', rel: '0', playsinline: '1', enablejsapi: '1', origin: await browser.evaluate(() => location.origin) });
      expect(stub).toHaveLength(1);
      // The frame is 16:9 and sits inside the screen.
      const box = await screen.getByTestId('trailer-embed-player').boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs(box!.width / box!.height - 16 / 9)).toBeLessThan(0.02);
      // The client played it: the server was never asked to.
      expect(await lastPlayback(browser)).toBeNull();

      await screen.getByTestId('trailer-embed-close').tap();
      await expect(surface).toBeHidden();
      await expect(screen.getByRole('heading', 'A Map of Quiet Stars')).toBeVisible();
      expect(youtube).toEqual([]);
    } finally {
      await browser.unroute(/\/embed\/VelaMock001\?/);
      await browser.unroute(YOUTUBE);
    }
  });

  test('A refused embed falls back to the server-played trailer', async ({ app, browser, screen }) => {
    const youtube: string[] = [];
    await browser.route(YOUTUBE, route => { youtube.push(route.request.url); return route.abort(); });
    try {
      await app.open(TITLE);
      await expect(screen.getByRole('heading', 'A Map of Quiet Stars')).toBeVisible({ timeout: 30_000 });
      expect(await trailerEmbed(browser, { reset: true, player: 'error', errorCode: 150 })).toMatchObject({ player: 'error', errorCode: 150 });
      await browser.evaluate(async () => (await fetch('/__e2e/last-playback', { method: 'DELETE' })).status);
      await screen.getByTestId('detail-trailer').tap();

      // YouTube's onError 150 (the owner refused embedding): the server's extra plays instead.
      await waitForVideoPlayback(browser, screen);
      await expect(screen.getByTestId('trailer-embed')).toBeHidden();
      expect((await lastPlayback(browser))?.extraId).toBe('extra-quiet-stars-trailer');
      expect(youtube).toEqual([]);

      await browser.mouse.move(120, 120);
      await screen.getByTestId('player-close').tap();
      await expect(screen.getByTestId('player-stage-input')).toBeHidden();
      await expect(screen.getByRole('heading', 'A Map of Quiet Stars')).toBeVisible();
    } finally {
      await trailerEmbed(browser, { reset: true });
      await browser.unroute(YOUTUBE);
    }
  });

  test('A refused embed of a trailer the server cannot play says so, and starts nothing on the server', async ({ app, browser, screen }) => {
    const youtube: string[] = [];
    await browser.route(YOUTUBE, route => { youtube.push(route.request.url); return route.abort(); });
    try {
      await app.open('/vela/title/title-1-3');
      await expect(screen.getByRole('heading', 'Signal from Europa')).toBeVisible({ timeout: 30_000 });
      expect(await trailerEmbed(browser, { reset: true, player: 'error', errorCode: 150 })).toMatchObject({ player: 'error' });
      await browser.evaluate(async () => (await fetch('/__e2e/last-playback', { method: 'DELETE' })).status);
      await screen.getByTestId('detail-trailer').tap();

      const surface = screen.getByTestId('trailer-embed');
      await expect(surface).toHaveAttribute('data-embed-state', 'failed', { timeout: 15_000 });
      await expect(screen.getByTestId('trailer-embed-unavailable')).toHaveText('This trailer can’t play right now.');
      await expect(screen.getByTestId('trailer-embed-player')).toBeHidden();
      await expect(screen.getByTestId('player-stage-input')).toBeHidden();
      expect(await lastPlayback(browser)).toBeNull();
      expect(youtube).toEqual([]);

      await screen.getByTestId('trailer-embed-close').tap();
      await expect(surface).toBeHidden();
      await expect(screen.getByRole('heading', 'Signal from Europa')).toBeVisible();
    } finally {
      await trailerEmbed(browser, { reset: true });
      await browser.unroute(YOUTUBE);
    }
  });
});
