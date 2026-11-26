import { expect, test } from 'bun:test';
import { readGuideWindow } from '../src/live/bulk';
import { loadGuide, type GuideApi } from '../src/live/guide';
import { VelaError } from '../src/adapter/errors';
import type { Channel, GuideWindowRequest, GuideWindowResponse, Programme } from '../src/wire';

const NOW = Date.UTC(2026, 10, 18, 12), MINUTE = 60000;
const query: GuideWindowRequest = { channelIds: ['one', 'two'], from: new Date(NOW).toISOString(), until: new Date(NOW + 180 * MINUTE).toISOString() };
const answer = (q: GuideWindowRequest, unavailable: string[] = [], expiry = NOW + 300 * MINUTE): GuideWindowResponse => ({
  from: q.from, until: q.until, revision: 'revision', validUntil: new Date(expiry).toISOString(),
  channels: q.channelIds.map(channelId => ({ channelId, state: unavailable.includes(channelId) ? 'unavailable' : 'ready', programmes: [] })),
});
const dense = (maxChannels: number, maxWindowMinutes: number) => new VelaError({ class: 'request', code: 'guide_window_too_dense', message: 'Dense', retry: { allowed: false }, suggest: { maxChannels, maxWindowMinutes } }, 400);

test('absent capability falls back; missing or misordered rows never become loaded', async () => {
  expect(await readGuideWindow({}, query)).toBeNull();
  await expect(readGuideWindow({ guideWindow: async q => ({ ...answer(q), channels: [] }) }, query)).rejects.toThrow('Incomplete guide window');
  await expect(readGuideWindow({ guideWindow: async q => ({ ...answer(q), channels: answer(q).channels.reverse() }) }, query)).rejects.toThrow('Incomplete guide window');
});

test('too-dense windows split channel IDs without losing request order', async () => {
  const requests: GuideWindowRequest[] = [];
  const result = await readGuideWindow({ guideWindow: async q => { requests.push(q); if (q.channelIds.length > 1) throw dense(1, 180); return answer(q); } }, query);
  expect(requests.map(q => q.channelIds)).toEqual([['one', 'two'], ['one'], ['two']]);
  expect(result?.channels.map(row => row.channelId)).toEqual(['one', 'two']);
});

test('splitting time keeps crossing programmes whole and deduplicates them', async () => {
  const q = { ...query, channelIds: ['one'] };
  const programme: Programme = { id: 'crossing', channelId: 'one', name: 'Crossing', summary: '', artwork: [], start: new Date(NOW + 20 * MINUTE).toISOString(), end: new Date(NOW + 100 * MINUTE).toISOString() };
  const result = await readGuideWindow({ guideWindow: async part => {
    if (Date.parse(part.until) - Date.parse(part.from) > 90 * MINUTE) throw dense(1, 90);
    return { ...answer(part), channels: [{ channelId: 'one', state: 'ready', programmes: [programme] }] };
  } }, q);
  expect(result?.channels[0]?.programmes).toEqual([programme]);
});

test('unavailable is retryable, empty is ready, and cache expiry permits recovery', async () => {
  let clock = NOW, failed = true, requests = 0;
  const channels: Channel[] = ['one', 'two'].map(id => ({ id, name: id, number: id, kind: 'tv', artwork: [], favorite: false }));
  const api: GuideApi = {
    channels: async () => ({ items: channels, continuation: 'exhausted' }),
    guide: async () => { throw new Error('Bulk support must not read pages'); },
    guideWindow: async q => { requests++; return answer(q, failed ? ['two'] : [], clock + MINUTE); },
  };
  const scope = 'bulk-expiry';
  const first = await loadGuide(api, 0, clock, scope, undefined, undefined, ['one', 'two'], { from: 720, to: 900 });
  expect(first.channels[0]).toMatchObject({ listingsLoaded: true, listed: false, listingsUnavailable: false });
  expect(first.channels[1]).toMatchObject({ listingsLoaded: false, listingsUnavailable: true });
  expect(first.retryAt).toBe(clock + MINUTE);
  const initialRequests = requests;
  await loadGuide(api, 0, clock + 1000, scope, undefined, undefined, ['one', 'two'], { from: 720, to: 900 });
  expect(requests).toBe(initialRequests);
  clock += MINUTE + 1; failed = false;
  const recovered = await loadGuide(api, 0, clock, scope, undefined, undefined, ['one', 'two'], { from: 720, to: 900 });
  expect(requests).toBeGreaterThan(initialRequests);
  expect(recovered.channels[1]).toMatchObject({ listingsLoaded: true, listingsUnavailable: false, listed: false });
  expect(recovered.retryAt).toBeUndefined();
});

