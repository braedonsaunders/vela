import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { videoState, waitForVideoPlayback } from './player-ready';
import { signInMockViewer } from './sign-in';

test('sustained playback replenishes an exhausted restart budget', async ({ app, browser, screen }) => {
  await signInMockViewer(app, screen);
  const observations = /\/vela\/v0\/sessions\/[^/]+\/observations$/;
  const playingSessions = new Set<string>();
  await browser.route(observations, route => {
    const body = JSON.parse(route.request.postData ?? '{}') as { state?: string };
    if (body.state === 'playing') playingSessions.add(new URL(route.request.url).pathname.split('/').at(-2)!);
    return route.continue();
  });

  const stage = screen.getByTestId('player-stage-input');
  const countPlaying = () => playingSessions.size;
  const expire = async () => {
    const sessionId = [...playingSessions].at(-1)!;
    expect(await browser.evaluate(async id => {
      const response = await fetch(`/__admin/sessions/${id}/expire`, { method: 'POST' });
      return (await response.json()).expired;
    }, sessionId)).toBe(true);
  };

  try {
    // The standalone trailer uses the full-length direct fixture and carries no watch state.
    await app.open('/vela/watch/extra-observatory-preview?kind=extra');
    await waitForVideoPlayback(browser, screen);
    await expect.poll(countPlaying).toBe(1);
    await expire();
    await expect.poll(countPlaying, { timeout: 25_000 }).toBe(2);
    await expire();
    await expect.poll(countPlaying, { timeout: 25_000 }).toBe(3);

    await waitForVideoPlayback(browser, screen);
    const start = (await videoState(browser)).position;
    await expect.poll(async () => {
      const video = await videoState(browser);
      return !video.paused && video.position - start >= 62;
    }, { timeout: 90_000 }).toBe(true);
    expect(countPlaying()).toBe(3);

    await expire();
    await expect.poll(countPlaying, { timeout: 25_000 }).toBe(4);
    await waitForVideoPlayback(browser, screen);
  } finally {
    try {
      if (await stage.isVisible()) {
        await browser.mouse.move(120, 120);
        await screen.getByTestId('player-close').tap();
        await expect(stage).toBeHidden();
      }
    } finally {
      await browser.unroute(observations);
    }
  }
});
