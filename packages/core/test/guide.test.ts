import { beforeAll, describe, expect, test } from 'bun:test';
import { setLocale } from '../src/i18n';
import { VelaError } from '../src/adapter/errors';
import { guideFocus, liveIdentity, loadGuide, type GuideApi } from '../src/live/guide';
import type * as V from '../src/wire';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
// 14:10 UTC on a Tuesday, read in UTC (the guide's zone is the locale context's; the device's otherwise).
beforeAll(() => setLocale(JSON.stringify({ locale: 'en', formatLocale: 'en', resolvedLocale: 'en', timeZone: 'UTC', utcOffset: 0 })));
const NOW = Date.parse('2026-03-10T14:10:00Z');
const MIDNIGHT = Date.parse('2026-03-10T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const channel = (n: number, extra: Partial<V.Channel> = {}): V.Channel =>
  ({ id: `c${n}`, number: String(100 + n), name: `Channel ${n}`, kind: 'tv', artwork: [], favorite: false, ...extra });
const programme = (channelId: string, id: string, start: number, end: number, extra: Partial<V.Programme> = {}): V.Programme =>
  ({ id, channelId, name: id, summary: '', start: iso(start), end: iso(end), artwork: [], ...extra });

/** A guide server over fixed listings, recording each request. Pages hold `pageSize` items. */
function fakeApi(channels: V.Channel[], programmes: V.Programme[], pageSize = 1000) {
  const guideQueries: V.GuideQuery[] = [];
  const channelCursors: (string | undefined)[] = [];
  const pageOf = <T>(items: T[], cursor?: string): V.Page<T> => {
    const start = Number(cursor ?? 0), more = start + pageSize < items.length;
    return { items: items.slice(start, start + pageSize), continuation: more ? 'more' : 'exhausted', ...(more ? { nextCursor: String(start + pageSize) } : {}) };
  };
  const api: GuideApi = {
    async channels(cursor) { channelCursors.push(cursor); return pageOf(channels, cursor); },
    async guide(q) {
      guideQueries.push(q);
      const from = Date.parse(q.from), until = Date.parse(q.until);
      const ids = q.channelIds && new Set(q.channelIds);
      const items = programmes.filter(p => Date.parse(p.end) > from && Date.parse(p.start) < until && (!ids || ids.has(p.channelId)));
      return { ...pageOf(items, q.cursor), from: q.from, until: q.until };
    },
  };
  return { api, guideQueries, channelCursors };
}

// The guide caches listings per scope; each test reads its own.
let scopes = 0;
const scope = () => `test-${++scopes}`;

describe('loadGuide window', () => {
  test('today spans the local day, with now, landing, ticks and a week of days', async () => {
    const { api, guideQueries } = fakeApi([channel(1)], []);
    const model = await loadGuide(api, 0, NOW, scope());
    expect(model.minutes).toBe(1440);
    expect(model.nowMinute).toBe(850);
    expect(model.landing).toBe(850);
    expect(model.dayLabel).toBe('Today');
    expect(model.ticks).toHaveLength(48);
    expect(model.ticks[0]).toMatchObject({ minute: 0, hour: true, id: String(MIDNIGHT) });
    expect(model.ticks[1]).toMatchObject({ minute: 30, hour: false });
    expect(model.days.map(d => d.offset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(model.days.slice(0, 2).map(d => d.label)).toEqual(['Today', 'Tomorrow']);
    // Today's whole-day window is also the current window: one guide read.
    expect(guideQueries).toEqual([{ from: iso(MIDNIGHT), until: iso(MIDNIGHT + DAY), cursor: undefined, limit: 100, channelIds: undefined }]);
  });

  test('a later day is not airing and lands at the same clock time', async () => {
    const { api, guideQueries } = fakeApi([channel(1)], []);
    const model = await loadGuide(api, 2, NOW, scope());
    expect(model.nowMinute).toBe(-1);
    expect(model.landing).toBe(850);
    expect(guideQueries[0]).toMatchObject({ from: iso(MIDNIGHT + 2 * DAY), until: iso(MIDNIGHT + 3 * DAY) });
    // The channel column's now/next always reads the current two hours as well.
    expect(guideQueries[1]).toMatchObject({ from: iso(Date.parse('2026-03-10T14:00:00Z')), until: iso(Date.parse('2026-03-10T16:00:00Z')) });
  });

  test('a range around now snaps outwards to half hours and stays inside the day', async () => {
    const { api, guideQueries } = fakeApi([channel(1)], []);
    await loadGuide(api, 0, NOW, scope(), undefined, undefined, undefined, { from: -1, to: 0 });
    // now is minute 850: 150 before (700 → 690) to 240 after (1090 → 1110).
    expect(guideQueries[0]).toMatchObject({ from: iso(MIDNIGHT + 690 * MINUTE), until: iso(MIDNIGHT + 1110 * MINUTE) });
    guideQueries.length = 0;
    await loadGuide(api, 0, NOW, scope(), undefined, undefined, undefined, { from: -100, to: 5000 });
    expect(guideQueries[0]).toMatchObject({ from: iso(MIDNIGHT), until: iso(MIDNIGHT + DAY) });
  });

  test.each([-1, 7, 1.5])('refuses day %p', async day => {
    const { api } = fakeApi([], []);
    await expect(loadGuide(api, day, NOW, scope())).rejects.toThrow('Invalid guide day');
  });

  test('a spring-forward day is 23 hours; a fall-back day is capped at the 24-hour window', async () => {
    const locale = JSON.stringify({ locale: 'en', formatLocale: 'en-US', resolvedLocale: 'en', timeZone: 'America/New_York', utcOffset: -300 });
    const { api, guideQueries } = fakeApi([channel(1)], []);
    const spring = await loadGuide(api, 0, Date.parse('2026-03-08T15:00:00Z'), scope(), undefined, locale);
    expect(spring.minutes).toBe(23 * 60);
    expect(guideQueries[0]).toMatchObject({ from: '2026-03-08T05:00:00.000Z', until: '2026-03-09T04:00:00.000Z' });
    const autumn = await loadGuide(api, 0, Date.parse('2026-11-01T15:00:00Z'), scope(), undefined, locale);
    expect(autumn.minutes).toBe(24 * 60);
    expect(autumn.ticks).toHaveLength(48);
  });
});

describe('loadGuide channel batches', () => {
  test('requested channels are read in batches of 100', async () => {
    const channels = Array.from({ length: 250 }, (_, i) => channel(i));
    const { api, guideQueries } = fakeApi(channels, []);
    await loadGuide(api, 0, NOW, scope(), undefined, undefined, channels.map(c => c.id));
    expect(guideQueries.map(q => q.channelIds?.length)).toEqual([100, 100, 50]);
    expect(guideQueries[2]!.channelIds![0]).toBe('c200');
  });

  test('an empty selection loads the first 30 channels, favourites first', async () => {
    const channels = Array.from({ length: 40 }, (_, i) => channel(i, { favorite: i >= 35 }));
    const { api, guideQueries } = fakeApi(channels, []);
    const model = await loadGuide(api, 0, NOW, scope(), undefined, undefined, []);
    const requested = guideQueries[0]!.channelIds!;
    expect(requested).toHaveLength(30);
    expect(requested.slice(0, 5)).toEqual(['c35', 'c36', 'c37', 'c38', 'c39']);
    expect(model.channels.filter(c => c.listingsLoaded)).toHaveLength(30);
    expect(model.channels.find(c => c.id === 'c34')?.listingsLoaded).toBe(false);
    // Without a selection every channel counts as loaded.
    const all = await loadGuide(api, 0, NOW, scope());
    expect(all.channels.every(c => c.listingsLoaded)).toBe(true);
  });

  test('every channel and guide page is read', async () => {
    const channels = Array.from({ length: 5 }, (_, i) => channel(i));
    const programmes = channels.map(c => programme(c.id, `${c.id}-now`, NOW - HOUR, NOW + HOUR));
    const { api, guideQueries, channelCursors } = fakeApi(channels, programmes, 2);
    const model = await loadGuide(api, 0, NOW, scope());
    expect(channelCursors).toEqual([undefined, '2', '4']);
    expect(guideQueries.map(q => q.cursor)).toEqual([undefined, '2', '4']);
    expect(model.channels.every(c => c.listed)).toBe(true);
  });
});

describe('loadGuide pagination failures', () => {
  const guideWith = (pages: (cursor?: string) => V.GuideResponse): GuideApi => ({
    channels: async () => ({ items: [channel(1)], continuation: 'exhausted' }),
    guide: async q => pages(q.cursor),
  });
  const envelope = { from: iso(MIDNIGHT), until: iso(MIDNIGHT + DAY), items: [] };

  test('an unknown continuation is never shown as complete', async () => {
    const api = guideWith(() => ({ ...envelope, continuation: 'unknown' }));
    await expect(loadGuide(api, 0, NOW, scope())).rejects.toThrow('Guide pagination is incomplete');
  });

  test('a repeated or missing cursor is refused', async () => {
    const loop = guideWith(() => ({ ...envelope, continuation: 'more', nextCursor: 'same' }));
    await expect(loadGuide(loop, 0, NOW, scope())).rejects.toThrow('Invalid guide continuation');
    const missing = guideWith(() => ({ ...envelope, continuation: 'more' }));
    await expect(loadGuide(missing, 0, NOW, scope())).rejects.toThrow('Invalid guide continuation');
  });

  test('an expired cursor restarts from the first page once', async () => {
    let calls = 0;
    const api = guideWith(cursor => {
      calls++;
      if (calls === 2) throw new VelaError({ class: 'conflict', code: 'cursor_expired', message: 'expired', retry: { allowed: false } }, 409);
      return cursor ? { ...envelope, continuation: 'exhausted' } : { ...envelope, continuation: 'more', nextCursor: 'p2' };
    });
    await loadGuide(api, 0, NOW, scope());
    expect(calls).toBe(4);
  });

  test('a failed window is not cached', async () => {
    let fail = true;
    const api = guideWith(() => {
      if (fail) throw new Error('offline');
      return { ...envelope, continuation: 'exhausted' };
    });
    const id = scope();
    await expect(loadGuide(api, 0, NOW, id)).rejects.toThrow('offline');
    await Promise.resolve();
    fail = false;
    await expect(loadGuide(api, 0, NOW, id)).resolves.toBeDefined();
  });

  test('listings are reused for five minutes', async () => {
    const { api, guideQueries, channelCursors } = fakeApi([channel(1)], []);
    const id = scope();
    await loadGuide(api, 0, NOW, id);
    await loadGuide(api, 0, NOW + 4 * MINUTE, id);
    expect(guideQueries).toHaveLength(1);
    expect(channelCursors).toHaveLength(1);
    await loadGuide(api, 0, NOW + 5 * MINUTE, id);
    expect(guideQueries).toHaveLength(2);
  });
});

describe('loadGuide projection', () => {
  const channels = [
    channel(1, { group: 'News', guides: [{ id: 'g-news', name: 'News' }] }),
    channel(2, { favorite: true, group: 'Sport', guides: [{ id: 'g-sport', name: 'Sport' }, { id: 'g-news', name: 'News' }] }),
    channel(3, { group: 'News' }),
  ];
  const programmes = [
    // Started yesterday, airing now: clamped to the window start.
    programme('c1', 'p1-a', MIDNIGHT - HOUR, NOW - 10 * MINUTE),
    programme('c1', 'p1-b', NOW - 10 * MINUTE, NOW + 50 * MINUTE, { genres: ['Evening News'], seasonNumber: 2, episodeNumber: 5, episodeTitle: 'Pilot', rating: 'PG' }),
    programme('c1', 'p1-c', NOW + 50 * MINUTE, MIDNIGHT + DAY + HOUR),
    programme('c2', 'p2-a', MIDNIGHT + 13 * HOUR, MIDNIGHT + 16 * HOUR, { genres: ['Football'] }),
    // Invalid: ends before it starts.
    programme('c2', 'p2-bad', MIDNIGHT + 17 * HOUR, MIDNIGHT + 16 * HOUR),
  ];

  test('favourites come first; groups and guides keep first appearance in server order', async () => {
    const { api } = fakeApi(channels, programmes);
    const model = await loadGuide(api, 0, NOW, scope());
    expect(model.channels.map(c => c.id)).toEqual(['c2', 'c1', 'c3']);
    expect(model.tuneOrder).toEqual(['c1', 'c2', 'c3']);
    expect(model.groups).toEqual(['Sport', 'News']);
    expect(model.guides).toEqual([{ id: 'g-news', name: 'News' }, { id: 'g-sport', name: 'Sport' }]);
    expect(model.channels[0]!.guideIds).toEqual(['g-sport', 'g-news']);
    expect(model.channels.find(c => c.id === 'c3')).toMatchObject({ listed: false, programmes: [], now: '' });
  });

  test('programmes are placed in window minutes, clamped, with airing state', async () => {
    const { api } = fakeApi(channels, programmes);
    const model = await loadGuide(api, 0, NOW, scope());
    const c1 = model.channels.find(c => c.id === 'c1')!;
    expect(c1.programmes.map(p => [p.id, p.at, p.span, p.airing, p.ended])).toEqual([
      ['p1-a', 0, 840, false, true],
      ['p1-b', 840, 60, true, false],
      ['p1-c', 900, 540, false, false],
    ]);
    const airing = c1.programmes[1]!;
    expect(airing.progress).toBe(16.7);
    expect(airing.remainingLabel).toBe('50 min left');
    expect(airing.episode).toBe('S2 E5 · Pilot');
    expect(airing).toMatchObject({ genre: 'Evening News', tone: 0, rating: 'PG' });
    expect(c1.programmes[2]!.startsLabel).toBe('Starts in 50 min');
    expect(c1).toMatchObject({ now: 'p1-b', nowId: 'p1-b', next: 'p1-c', nowProgress: 16.7, nowRemaining: '50 min left', nowGenre: 'Evening News' });
    // The invalid programme is dropped.
    expect(model.channels.find(c => c.id === 'c2')!.programmes.map(p => p.id)).toEqual(['p2-a']);
  });

  test('cells link to their neighbours across and between rows', async () => {
    const { api } = fakeApi(channels, programmes);
    const model = await loadGuide(api, 0, NOW, scope());
    const [c2, c1] = model.channels;
    const football = c2!.programmes[0]!;
    expect(football).toMatchObject({ leftId: '', rightId: '', upId: '' });
    // 13:00 falls inside p1-a (00:00–14:00) on the row below.
    expect(football.downId).toBe('guide-p1-a');
    expect(c1!.programmes[1]).toMatchObject({ leftId: 'guide-p1-a', rightId: 'guide-p1-c', upId: 'guide-p2-a', downId: '' });
    // Nothing overlaps 15:00 above p1-c, so the nearest start wins.
    expect(c1!.programmes[2]!.upId).toBe('guide-p2-a');
  });

  test('genre tones are stable palette slots', async () => {
    const tones = ['World News', 'Sports', 'Movies', 'Kids', 'Documentary', 'Drama', 'Comedy', 'Music', 'Lifestyle', 'Weather', ''];
    const list = tones.map((genre, i) => programme('c1', `t${i}`, MIDNIGHT + i * HOUR, MIDNIGHT + (i + 1) * HOUR, { genres: genre ? [genre] : [] }));
    const { api } = fakeApi([channel(1)], list);
    const model = await loadGuide(api, 0, NOW, scope());
    expect(model.channels[0]!.programmes.map(p => p.tone)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1]);
  });
});

describe('guideFocus', () => {
  test('places a timestamp by local day offset and minute', () => {
    expect(guideFocus('2026-03-10T18:30:00Z', NOW)).toEqual({ day: 0, minute: 1110 });
    expect(guideFocus('2026-03-12T00:15:00Z', NOW)).toEqual({ day: 2, minute: 15 });
    expect(guideFocus('2026-03-16T23:59:00Z', NOW).day).toBe(6);
  });

  test('outside the week or unparseable is day -1', () => {
    expect(guideFocus('2026-03-17T00:00:00Z', NOW).day).toBe(-1);
    expect(guideFocus('2026-03-09T23:00:00Z', NOW).day).toBe(-1);
    expect(guideFocus('not a date', NOW)).toEqual({ day: -1, minute: 0 });
  });

  test('uses the viewer zone', () => {
    const tokyo = JSON.stringify({ locale: 'en', formatLocale: 'en', resolvedLocale: 'en', timeZone: 'Asia/Tokyo', utcOffset: 540 });
    // 18:30 UTC on the 10th is 03:30 on the 11th in Tokyo, the day after Tokyo's "today".
    expect(guideFocus('2026-03-10T18:30:00Z', NOW, tokyo)).toEqual({ day: 1, minute: 210 });
  });
});

describe('liveIdentity', () => {
  test('names the channel and what is airing', async () => {
    const { api, guideQueries } = fakeApi([channel(1)], [programme('c1', 'Evening Show', NOW - HOUR, NOW + HOUR)]);
    expect(await liveIdentity(api, 'c1', NOW)).toEqual({ title: 'Channel 1 · Evening Show' });
    expect(guideQueries[0]).toMatchObject({ channelIds: ['c1'], from: iso(NOW), until: iso(NOW + MINUTE) });
  });

  test('falls back to the channel name, then a generic title', async () => {
    const { api } = fakeApi([channel(1)], []);
    expect(await liveIdentity(api, 'c1', NOW)).toEqual({ title: 'Channel 1' });
    expect((await liveIdentity(api, 'missing', NOW)).title).toBeTruthy();
  });
});

test('guide viewport expansion and minute projections reuse completed channel pages for five minutes', async () => {
  const { api, guideQueries } = fakeApi([channel(1), channel(2), channel(3)], [
    programme('c1', 'one', NOW - MINUTE, NOW + HOUR),
    programme('c2', 'two', NOW - MINUTE, NOW + HOUR),
    programme('c3', 'three', NOW - MINUTE, NOW + HOUR),
  ]);
  const id = scope();
  await loadGuide(api, 0, NOW, id, undefined, undefined, ['c1', 'c2']);
  const expanded = await loadGuide(api, 0, NOW, id, undefined, undefined, ['c1', 'c2', 'c3']);
  expect(guideQueries.map(q => q.channelIds)).toEqual([['c1', 'c2'], ['c3']]);
  expect(expanded.channels.find(c => c.id === 'c2')?.programmes[0]?.name).toBe('two');
  for (let minute = 1; minute < 5; minute++) {
    await loadGuide(api, 0, NOW + minute * MINUTE, id, undefined, undefined, ['c2', 'c3']);
  }
  expect(guideQueries).toHaveLength(2);
  await loadGuide(api, 0, NOW + 5 * MINUTE, id, undefined, undefined, ['c2', 'c3']);
  expect(guideQueries).toHaveLength(3);
  expect(guideQueries[2]?.channelIds).toEqual(['c2', 'c3']);
});

test('a 30-to-48 channel expansion reads 24 pages once, rather than repeating the first 15', async () => {
  const channels = Array.from({ length: 48 }, (_, i) => channel(i));
  const programmes = channels.flatMap(c => Array.from({ length: 48 }, (_, i) =>
    programme(c.id, `${c.id}-${i}`, MIDNIGHT + i * 30 * MINUTE, MIDNIGHT + (i + 1) * 30 * MINUTE)));
  const { api, guideQueries } = fakeApi(channels, programmes, 100);
  const id = scope();
  await loadGuide(api, 0, NOW, id, undefined, undefined, []);
  expect(guideQueries).toHaveLength(15);
  await loadGuide(api, 0, NOW, id, undefined, undefined, channels.map(c => c.id));
  expect(guideQueries).toHaveLength(24);
  for (let minute = 1; minute < 5; minute++) {
    await loadGuide(api, 0, NOW + minute * MINUTE, id, undefined, undefined, channels.slice(10, 30).map(c => c.id));
  }
  expect(guideQueries).toHaveLength(24);
});
