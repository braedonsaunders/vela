import { expect } from 'e2e';
import { describe, test } from '@e2e-dev/web';
import { videoState, waitForVideoPlayback, waitForVideoReady } from './player-ready';
import { signInMockViewer } from './sign-in';

describe('Live TV catch-up release gate', () => {
  test('the guide replays an archive and Start over can pause, rewind and return live', async ({ app, browser, screen }) => {
    // Full navigations rotate the grant. Give each repetition its own grant.
    await signInMockViewer(app, screen);
    const guide = await browser.evaluate(async () => {
      const flags = await fetch('/__admin/faults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catchUpFixture: true }),
      }).then(reply => reply.json()) as { catchUpFixture: boolean };
      const programmes = await fetch('/__admin/catch-up-fixture').then(reply => reply.json()) as { id: string; start: string; end: string }[];
      return { ...flags, programmes };
    });
    const commands: string[] = [];
    const starts: string[] = [];
    const seekPositions: number[] = [];
    const recoveryStarts: { channelId?: string; programmeId?: string; startAt?: string; durationSeconds?: number; from?: string }[] = [];
    const seeksBySession = new Map<string, number[]>();
    let observedSession = '';
    let observedPosition = 0;
    const playbackRoute = /\/vela\/v0\/playback$/;
    await browser.route(playbackRoute, route => {
      const body = JSON.parse(route.request.postData ?? '{}') as typeof recoveryStarts[number];
      recoveryStarts.push(body);
      if (body.from) starts.push(body.from);
      return route.continue();
    });
    let pausedReports = 0;
    const sessionRoute = /\/vela\/v0\/sessions\/[^/]+\/(commands|observations)$/;
    await browser.route(sessionRoute, route => {
      const body = JSON.parse(route.request.postData ?? '{}') as { kind?: string; state?: string; positionSeconds?: number };
      if (body.kind) commands.push(body.kind);
      const sessionId = new URL(route.request.url).pathname.split('/').at(-2)!;
      if (body.kind === 'seek' && body.positionSeconds !== undefined) {
        seekPositions.push(body.positionSeconds);
        seeksBySession.set(sessionId, [...(seeksBySession.get(sessionId) ?? []), body.positionSeconds]);
      }
      if (body.state === 'playing' || body.state === 'paused') {
        observedSession = sessionId;
        observedPosition = body.positionSeconds ?? 0;
      }
      if (body.state === 'paused') pausedReports++;
      return route.continue();
    });
    const follows = new Map<string, number>();
    const eventsRoute = /\/vela\/v0\/sessions\/[^/]+\/events(?:\?|$)/;
    await browser.route(eventsRoute, route => {
      const id = new URL(route.request.url).pathname.split('/').at(-2)!;
      follows.set(id, (follows.get(id) ?? 0) + 1);
      return route.continue();
    });
    const openProgramme = async (programme: { id: string; start: string }) => {
      const at = new Date(Date.parse(programme.start) + 5 * 60_000).toISOString();
      await app.open('/vela/live?' + new URLSearchParams({ ch: 'channel-1', prog: programme.id, at }));
    };
    const stage = screen.getByTestId('player-stage-input');
    const close = screen.getByTestId('player-close');
    const toggle = screen.getByTestId('player-toggle');
    const timeline = screen.getByTestId('player-live-timeline');
    const goLive = screen.getByTestId('player-go-live');
    const openLiveAtEdge = async () => {
      observedSession = '';
      observedPosition = 0;
      await app.open('/vela/watch/channel-1?kind=channel');
      await waitForVideoPlayback(browser, screen);
      await expect.poll(async () => (await videoState(browser)).position > 1100 || await goLive.isVisible()).toBe(true);
      if ((await videoState(browser)).position <= 1100) await goLive.tap();
      await expect.poll(async () => (await videoState(browser)).position).toBeGreaterThan(1100);
    };
    const rewindForRecovery = async () => {
      const previousSeeks = seekPositions.length;
      await screen.getByTestId('player-scrub').press('PageDown');
      await expect.poll(() => seekPositions.length).toBe(previousSeeks + 1);
      const position = seekPositions.at(-1)!;
      await expect.poll(() => Math.abs(observedPosition - position)).toBeLessThan(2);
      return position;
    };
    const pause = async () => {
      await waitForVideoReady(browser, screen);
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await stage.press('k');
      await expect(toggle).toHaveAttribute('aria-label', 'Play');
      await expect.poll(async () => (await videoState(browser)).paused).toBe(true);
    };
    const setRewindSegments = (rewindSegments: number) => browser.evaluate(async count => {
      const response = await fetch('/__admin/live-faults', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rewindSegments: count }),
      });
      return (await response.json()).rewindSegments;
    }, rewindSegments);
    const recoverWatch = async (seek: boolean, notice?: string, captureFrame = false) => {
      await expect.poll(() => observedSession).not.toBe('');
      const previous = observedSession;
      const startsBefore = recoveryStarts.length;
      const expired = await browser.evaluate(async ({ id, captureFrame }) => {
        if (captureFrame) {
          const stage = document.querySelector<HTMLElement>('[data-testid="watch-stage"]')!;
          const findVideo = () => Array.from(stage.querySelectorAll('*'))
            .map(element => element.shadowRoot?.querySelector('video')).find(video => !!video);
          const previousVideo = findVideo();
          const observer = new MutationObserver(() => {
            const video = findVideo();
            if (!video || video === previousVideo) return;
            observer.disconnect();
            // currentTime can echo a requested seek before the decoder presents that position.
            video.requestVideoFrameCallback((_now, frame) => {
              stage.dataset.recoveredFrame = String(frame.mediaTime);
            });
          });
          observer.observe(stage, { childList: true, subtree: true });
        }
        const response = await fetch(`/__admin/sessions/${id}/expire`, { method: 'POST' });
        return (await response.json()).expired;
      }, { id: previous, captureFrame });
      expect(expired).toBe(true);
      if (notice) await expect(screen.getByText(notice, { exact: true })).toBeVisible();
      try {
        await expect.poll(() => observedSession, { timeout: 25_000 }).not.toBe(previous);
        await waitForVideoReady(browser, screen);
      } catch (error) {
        console.info('Recovery watch state', { previous, observedSession, starts: recoveryStarts.length - startsBefore, video: await videoState(browser) });
        await app.screenshot('live-recovery-diagnostic');
        throw error;
      }
      const positions = [...new Set(seeksBySession.get(observedSession))];
      expect(positions).toHaveLength(seek ? 1 : 0);
      const [position] = positions;
      if (seek) {
        expect(position).toBeDefined();
        await expect.poll(async () => {
          const video = await videoState(browser);
          return video.hasFrame && !video.seeking && Math.abs(video.position - position!) < 5;
        }).toBe(true);
      } else expect(position).toBeUndefined();
      expect(recoveryStarts.slice(startsBefore)).toHaveLength(1);
      return { position, start: recoveryStarts.at(-1)! };
    };
    const closeWatch = async () => {
      if (!await stage.isVisible()) return;
      await browser.mouse.move(120, 120);
      await close.tap();
      await expect(stage).toBeHidden();
    };
    try {
      expect(guide.catchUpFixture).toBe(true);
      expect(guide.programmes).toHaveLength(2);
      await openProgramme(guide.programmes[0]!);
      await expect(screen.getByTestId('guide-replay')).toBeVisible({ timeout: 30_000 });
      await app.screenshot('guide-catch-up');
      await screen.getByTestId('guide-replay').tap();
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await expect(screen.getByTestId('player-scrub')).toBeVisible();
      await expect(timeline).toBeHidden();
      await pause();
      await screen.getByTestId('player-scrub').press('PageUp');
      await expect.poll(async () => (await videoState(browser)).position).toBeGreaterThan(55);
      for (let step = 0; step < 3; step++) {
        const before = (await videoState(browser)).position;
        await stage.press('ArrowRight');
        await expect.poll(async () => Math.abs((await videoState(browser)).position - before - 10)).toBeLessThan(1);
      }
      const archivePosition = (await videoState(browser)).position;
      expect(Math.abs(archivePosition - 90)).toBeLessThan(5);
      await expect.poll(() => Math.abs(observedPosition - archivePosition)).toBeLessThan(1);
      const archiveSession = observedSession;
      await expect.poll(() => follows.get(archiveSession) ?? 0).toBeGreaterThan(0);
      const archiveFollows = follows.get(archiveSession)!;
      const archiveStarts = recoveryStarts.length;
      await expect.poll(() => browser.evaluate(async id => {
        const response = await fetch(`/__admin/sessions/${id}/drop-events`, { method: 'POST' });
        return (await response.json()).dropped;
      }, archiveSession)).toBe(1);
      await expect.poll(() => follows.get(archiveSession)).toBe(archiveFollows + 1);
      const reportsAfterRefollow = pausedReports;
      await expect.poll(() => pausedReports).toBeGreaterThan(reportsAfterRefollow);
      expect(observedSession).toBe(archiveSession);
      expect(Math.abs(observedPosition - archivePosition)).toBeLessThan(1);
      const held = await videoState(browser);
      expect(held.paused).toBe(true);
      expect(Math.abs(held.position - archivePosition)).toBeLessThan(1);
      expect(recoveryStarts).toHaveLength(archiveStarts);

      await stage.press('k');
      await waitForVideoPlayback(browser, screen);
      await expect.poll(async () => (await videoState(browser)).position).toBeGreaterThanOrEqual(98);
      const playingArchivePosition = (await videoState(browser)).position;
      const archiveSeek = await recoverWatch(true, undefined, true);
      const firstFrame = () => browser.evaluate(() => Number(document.querySelector<HTMLElement>('[data-testid="watch-stage"]')?.dataset.recoveredFrame));
      await expect.poll(firstFrame).toBeGreaterThan(0);
      // The archive kept playing while the session was lost and reopened, so the recovered frame may
      // be a little ahead of the position read at the failure, never behind it.
      expect(await firstFrame() - playingArchivePosition).toBeGreaterThan(-1);
      expect(await firstFrame() - playingArchivePosition).toBeLessThan(3);
      expect(archiveSeek.position! - playingArchivePosition).toBeGreaterThan(-1);
      expect(archiveSeek.position! - playingArchivePosition).toBeLessThan(3);
      expect(archiveSeek.start.channelId).toBe('channel-1');
      expect(archiveSeek.start.startAt).toBe(guide.programmes[0]!.start);
      expect(archiveSeek.start.durationSeconds).toBe((Date.parse(guide.programmes[0]!.end) - Date.parse(guide.programmes[0]!.start)) / 1000);
      expect(archiveSeek.start.programmeId).toBeUndefined();
      await closeWatch();
      observedSession = '';

      await openProgramme(guide.programmes[1]!);
      await expect(screen.getByTestId('guide-start-over')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => browser.evaluate(() => [2, 3, 5].every(channel =>
        Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="guide-programme-channel-${channel}|"]`))
          .some(cell => {
            const box = cell.getBoundingClientRect();
            return box.width > 12 && box.right > 310 && box.left < window.innerWidth && box.top < window.innerHeight;
          })))).toBe(true);
      await app.screenshot('guide-start-over');
      await screen.getByTestId('guide-start-over').tap();
      await expect(timeline).toBeVisible({ timeout: 35_000 });
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await pause();
      await expect.poll(() => pausedReports).toBeGreaterThanOrEqual(2);
      const startOverSeeks = seekPositions.length;
      await screen.getByTestId('player-scrub').press('PageUp');
      await expect.poll(() => seekPositions.length).toBe(startOverSeeks + 1);
      const startOverPosition = seekPositions.at(-1)!;
      await expect.poll(async () => Math.abs((await videoState(browser)).position - startOverPosition)).toBeLessThan(1);
      await expect.poll(() => Math.abs(observedPosition - startOverPosition)).toBeLessThan(1);
      const recoveredStartOver = await recoverWatch(true);
      expect(Math.abs(recoveredStartOver.position! - startOverPosition)).toBeLessThan(3);
      expect(recoveredStartOver.start.from).toBe('start');
      expect(recoveredStartOver.start.programmeId).toBe(guide.programmes[1]!.id);

      await recoverWatch(true);
      await expect(goLive).toHaveAttribute('aria-label', 'Go live');
      await goLive.tap();
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await expect(screen.getByTestId('player-live-mark')).toBeVisible();
      await waitForVideoPlayback(browser, screen);
      // Wait for the live player report before expiring the observed session.
      await expect.poll(() => observedPosition).toBeGreaterThan(1100);
      const recoveredLive = await recoverWatch(false);
      expect(recoveredLive.start.channelId).toBe('channel-1');
      expect(recoveredLive.start.programmeId).toBeUndefined();
      await expect(screen.getByTestId('player-live-mark')).toBeVisible();
      await expect.poll(async () => (await videoState(browser)).position).toBeGreaterThan(1100);
      await browser.mouse.move(720, 440);
      const fromPlayer = screen.getByTestId('player-start-over');
      await expect(fromPlayer).toBeVisible();
      const previousStarts = starts.length;
      await fromPlayer.tap();
      await expect.poll(() => starts.slice(previousStarts)).toEqual(['start']);
      await waitForVideoReady(browser, screen);
      await expect(timeline).toHaveText(/Start over/);
      await expect(goLive).toBeVisible();
      await closeWatch();

      // A live channel has its own watch and restart budget.
      await openLiveAtEdge();
      await pause();
      const positionBeforeRewind = (await videoState(browser)).position;
      const sliderBeforeRewind = Number(await screen.getByTestId('player-scrub').getAttribute('aria-valuenow'));
      const seeks = commands.filter(kind => kind === 'seek').length;
      await screen.getByTestId('player-scrub').press('PageDown');
      await expect.poll(() => commands.filter(kind => kind === 'seek').length).toBe(seeks + 1);
      const requested = seekPositions.at(-1) ?? NaN;
      expect(Math.abs(sliderBeforeRewind - requested - 60)).toBeLessThan(2);
      await expect(screen.getByTestId('player-live-edge-time')).toHaveText(/^\d{1,2}:[0-5]\d [AP]M · LIVE$/, { timeout: 35_000 });
      await expect(toggle).toHaveAttribute('aria-label', 'Play');
      await expect(screen.getByTestId('player-live-status')).toHaveText(/^\d+:\d+ behind live$/);
      await expect(screen.getByTestId('player-live-mark')).toBeHidden();
      await expect(screen.getByTestId('player-start-over')).toBeHidden();
      await expect(screen.getByTestId('player-status')).toBeHidden();
      const progress = async () => {
        const video = await videoState(browser);
        return { ...video, rewind: positionBeforeRewind - video.position };
      };
      try {
        await expect.poll(async () => {
          const video = await progress();
          return video.hasFrame && video.paused && !video.seeking && Math.abs(video.position - requested) < 0.5;
        }, { timeout: 15_000 }).toBe(true);
      } catch (error) {
        console.info('Rewind picture state', { before: positionBeforeRewind, requested, ...(await progress()) });
        await app.screenshot('paused-live-rewind-diagnostic');
        throw error;
      }
      await app.screenshot('paused-live-rewind');
      await browser.setViewport({ width: 390, height: 844 });
      await expect(goLive).toBeVisible();
      await expect.poll(() => browser.evaluate(() => {
        const status = document.querySelector('[data-testid="player-live-status"]')?.getBoundingClientRect();
        const chip = document.querySelector('[data-testid="player-go-live"]');
        const controls = document.querySelector('[data-testid="player-phone-controls"]');
        const button = chip?.getBoundingClientRect();
        return !!(status && button && controls && !controls.contains(chip)
          && button.left >= status.right && button.top <= status.top && button.bottom >= status.bottom);
      })).toBe(true);
      await app.screenshot('compact-go-live');
      const goLivesBefore = commands.filter(kind => kind === 'goLive').length;
      await goLive.tap();
      await expect(screen.getByTestId('player-status')).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-label', 'Pause', { timeout: 35_000 });
      await expect.poll(() => commands.filter(kind => kind === 'goLive').length).toBe(goLivesBefore + 1);
      await browser.setViewport({ width: 1440, height: 900 });

      await waitForVideoPlayback(browser, screen);
      const recoveryPosition = await rewindForRecovery();
      const recoveredTimeshift = await recoverWatch(true);
      expect(Math.abs(recoveredTimeshift.position! - recoveryPosition)).toBeLessThan(3);
      expect(recoveredTimeshift.start.channelId).toBe('channel-1');
      expect(recoveredTimeshift.start.from).toBeUndefined();
      await closeWatch();
      await openLiveAtEdge();
      await rewindForRecovery();
      expect(await setRewindSegments(10)).toBe(10);
      await recoverWatch(false, 'Your position left the rewind window. You’re watching live.');
      await expect(screen.getByTestId('player-live-mark')).toBeVisible();
      expect(await setRewindSegments(0)).toBe(0);
    } finally {
      try { await closeWatch(); }
      finally {
        await browser.unroute(eventsRoute);
        await browser.unroute(sessionRoute);
        await browser.unroute(playbackRoute);
        await setRewindSegments(0);
        await browser.evaluate(async () => {
          await fetch('/__admin/faults', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catchUpFixture: false }),
          });
        });
      }
    }
  });
});
