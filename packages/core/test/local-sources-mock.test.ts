// A built-in page document reading Vela's own sources against the mock, end to end: the album's
// title and tracks, Home's rows, Liked Songs, and the live queue and Now Playing records; vela.play
// moves the live records, vela.like patches the item, release stops following. A built-in page is
// never fetched from or read through Ether.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createVela, type Vela } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import type { ScreenDocument } from '../src/wire';
import { launchMock, type RunningMock } from '../../../mock-server/test/launch';
import { mediaChildren, mediaGroups } from '../../protocol/fixtures/media';
import type { NowPlayingRecord, QueueRecord, TitleValue, ListValue, RowsValue } from '../../protocol/vela-sources';
import { MemoryStore } from './helpers';

let mock: RunningMock;
let store: Vela;
const etherScreenCalls: string[] = [];
const device = { id: 'local-sources-device-123', name: 'Browser', platform: 'web', appVersion: '0.2.9' };

const album = mediaGroups.albums.find(item => mediaChildren(item.id, 'track').length >= 3)!;
const tracks = mediaChildren(album.id, 'track');

const albumPage: ScreenDocument = {
  schema: 1, kind: 'screen', renderer: 19, screen: 'listen', page: 'album', version: '1', title: 'Album', presentation: 'page',
  params: { id: { type: 'string' } },
  sources: {
    album: { from: 'vela.title', id: '{param.id}' },
    tracks: { from: 'vela.children', id: '{param.id}', role: 'track' },
    home: { from: 'vela.rows', placement: 'home' },
    liked: { from: 'vela.favorites', role: 'track' },
    queue: { from: 'vela.queue' },
    now: { from: 'vela.nowPlaying' },
    nothing: { from: 'vela.search', q: 'x', lazy: true },
  },
  tree: { type: 'box' } as never,
};

beforeAll(async () => {
  mock = await launchMock({});
  const realFetch = globalThis.fetch;
  globalThis.fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/screens/') || url.includes('/surfaces/')) etherScreenCalls.push(url);
    return realFetch(input, init);
  }, realFetch);
  const code = (await (await fetch(`${mock.url}/__admin/web-code`, { method: 'POST' })).json()).code as string;
  store = createVela({ etherOrigin: mock.url, secrets: new MemoryStore(), device, appVersion: '0.2.9', rendererVersion: 19,
    media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: { native: false, fmp4: false, mpegTs: false }, mse: false } as never,
    page: { origin: mock.url, webCode: code }, artWidth: 640 } as VelaPlatform & { rendererVersion: number });
  store.screens.provideDocuments(href => (href === 'vela:listen/album' ? albumPage : undefined));
  await store.auth.start();
});
afterAll(async () => { await store?.audio.stop().catch(() => undefined); await mock?.stop(); });

async function until(check: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(20);
  }
}

const target = { kind: 'screen' as const, id: 'vela.listen', page: 'album' };

test('a built-in page reads its vela.* sources through the active server, with live queue records', async () => {
  const handle = store.screens.open({ target, href: 'vela:listen/album', params: { id: album.id } });
  const page = () => store.getState().screens.pages[handle.key]!;
  const record = <T>(key: string) => store.screens.records.get(key)?.value as T;
  await until(() => page()?.load === 'ready' && Object.keys(page().pending).length === 0);
  expect(page().errors).toEqual({});

  const title = page().sources.album as TitleValue;
  expect(title.item).toEqual({ $record: `item:${album.id}` });
  expect(record<{ name: string }>(`item:${album.id}`).name).toBe(album.name);

  const list = page().sources.tracks as ListValue;
  expect(list.items.map(item => item.$record)).toEqual(tracks.map(track => `item:${track.id}`));
  expect(record<{ media: { role: string } }>(list.items[0]!.$record).media.role).toBe('track');

  expect((page().sources.home as RowsValue).rows.length).toBeGreaterThan(0);
  expect(Array.isArray((page().sources.liked as ListValue).items)).toBe(true);
  // The lazy source is not read until asked for.
  expect('nothing' in page().sources).toBe(false);

  expect(page().sources.queue).toEqual({ $record: 'queue:current' });
  expect(record<QueueRecord>('queue:current')).toMatchObject({ at: -1, current: null });
  expect(record<NowPlayingRecord>('nowPlaying:current')).toMatchObject({ item: null, playing: false });
  expect(store.screens.localSources()!.following('vela.queue')).toBe(true);

  // Play the album from its second track: the live records follow the audio store.
  await store.screens.action(handle.key, { name: 'vela.play', args: { context: 'tracks', item: `item:${tracks[1]!.id}` } });
  await until(() => record<QueueRecord>('queue:current')?.current?.$record === `item:${tracks[1]!.id}`);
  expect(record<QueueRecord>('queue:current')).toMatchObject({ at: 1, source: { id: album.id, kind: 'title' } });
  expect(record<NowPlayingRecord>('nowPlaying:current').item).toEqual({ $record: `item:${tracks[1]!.id}` });

  // Queue a track to play next.
  await store.screens.action(handle.key, { name: 'vela.playNext', args: { item: tracks[2]!.id } });
  await until(() => record<QueueRecord>('queue:current')?.queued.length === 1);
  expect(record<QueueRecord>('queue:current').queued).toEqual([{ $record: `item:${tracks[2]!.id}` }]);
  await store.audio.stop();

  // Like a track: its record says so at once, and the page's favorites lists are read again.
  const liked = tracks[0]!.id;
  const answer = await store.screens.action(handle.key, { name: 'vela.like', args: { item: `item:${liked}`, on: true } });
  expect(answer.refresh).toEqual(['liked']);
  expect(record<{ favorite: boolean }>(`item:${liked}`).favorite).toBe(true);
  // The mock has neither role lists nor a Favorites playlist: Liked Songs reads empty, as today's app shows it.
  expect(page().sources.liked).toEqual({ items: [], more: false, total: 0 });
  await store.screens.action(handle.key, { name: 'vela.like', args: { item: `item:${liked}`, on: false } });

  // An unknown action is refused; an unanswered source reads unsupported.
  await expect(store.screens.action(handle.key, { name: 'vela.nope', args: {} })).rejects.toThrow();
  await store.screens.need(handle.key, ['nothing']);
  expect(page().errors.nothing).toBe('unsupported');

  handle.release();
  expect(store.screens.localSources()!.following('vela.queue')).toBe(false);
  expect(store.screens.localSources()!.following('vela.nowPlaying')).toBe(false);
  // Nothing of a built-in page went to Ether's screen routes.
  expect(etherScreenCalls).toEqual([]);
}, 20000);

test('a built-in page this app does not have fails as not found, without asking Ether', async () => {
  const handle = store.screens.open({ target: { kind: 'screen', id: 'vela.listen', page: 'nope' }, href: 'vela:listen/nope' });
  const page = store.getState().screens.pages[handle.key]!;
  expect(page.load).toBe('failed');
  expect(page.failure).toBe('not_found');
  handle.release();
  expect(etherScreenCalls).toEqual([]);
});