test('overlapping in-flight bulk reads fetch each channel once per window', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests: GuideWindowRequest[] = [];
  const api: GuideApi = {
    channels: async () => ({ items: ['one', 'two'].map(id => ({ id, name: id, number: id, kind: 'tv', artwork: [], favorite: false })), continuation: 'exhausted' }),
    guide: async () => { throw new Error('Unexpected page read'); },
    guideWindow: async q => { requests.push(q); await gate; return answer(q); },
  };
  const first = loadGuide(api, 0, NOW, 'bulk-in-flight', undefined, undefined, ['one'], { from: 720, to: 900 });
  const second = loadGuide(api, 0, NOW, 'bulk-in-flight', undefined, undefined, ['one', 'two'], { from: 720, to: 900 });
  await Bun.sleep(1); release();
  await Promise.all([first, second]);
  const keys = requests.flatMap(q => q.channelIds.map(id => `${q.from}|${q.until}|${id}`));
  expect(new Set(keys).size).toBe(keys.length);
});

test('a retryable outage retains previous programme geometry until fresh data arrives', async () => {
  let failed = false;
  const programme: Programme = { id: 'known', channelId: 'one', name: 'Known programme', summary: '', artwork: [], start: new Date(NOW - 30 * MINUTE).toISOString(), end: new Date(NOW + 90 * MINUTE).toISOString() };
  const api: GuideApi = {
    channels: async () => ({ items: [{ id: 'one', name: 'One', number: '1', kind: 'tv', artwork: [], favorite: false }], continuation: 'exhausted' }),
    guide: async () => { throw new Error('Unexpected page read'); },
    guideWindow: async q => ({ ...answer(q, failed ? ['one'] : [], NOW + (failed ? 2 : 1) * MINUTE), channels: [{ channelId: 'one', state: failed ? 'unavailable' : 'ready', programmes: failed ? [] : [programme] }] }),
  };
  const first = await loadGuide(api, 0, NOW, 'bulk-stale', undefined, undefined, ['one'], { from: 720, to: 900 });
  failed = true;
  const unavailable = await loadGuide(api, 0, NOW + MINUTE + 1, 'bulk-stale', undefined, undefined, ['one'], { from: 720, to: 900 }, { revalidate: {} });
  expect(unavailable.channels[0]).toMatchObject({ listingsLoaded: false, listingsUnavailable: true });
  expect(unavailable.channels[0]?.programmes.map(p => [p.id, p.at, p.span])).toEqual(first.channels[0]?.programmes.map(p => [p.id, p.at, p.span]));
});


