import { expect, type Screen } from 'e2e';
import type { Browser } from '@e2e-dev/web';

function videoState(browser: Browser) {
  return browser.evaluate(() => {
    const stage = document.querySelector('[data-testid="watch-stage"]');
    for (const element of stage?.querySelectorAll('*') ?? []) {
      const video = element.shadowRoot?.querySelector('video');
      if (video) return {
        hasFrame: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
        paused: video.paused,
        seeking: video.seeking,
        position: video.currentTime,
        height: video.videoHeight,
      };
    }
    return { hasFrame: false, paused: true, seeking: false, position: 0, height: 0 };
  });
}

export async function waitForVideoReady(browser: Browser, screen: Screen) {
  await expect.poll(async () => (await videoState(browser)).hasFrame, { timeout: 45_000 }).toBe(true);
  await expect(screen.getByTestId('player-scrub')).toBeEnabled({ timeout: 30_000 });
  await expect(screen.getByRole('progressbar', 'Preparing your screening')).toBeHidden({ timeout: 30_000 });
}

export async function waitForVideoPlayback(browser: Browser, screen: Screen, height?: number) {
  await waitForVideoReady(browser, screen);
  const start = await videoState(browser);
  // WebKit can leave a loaded video paused when playback starts after navigation.
  if (start.paused) await screen.getByRole('button', 'Play').press('Enter');
  await expect(screen.getByTestId('player-toggle')).toHaveAttribute('aria-label', 'Pause', { timeout: 30_000 });
  // The browser can resolve play() and show Pause before a startup seek has finished.
  await expect.poll(async () => {
    const video = await videoState(browser);
    return !video.paused && !video.seeking && video.position > start.position;
  }).toBe(true);
  if (height !== undefined) expect((await videoState(browser)).height).toBe(height);
}
