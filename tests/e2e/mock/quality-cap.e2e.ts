import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { waitForVideoPlayback } from './player-ready';

describe('Quality-cap deterministic release gate', { session: 'mock-quality-cap' }, () => {
  test('a widescreen 720p film starts within the Wi-Fi cap', async ({ app, browser, screen }) => {
    // The film suite seeks this same title and the mock remembers its stop position.
    await app.open('/vela/watch/title-1-1?positionSeconds=0');
    await expect(screen.getByTestId('player-close')).toBeVisible({ timeout: 30_000 });
    await waitForVideoPlayback(browser, screen);
    await screen.getByTestId('player-quality-button').tap();
    const wifi = screen.getByRole('radiogroup', 'On Wi-Fi');
    await expect(wifi).toBeVisible();
    await wifi.getByRole('radio', '720p').press('Enter');
    await expect.poll(() => browser.evaluate(() => JSON.parse(localStorage.getItem('vela.pref.player-settings') ?? '{}')))
      .toMatchObject({ streaming: { wifi: '720p' } });
    await screen.getByTestId('player-quality-button').tap();
    await screen.getByTestId('player-close').tap();

    expect(await browser.evaluate(async () => (await fetch('/__e2e/last-playback', { method: 'DELETE' })).status)).toBe(204);
    await app.open('/vela/watch/title-4-2?positionSeconds=0');
    await expect(screen.getByTestId('player-close')).toBeVisible({ timeout: 30_000 });
    const body = await browser.evaluate(async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const response = await fetch('/__e2e/last-playback');
        if (response.ok) return response.json() as Promise<{
          titleId?: string;
          positionSeconds?: number;
          client?: { maxWidth?: number; maxHeight?: number; maxBitrate?: number };
        }>;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('playback request was not captured within 15 seconds');
    });
    expect(body).toMatchObject({
      titleId: 'title-4-2',
      positionSeconds: 0,
      client: { maxWidth: 1280, maxHeight: 720, maxBitrate: 4_000_000 },
    });

    await waitForVideoPlayback(browser, screen, 720);
    await expect(screen.getByTestId('player-quality')).toHaveText(/^720p(?:$| ·)/);
    await screen.getByTestId('player-quality-button').tap();
    await wifi.getByRole('radio', 'Original').press('Enter');
    await expect.poll(() => browser.evaluate(() => JSON.parse(localStorage.getItem('vela.pref.player-settings') ?? '{}')))
      .toMatchObject({ streaming: { wifi: 'original' } });
    await screen.getByTestId('player-close').tap();
  });
});
