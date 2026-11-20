import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { hasViewerPlaylists } from '../src/adapter/capabilities';
import { Playlists, initialPlaylists } from '../src/store/playlists';
import { ready, StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);

test('Ether maps every viewer playlist route and preserves entry identities', async () => {
  const routes = {
    'GET /vela/v0/playlists': { items: [{ id: 'p1', kind: 'playlist', name: 'One', artwork: [], itemCount: 1, smart: false, updatedAt: '2026-01-01T00:00:00Z' }], continuation: 'exhausted' },
    'GET /vela/v0/playlists/p1': { collection: { id: 'p1', kind: 'playlist', name: 'One', artwork: [], smart: false, entryCount: 1, updatedAt: '2026-01-01T00:00:00Z' }, items: [{ id: 't1', entryId: 'e1', kind: 'title', receiptToken: '', title: { id: 't1', kind: 'movie', name: 'Title', summary: '', genres: [], artwork: [] } }], continuation: 'exhausted' },
    'POST /vela/v0/playlists': { id: 'p2', kind: 'playlist', name: 'Two', artwork: [], itemCount: 1, smart: false, updatedAt: '2026-01-01T00:00:00Z' },
    'PATCH /vela/v0/playlists/p1': { id: 'p1', kind: 'playlist', name: 'Renamed', artwork: [], itemCount: 1, smart: false, updatedAt: '2026-01-01T00:00:00Z' },
    'DELETE /vela/v0/playlists/p1': { accepted: true },
    'POST /vela/v0/playlists/p1/entries': { entryCount: 2 },
    'DELETE /vela/v0/playlists/p1/entries/e1': { accepted: true },
    'POST /vela/v0/playlists/p1/entries/e1/move': { accepted: true },
    'GET /vela/v0/titles/t1/playlists': { items: [{ id: 'p1', name: 'One', smart: false, entryIds: ['e1'] }] },
  };
  const seen = routeFetch(routes);
  const adapter = new EtherAdapter('https://ether.test', new FakeCredentials(), 'test');
  expect(hasViewerPlaylists(adapter)).toBe(true);
  expect((await adapter.playlist('p1')).items[0]?.entryId).toBe('e1');
  await adapter.playlists();
  await adapter.createPlaylist({ idempotencyKey: '1', name: 'Two', titleIds: ['t1'] });
  await adapter.renamePlaylist('p1', { idempotencyKey: '2', name: 'Renamed' });
  await adapter.addPlaylistEntries('p1', { idempotencyKey: '3', titleIds: ['t1'] });
  await adapter.removePlaylistEntry('p1', 'e1', { idempotencyKey: '4' });
  await adapter.movePlaylistEntry('p1', 'e1', { idempotencyKey: '5', afterEntryId: null });
  await adapter.titlePlaylists('t1');
  await adapter.deletePlaylist('p1', { idempotencyKey: '6' });
  expect(seen.map(call => [call.method, call.url.pathname])).toContainEqual(['PATCH', '/vela/v0/playlists/p1']);
  expect(seen.find(call => call.url.pathname.endsWith('/move'))?.body).toEqual({ idempotencyKey: '5', afterEntryId: null });
});

function storeHarness(adapter: Record<string, unknown>) {
  let keys = 0;
  const session = { features: { playlists: { available: true, maxEntries: 5000 } }, selected: () => ({ adapter }), ready: async () => ({ adapter }), key: () => `key-${++keys}`, onReset: () => {}, epoch: 1 };
  const box = new StateBox({ playlists: initialPlaylists, collections: {} } as VelaState);
  return { box, playlists: new Playlists(box, session as never, () => 320) };
}

test('unticking optimistically removes every matching entry id and restores it with a message on failure', async () => {
  const removed: string[] = [];
  const adapter = { playlists() {}, playlist() {}, createPlaylist() {}, renamePlaylist() {}, deletePlaylist() {}, addPlaylistEntries() {}, movePlaylistEntry() {}, titlePlaylists() {},
    removePlaylistEntry: async (_playlist: string, entryId: string) => { removed.push(entryId); if (entryId === 'e2') throw Object.assign(new Error('read only'), { detail: { code: 'playlist_read_only' } }); } };
  const { box, playlists } = storeHarness(adapter);
  box.update('playlists', state => ({ ...state, memberships: { title: ready([{ id: 'playlist', name: 'List', smart: false, entryIds: ['e1', 'e2'] }]) } }));
  const changing = playlists.setMembership('title', 'playlist', false);
  expect(box.get().playlists.memberships.title?.value?.[0]?.entryIds).toEqual([]);
  await changing;
  expect(removed.sort()).toEqual(['e1', 'e2']);
  expect(box.get().playlists.memberships.title?.value?.[0]?.entryIds).toEqual(['e1', 'e2']);
  expect(box.get().playlists.notice).toContain('Smart playlists');
});

test('ticking optimistically checks a playlist and reverts when adding fails', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
  const adapter = { playlists() {}, playlist() {}, createPlaylist() {}, renamePlaylist() {}, deletePlaylist() {}, removePlaylistEntry() {}, movePlaylistEntry() {}, titlePlaylists() {},
    addPlaylistEntries: async () => pending };
  const { box, playlists } = storeHarness(adapter);
  box.update('playlists', state => ({ ...state, memberships: { title: ready([{ id: 'playlist', name: 'List', smart: false, entryIds: [] }]) } }));
  const changing = playlists.setMembership('title', 'playlist', true);
  expect(box.get().playlists.memberships.title?.value?.[0]?.entryIds[0]).toStartWith('optimistic:');
  reject(new Error('offline'));
  await changing;
  expect(box.get().playlists.memberships.title?.value?.[0]?.entryIds).toEqual([]);
  expect(box.get().playlists.notice).toContain('restored');
});

test('entry reorder is optimistic and reverts when the server rejects it', async () => {
  const adapter = { playlists() {}, playlist() {}, createPlaylist() {}, renamePlaylist() {}, deletePlaylist() {}, addPlaylistEntries() {}, removePlaylistEntry() {}, titlePlaylists() {}, movePlaylistEntry: async () => { throw new Error('offline'); } };
  const { box, playlists } = storeHarness(adapter);
  const card = (id: string) => ({ id, entryId: id, kind: 'movie', name: id, summary: '', airDate: '', year: 0, rating: '', durationSeconds: 0, progressSeconds: 0, played: false, showId: '', showName: '', episodeContext: '', contextParts: [], seasonId: '', seasonNumber: 0, episodeNumber: 0, genres: [], durationLabel: '', yearLabel: '', progressLabel: '', seasonNumberLabel: '', episodeNumberLabel: '', facts: '', poster: '', backdrop: '', logo: '', accent: '', receipt: '' });
  box.update('collections', () => ({ playlist: ready({ id: 'playlist', kind: 'playlist', name: 'List', items: [card('a'), card('b'), card('c')], more: false, complete: true }) }));
  const moving = playlists.moveEntry('playlist', 'c', null);
  expect(box.get().collections.playlist?.value?.items.map(item => item.entryId)).toEqual(['c', 'a', 'b']);
  await moving;
  expect(box.get().collections.playlist?.value?.items.map(item => item.entryId)).toEqual(['a', 'b', 'c']);
  expect(box.get().playlists.notice).toContain('restored');
});
