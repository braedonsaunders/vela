import { beforeAll, describe, expect, test } from 'bun:test';
import { setLocale } from '../src/i18n';
import {
  catchUpErrorMessage, catchUpOffer, catchUpPictureTime, catchUpRefusal, catchUpRequest, clampSeek, delayedScores, delayLabel,
  pictureTime, programmeCatchUp, stepLandsLive, timeshiftWindow, watchFromStart, windowFraction,
} from '../src/live/timeshift';
import type * as V from '../src/wire';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const NOW = Date.parse('2026-03-10T14:10:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const both = { archive: true, timeshift: true };
beforeAll(() => setLocale(JSON.stringify({ locale: 'en', formatLocale: 'en', resolvedLocale: 'en', timeZone: 'UTC', utcOffset: 0 })));

const programme = (start: number, end: number, extra: Partial<V.Programme> = {}) => ({ start: iso(start), end: iso(end), ...extra });

describe('catch-up offer', () => {
  test('reads the archive and timeshift independently', () => {
    expect(catchUpOffer({ liveCatchUp: { available: false, timeshift: { available: true, maxMinutes: 60 } } })).toEqual({ archive: false, timeshift: true });
    expect(catchUpOffer({ liveCatchUp: { available: true, maxDays: 7, timeshift: { available: false } } })).toEqual({ archive: true, maxDays: 7, timeshift: false });
    expect(catchUpOffer({})).toEqual({ archive: false, timeshift: false });
    expect(catchUpOffer(null)).toEqual({ archive: false, timeshift: false });
  });
});

describe('guide eligibility', () => {
  test('an ended programme inside the archive is catch-up; one on air is Start over', () => {
    expect(programmeCatchUp(programme(NOW - 2 * HOUR, NOW - HOUR), 7, NOW, both)).toBe('catchUp');
    expect(programmeCatchUp(programme(NOW - 10 * MINUTE, NOW + 20 * MINUTE), 7, NOW, both)).toBe('startOver');
  });

  test('upcoming programmes and channels without an archive are not replayable', () => {
    expect(programmeCatchUp(programme(NOW + MINUTE, NOW + HOUR), 7, NOW, both)).toBeNull();
    expect(programmeCatchUp(programme(NOW - 2 * HOUR, NOW - HOUR), undefined, NOW, both)).toBeNull();
    expect(catchUpRefusal(programme(NOW + MINUTE, NOW + HOUR), 7, NOW, both)).toBe('upcoming');
    expect(catchUpRefusal(programme(NOW - 2 * HOUR, NOW - HOUR), undefined, NOW, both)).toBe('no-archive');
  });

  test('the archive depth bounds the start', () => {
    expect(programmeCatchUp(programme(NOW - 2 * DAY - HOUR, NOW - 2 * DAY), 2, NOW, both)).toBeNull();
    expect(catchUpRefusal(programme(NOW - 2 * DAY - HOUR, NOW - 2 * DAY), 2, NOW, both)).toBe('too-old');
    expect(programmeCatchUp(programme(NOW - 2 * DAY + MINUTE, NOW - 2 * DAY + HOUR), 2, NOW, both)).toBe('catchUp');
  });

  test('without the server offering an archive nothing replays, flags or not', () => {
    const none = { archive: false, timeshift: true };
    expect(programmeCatchUp(programme(NOW - 2 * HOUR, NOW - HOUR, { catchUp: true }), 7, NOW, none)).toBeNull();
  });

  test('flags decide without a depth and move with the clock', () => {
    // Cached while on air, the programme has ended since: catch-up, not Start over.
    expect(programmeCatchUp(programme(NOW - HOUR, NOW - MINUTE, { startOver: true }), undefined, NOW, both)).toBe('catchUp');
    expect(programmeCatchUp(programme(NOW - HOUR, NOW + MINUTE, { startOver: true }), undefined, NOW, both)).toBe('startOver');
    // A flag cannot make an upcoming programme playable.
    expect(programmeCatchUp(programme(NOW + MINUTE, NOW + HOUR, { catchUp: true }), undefined, NOW, both)).toBeNull();
    // Explicit flags override a cached channel depth.
    expect(programmeCatchUp(programme(NOW - 3 * DAY, NOW - 3 * DAY + HOUR, { catchUp: true }), 2, NOW, both)).toBe('catchUp');
    expect(programmeCatchUp(programme(NOW - HOUR, NOW, { catchUp: false, startOver: true }), 2, NOW, both)).toBeNull();
  });

  test('requests ask for the range, or for the programme on air from its start', () => {
    expect(catchUpRequest('c1', 'p1', 'catchUp')).toEqual({ channelId: 'c1', programmeId: 'p1' });
    expect(catchUpRequest('c1', 'p1', 'startOver')).toEqual({ channelId: 'c1', programmeId: 'p1', from: 'start' });
  });

  test('a watch target offers Watch from start only with its programme in the archive', () => {
    const target: V.WatchTarget = { kind: 'channel', channelId: 'c1', name: 'One', live: true, confidence: 1,
      programme: { id: 'p', start: iso(NOW - 30 * MINUTE), end: iso(NOW + HOUR), startOver: true } };
    expect(watchFromStart(target, NOW, both)).toBe('startOver');
    expect(watchFromStart({ ...target, available: false }, NOW, both)).toBeNull();
    expect(watchFromStart({ ...target, programme: undefined }, NOW, both)).toBeNull();
    expect(watchFromStart({ ...target, programme: { ...target.programme!, startOver: undefined } }, NOW, both)).toBeNull();
  });
});

describe('the rewind window', () => {
  const live = { mode: 'adaptive' as const, windowStartSeconds: 100, liveEdgeSeconds: 1900, timeshift: { maxMinutes: 30 } };

  test('the edge grows from the plan in real time, and a bounded window follows it', () => {
    const window = timeshiftWindow({ live, receivedAt: NOW, now: NOW + 60_000, position: 1950 })!;
    expect(window.edge).toBe(1960);
    expect(window.start).toBe(160);
    expect(window.behind).toBe(10);
    expect(window.delayed).toBe(false);
    expect(window.seekable).toBe(true);
  });

  test('the server clock anchors the window even when a plan arrives late', () => {
    const window = timeshiftWindow({ live: { ...live, edgeAt: iso(NOW) }, receivedAt: NOW + 5_000,
      now: NOW + 10_000, position: 1850 })!;
    expect(window).toMatchObject({ edge: 1910, edgeAt: NOW + 10_000, behind: 60 });
  });

  test('a paused playhead falls behind and is held inside the window', () => {
    const paused = timeshiftWindow({ live, receivedAt: NOW, now: NOW + 10 * MINUTE, position: 1000 })!;
    expect(paused.behind).toBe(1500);
    expect(paused.delayed).toBe(true);
    const evicted = timeshiftWindow({ live, receivedAt: NOW, now: NOW + 40 * MINUTE, position: 120 })!;
    expect(evicted.position).toBe(evicted.start);
  });

  test("the engine's own window wins: it shares the playhead's timeline", () => {
    const window = timeshiftWindow({ live, receivedAt: NOW, now: NOW + HOUR, position: 50, engine: { edgeSeconds: 80, windowStartSeconds: 0, canCatchUp: true } })!;
    expect(window).toMatchObject({ start: 0, edge: 80, position: 50, behind: 30, delayed: true });
    expect(timeshiftWindow({ live, receivedAt: NOW, now: NOW, position: 70, engine: { edgeSeconds: 80, windowStartSeconds: 0, canCatchUp: false } })!.delayed).toBe(false);
  });

  test('clock labels carry the plan wall clock into the engine timeline', () => {
    const window = timeshiftWindow({ live: { ...live, edgeAt: iso(NOW) }, receivedAt: NOW, now: NOW + 10_000,
      position: 1850, engine: { edgeSeconds: 1906, windowStartSeconds: 100, canCatchUp: true } });
    expect(window).toMatchObject({ edge: 1906, edgeAt: NOW + 6_000, behind: 56 });
  });

  test("a paused engine's edge stands still; the window's grows from when it last moved", () => {
    const window = timeshiftWindow({ live, receivedAt: NOW, now: NOW + 60_000, position: 70,
      engine: { edgeSeconds: 80, windowStartSeconds: 0, canCatchUp: false, edgeMovedAt: NOW } })!;
    expect(window.edge).toBe(140);
    expect(window.behind).toBe(70);
    expect(window.delayed).toBe(true);
  });

  test("a playing engine's verdict stands, even well behind its usual latency", () => {
    const window = timeshiftWindow({ live, receivedAt: NOW, now: NOW + 5000, position: 25, engine: { edgeSeconds: 80, windowStartSeconds: 0, canCatchUp: false, edgeMovedAt: NOW } })!;
    expect(window.behind).toBe(60);
    expect(window.delayed).toBe(false);
  });

  test('without a rewind window only the engine can call playback behind', () => {
    const plain = { mode: 'adaptive' as const, windowStartSeconds: 0, liveEdgeSeconds: 48 };
    const window = timeshiftWindow({ live: plain, receivedAt: NOW, now: NOW, position: 0 })!;
    expect(window.seekable).toBe(false);
    expect(window.delayed).toBe(false);
  });

  test('Start over keeps its beginning and can always seek', () => {
    const startOver = { mode: 'startOver' as const, windowStartSeconds: 0, liveEdgeSeconds: 1820 };
    const window = timeshiftWindow({ live: startOver, receivedAt: NOW, now: NOW + 2 * HOUR, position: 0 })!;
    expect(window.start).toBe(0);
    expect(window.seekable).toBe(true);
    expect(window.startOver).toBe(true);
    expect(window.behind).toBe(1820 + 7200);
  });

  test('no edge yet means no window', () => {
    expect(timeshiftWindow({ live: { mode: 'adaptive' }, receivedAt: NOW, now: NOW, position: 0 })).toBeNull();
  });

  test('seeks land inside the window, short of the edge', () => {
    expect(clampSeek({ start: 100, edge: 1000 }, 20)).toBe(100);
    expect(clampSeek({ start: 100, edge: 1000 }, 999)).toBe(985);
    expect(clampSeek({ start: 100, edge: 1000 }, 500)).toBe(500);
    expect(stepLandsLive({ edge: 1000, position: 980 }, 10)).toBe(true);
    expect(stepLandsLive({ edge: 1000, position: 999 }, -10)).toBe(false);
    expect(stepLandsLive({ edge: 1000, position: 900 }, 10)).toBe(false);
    expect(windowFraction({ start: 100, edge: 300, position: 150 })).toBe(0.25);
    expect(windowFraction({ start: 100, edge: 100, position: 100 })).toBe(1);
  });
});

describe('labels and picture time', () => {
  test('the delay reads as a negative clock', () => {
    expect(delayLabel(750)).toBe('-12:30');
    expect(delayLabel(3723)).toBe('-1:02:03');
    expect(delayLabel(0.4)).toBe('');
  });

  test('the picture is now less the delay, or the programme start plus the position', () => {
    expect(pictureTime(NOW, 90)).toBe(NOW - 90_000);
    expect(catchUpPictureTime({ catchUp: { channelId: 'c', startAt: iso(NOW - HOUR) } }, 600)).toBe(NOW - HOUR + 600_000);
    expect(catchUpPictureTime({}, 600)).toBeNull();
  });

  test('refusals have words; other errors do not', () => {
    for (const code of ['catchup_not_supported', 'catchup_outside_archive', 'catchup_unavailable', 'timeshift_outside_window', 'timeshift_position_evicted'])
      expect(catchUpErrorMessage(code)).not.toBe('');
    expect(catchUpErrorMessage('provider_busy')).not.toBe('');
    expect(catchUpErrorMessage('unknown')).toBe('');
  });
});

describe('spoiler-aware scores', () => {
  const plays: V.LivePlay[] = [
    { text: 'Goal', emphasis: 'score', at: iso(NOW - 20 * MINUTE), score: { home: '1', away: '0' } },
    { text: 'Goal', emphasis: 'score', at: iso(NOW - 5 * MINUTE), score: { home: '1', away: '1' } },
    { text: 'Corner', emphasis: 'normal' },
  ];

  test('close to live the live score stands', () => {
    expect(delayedScores(plays, NOW - 10_000, 10)).toEqual({ kind: 'live' });
  });

  test('behind live the score is the one on screen', () => {
    expect(delayedScores(plays, NOW - 10 * MINUTE, 600)).toEqual({ kind: 'asOf', scores: { home: '1', away: '0' } });
    expect(delayedScores(plays, NOW - 30 * MINUTE, 1800)).toEqual({ kind: 'asOf', scores: {} });
  });

  test('an untimed score before the first timed one leaves the score on screen unknown', () => {
    const mixed: V.LivePlay[] = [{ text: 'Goal', emphasis: 'score' }, ...plays];
    expect(delayedScores(mixed, NOW - 30 * MINUTE, 1800)).toEqual({ kind: 'hidden' });
  });

  test('without timed, scored plays the scores are hidden', () => {
    expect(delayedScores([{ text: 'Goal', emphasis: 'score' }], NOW - 10 * MINUTE, 600)).toEqual({ kind: 'hidden' });
    expect(delayedScores(undefined, NOW - 10 * MINUTE, 600)).toEqual({ kind: 'hidden' });
  });
});
