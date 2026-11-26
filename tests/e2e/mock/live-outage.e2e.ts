import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { videoState, waitForVideoPlayback } from './player-ready';
import { signInMockViewer } from './sign-in';

// A brief network drop (the Wi-Fi link or a proxy between the player and the server goes away for 12 s,
// taking the session's events stream and its media reads with it) recovers by itself on a live channel:
// the picture moves again within a few seconds of the network returning, and Try again is never offered.
// The proxy's /__e2e/outage cuts the network; the mock's freeze-media keeps the session's own media from coming back.
test('a 12 s network drop on a live channel recovers by itself', async ({ app, browser, screen }) => {
  await signInMockViewer(app, screen);
  const observations = /\/vela\/v0\/sessions\/[^/]+\/observations$/;
  const playing: { sessionId: string; at: number }[] = [];
  await browser.route(observations, route => {
    const body = JSON.parse(route.request.postData ?? '{}') as { state?: string };
    if (body.state === 'playing') playing.push({ sessionId: new URL(route.request.url).pathname.split('/').at(-2)!, at: Date.now() });
    return route.continue();
  });
  const stage = screen.getByTestId('player-stage-input');
  const failure = screen.getByTestId('player-retry');
  try {
    await app.open('/vela/watch/channel-1?kind=channel');
    await waitForVideoPlayback(browser, screen);
    // At the live edge, as the 0.2.74 walk was (WebKit can open the mock channel at the oldest point of its window).
    const goLive = screen.getByTestId('player-go-live');
    await expect.poll(async () => (await videoState(browser)).position > 1100 || await goLive.isVisible()).toBe(true);
    if ((await videoState(browser)).position <= 1100) await goLive.tap();
    await expect.poll(async () => (await videoState(browser)).position).toBeGreaterThan(1100);
    await expect.poll(() => playing.length).toBeGreaterThan(0);

    // The session's own media does not come back from the drop: its playlist refreshes keep answering but
    // its segments never do, as Android's Media3 reload of the 0.2.74 walk sat loading behind a frozen picture.
    const dropped = playing.at(-1)!.sessionId;
    expect(await browser.evaluate(async id => (await (await fetch(`/__admin/sessions/${id}/freeze-media`, { method: 'POST' })).json()).frozen, dropped)).toBe(true);
    const outageSeconds = 12;
    const cut = await browser.evaluate(async seconds => (await fetch(`/__e2e/outage?seconds=${seconds}`, { method: 'POST' })).status, outageSeconds);
    expect(cut).toBe(204);
    const back = Date.now() + outageSeconds * 1000;

    // Within a few seconds of the network returning, the picture moves again and the server hears it play.
    const resumed = async () => {
      const before = (await videoState(browser)).position;
      await new Promise(resolve => setTimeout(resolve, 1000));
      const after = await videoState(browser);
      return Date.now() > back && !after.paused && after.hasFrame && after.position > before
        && playing.some(report => report.at > back && report.sessionId !== dropped);
    };
    await expect.poll(resumed, { timeout: (outageSeconds + 20) * 1000, intervals: [500] }).toBe(true);
    // 0.2.74 took 13 s here on the web (and over a minute, then Try again, on Android); with the fix it takes about 5.
    expect(Date.now() - back).toBeLessThan(8_000);
    expect(await failure.isVisible()).toBe(false);
    // And it goes on playing: nothing gives up after it came back.
    await new Promise(resolve => setTimeout(resolve, 20_000));
    expect(await failure.isVisible()).toBe(false);
    await expect.poll(resumed).toBe(true);
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
