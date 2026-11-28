import { expect, type App, type Screen } from 'e2e';
import { describe, test, type Browser } from '@e2e-dev/web';
import type { Request, Response } from 'playwright-core';
import type { PlaybackPlan, PlaybackRequest, PlayerObservation } from '../../../packages/protocol/types';
import { runningBrowserPage } from '../muted-browser';

const firstTrack = 'track-gapless-sweep-aac-1-01';
const secondTrack = 'track-gapless-sweep-aac-1-02';

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

    const page = runningBrowserPage(new URL(await browser.url()).origin);
    const firstStartStatuses: number[] = [];
    const sessions = new Map<string, string>();
    const playing = new Set<string>();
    const ended = new Set<string>();
    const observePlan = async (response: Response) => {
      const request = response.request();
      if (request.method() !== 'POST' || new URL(response.url()).pathname !== '/vela/v0/playback') return;
      const { titleId, queued } = request.postDataJSON() as PlaybackRequest;
      if (titleId === firstTrack && !queued) firstStartStatuses.push(response.status());
      if ((titleId === firstTrack || titleId === secondTrack) && response.ok()) {
        const plan = await response.json() as PlaybackPlan;
        sessions.set(titleId, plan.sessionId);
      }
    };
    const observePlayback = (request: Request) => {
      if (request.method() !== 'POST') return;
      const match = /^\/vela\/v0\/sessions\/([^/]+)\/observations$/.exec(new URL(request.url()).pathname);
      if (!match) return;
      const { state } = request.postDataJSON() as PlayerObservation;
      if (state === 'playing') playing.add(match[1]!);
      if (state === 'ended') ended.add(match[1]!);
    };
    page.on('response', observePlan);
    page.on('request', observePlayback);
    try {
      await screen.getByTestId('music-play').tap();
      await expect(screen.getByTestId('now-playing-bar')).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByTestId('bar-title')).toHaveText('Sweep, part 1');
      await expect(screen.getByTestId('bar-toggle')).toHaveAttribute('aria-label', 'Pause');
      await expect.poll(() => firstStartStatuses, { timeout: 10_000 }).toEqual([503, 200]);

      // Preparing the queued track is not an advance. Wait for the engine to
      // report the first track ended and the second session actually playing.
      await expect.poll(() => ({
        firstEnded: ended.has(sessions.get(firstTrack) ?? ''),
        secondPlaying: playing.has(sessions.get(secondTrack) ?? ''),
      }), { timeout: 45_000 }).toEqual({ firstEnded: true, secondPlaying: true });
      await expect(screen.getByTestId('bar-title')).toHaveText('Sweep, part 2');
    } finally {
      page.off('response', observePlan);
      page.off('request', observePlayback);
    }
    // Opening Now Playing mounts the background WebGL renderer on this runner.
    // Keep that setup out of the timed handoff, then hold track two for scene checks.
    await screen.getByTestId('bar-toggle').tap();
    await expect(screen.getByTestId('bar-toggle')).toHaveAttribute('aria-label', 'Play');
    await screen.getByTestId('bar-expand').tap();
    await expect(screen.getByTestId('now-playing')).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByTestId('now-playing-title')).toHaveText('Sweep, part 2');
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
