import { expect, type App, type Screen } from 'e2e';
import { describe, test, type Browser } from '@e2e-dev/web';

const scenes = [
  'Synthwire Valley', 'Basalt Ridge', 'Mercury Tide', 'Basalt Organ',
  'Geodesic World', 'Ferrofluid', 'Solaris Relic', 'Nebula',
  'Silk', 'Hyperspace', 'Aurora', 'Watercolour',
  'Ink in Water', 'Incense', 'Falling Leaves', 'Shallows',
];

async function openGaplessAlbum(app: App, screen: Screen) {
  await app.open('/vela/library/music?m=title%3Aalbum-gapless-sweep-aac');
  await expect(screen.getByRole('heading', 'Gapless Sweep (AAC)')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByTestId('music-play')).toBeVisible();
}

async function openVisualizer(browser: Browser, screen: Screen) {
  // The canvas is attached after the real renderer draws its first frame.
  await expect.poll(() => browser.evaluate(() => !!document.querySelector('[data-testid="visualizer-background"] canvas')),
    { timeout: 30_000 }).toBe(true);
  await screen.getByTestId('now-playing-visualizer').press('Enter');
  await expect(screen.getByTestId('visualizer-page')).toBeVisible();
  await expect.poll(() => browser.evaluate(() => !!document.querySelector('[data-testid="visualizer-fullscreen"] canvas')),
    { timeout: 30_000 }).toBe(true);
}

describe('Music deterministic release gate', { session: 'mock-music', serial: true }, () => {
  test('503 preparation retry, gapless change, scenes, Off, and retired-scene fallback', async ({ app, browser, screen }) => {
    // Keep the real WebGL render targets small on the runner's software adapter.
    await browser.setViewport({ width: 960, height: 600 });
    await openGaplessAlbum(app, screen);

    expect(await browser.evaluate(async () => (await fetch('/__admin/faults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioStartPending: 1 }),
    })).status)).toBe(200);

    let starts = 0;
    const playback = '**/vela/v0/playback';
    await browser.route(playback, route => {
      if (route.request.method === 'POST') starts += 1;
      return route.continue();
    });
    await screen.getByTestId('music-play').tap();
    await expect(screen.getByTestId('now-playing-bar')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('bar-expand').tap();
    await expect(screen.getByTestId('now-playing')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('now-playing-title')).toHaveText('Sweep, part 1');
    await expect(screen.getByTestId('now-playing-toggle')).toHaveAttribute('aria-label', 'Pause');
    await expect.poll(() => starts, { timeout: 10_000 }).toBe(2);

    await expect(screen.getByTestId('now-playing-title')).toHaveText('Sweep, part 2', { timeout: 20_000 });
    await browser.unroute(playback);
    await screen.getByTestId('now-playing-toggle').tap();
    await expect(screen.getByTestId('now-playing-toggle')).toHaveAttribute('aria-label', 'Play');

    await openVisualizer(browser, screen);
    await screen.getByTestId('visualizer-picker-toggle').tap();
    await expect(screen.getByRole('radiogroup', 'Scenes')).toBeVisible();
    await expect(screen.getByRole('radio', 'Off')).toHaveCount(1);
    for (const scene of scenes) await expect(screen.getByRole('radio', scene)).toHaveCount(1);
    await screen.getByRole('radio', 'Synthwire Valley').tap();
    await expect(screen.getByTestId('visualizer-caption')).toHaveText('Synthwire Valley');

    await screen.getByTestId('visualizer-close').tap();
    await screen.getByTestId('now-playing-sound').tap();
    const visualizerSwitch = screen.getByTestId('now-playing-visualizer-setting-toggle');
    await expect(visualizerSwitch).toBeChecked();
    await visualizerSwitch.tap();
    await expect(visualizerSwitch).not.toBeChecked();
    await expect(screen.getByTestId('now-playing-visualizer')).toBeHidden();
    await visualizerSwitch.tap();
    await expect(visualizerSwitch).toBeChecked();
    await expect(screen.getByTestId('now-playing-visualizer')).toBeVisible();

    expect(await browser.evaluate(() => {
      const key = Object.keys(localStorage).find(candidate => candidate.includes('visualizer.scene.'));
      if (!key) return false;
      localStorage.setItem(key, 'forest');
      return true;
    })).toBe(true);
    await browser.evaluate(() => { location.reload(); return null; });
    await expect(screen.getByTestId('nav-Home')).toBeVisible({ timeout: 30_000 });

    // Reload retains the library URL. Opening the same URL again races WebKit's
    // hydration navigation, so wait for the retained page instead of navigating.
    await expect(screen.getByRole('heading', 'Gapless Sweep (AAC)')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('music-play')).toBeVisible();
    await screen.getByTestId('music-play').tap();
    await expect(screen.getByTestId('now-playing-bar')).toBeVisible({ timeout: 30_000 });
    await screen.getByTestId('bar-expand').tap();
    await openVisualizer(browser, screen);
    await expect(screen.getByTestId('visualizer-caption')).toHaveText('Synthwire Valley');
    await screen.getByTestId('visualizer-close').tap();
    await screen.getByTestId('now-playing-close').tap();
  });
});