test('scrolling keeps completed rows without fetching them again or crossing a revalidation', async () => {
  const channels: Channel[] = ['one', 'two', 'three'].map(id => ({ id, name: id, number: id, kind: 'tv', artwork: [], favorite: false }));
  const requests: string[][] = [];
  const api: GuideApi = {
    channels: async () => ({ items: channels, continuation: 'exhausted' }),
    guide: async () => { throw new Error('Bulk only'); },
    guideWindow: async q => {
      requests.push(q.channelIds);
      return { ...answer(q), channels: q.channelIds.map(channelId => ({ channelId, state: 'ready', programmes: [{
        id: channelId, channelId, name: channelId, summary: '', artwork: [], start: new Date(NOW).toISOString(), end: new Date(NOW + 60 * MINUTE).toISOString(),
      }] })) };
    },
  };
  const scope = 'bulk-retained-scroll';
  const first = await loadGuide(api, 0, NOW, scope, undefined, undefined, ['one'], { from: 720, to: 900 });
  const next = await loadGuide(api, 0, NOW, scope, undefined, undefined, ['two'], { from: 720, to: 900 });
  expect(next.channels[0]?.listingsLoaded).toBe(true);
  expect(next.channels[0]?.programmes).toEqual(first.channels[0]?.programmes);
  expect(next.channels[1]?.listingsLoaded).toBe(true);
  const before = requests.length;
  await loadGuide(api, 0, NOW, scope, undefined, undefined, ['one'], { from: 720, to: 900 });
  expect(requests).toHaveLength(before);
  const refreshed = await loadGuide(api, 0, NOW, scope, undefined, undefined, ['three'], { from: 720, to: 900 }, { revalidate: {} });
  expect(refreshed.channels[0]?.listingsLoaded).toBe(false);
  expect(refreshed.channels[0]?.programmes).toEqual([]);
});

test('archive depth on the bulk row exposes distinct id-less listings as explicit ranges', async () => {
  const iso = (minutes: number) => new Date(NOW + minutes * MINUTE).toISOString();
  const programmes: Programme[] = [-60, -30].map(offset => ({
    id: '', channelId: 'archive', name: String(offset), summary: '', artwork: [], start: iso(offset), end: iso(offset + 20),
  }));
  const api: GuideApi = {
    channels: async () => ({
      items: [{ id: 'archive', name: 'Archive', number: '1', kind: 'tv', artwork: [], favorite: false }],
      continuation: 'exhausted',
    }),
    guide: async () => { throw new Error('Expected the bulk guide'); },
    guideWindow: async q => ({ ...answer(q), channels: [{ channelId: 'archive', state: 'ready', archiveDays: 2, programmes }] }),
  };
  const guide = await loadGuide(api, 0, NOW, 'bulk-id-less-archive', undefined, undefined, ['archive'],
    { from: 660, to: 840 }, { archive: true, archiveDays: 2 });
  const cells = guide.channels[0]!.programmes;
  expect(new Set(cells.map(cell => cell.id)).size).toBe(2);
  expect(cells.map(cell => [cell.replay, cell.archiveRange])).toEqual([
    ['catchUp', { startAt: iso(-60), durationSeconds: 1200 }],
    ['catchUp', { startAt: iso(-30), durationSeconds: 1200 }],
  ]);
});

test('a programme hand-off loads the initial lineup alongside the pinned channel', async () => {
  const channels: Channel[] = Array.from({ length: 34 }, (_, index) => ({
    id: String(index), name: String(index), number: String(index), kind: 'tv', artwork: [], favorite: false,
  }));
  const api: GuideApi = {
    channels: async () => ({ items: channels, continuation: 'exhausted' }),
    guide: async () => { throw new Error('Expected bulk guide'); },
    guideWindow: async q => ({ ...answer(q), channels: q.channelIds.map(channelId => ({
      channelId, state: 'ready', programmes: [{
        id: channelId, channelId, name: channelId, summary: '', artwork: [],
        start: query.from, end: query.until,
      }],
    })) }),
  };
  const guide = await loadGuide(api, 0, NOW, 'guide-handoff-lineup', undefined, undefined, ['33'],
    { from: 720, to: 900 }, { initialLineup: true });
  expect(guide.channels[2]?.programmes.map(p => p.id)).toEqual(['2']);
  expect(guide.channels[33]?.programmes.map(p => p.id)).toEqual(['33']);
  expect(guide.channels[32]?.listingsLoaded).toBe(false);
});
