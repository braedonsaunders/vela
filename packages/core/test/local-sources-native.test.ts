// Vela's own sources on Jellyfin and Plex, over routed fetch: what each server answers part by part
// and what reads `unsupported`, as today's music app shows on them (docs/experiences.md: Sources).
import { afterEach, describe, expect, test } from 'bun:test';
import { createVela, type Vela } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import type { ScreenDocument, SourceSpec } from '../src/wire';
import type { Item } from '../src/adapter/jellyfin/types';
import { MemoryStore, restoreFetch, tokens, type Seen } from './helpers';

afterEach(restoreFetch);

type Route = unknown | ((request: Seen) => unknown);

/** Routed fetch where an unknown read is an empty answer of the server's list shape (not a failure). */
function serve(routes: Record<string, Route>, empty: unknown): Seen[] {
  const seen: Seen[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const request: Seen = { method, url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? safeJSON(init.body) : undefined };
    seen.push(request);
    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) return method === 'GET' ? Response.json(empty) : new Response(null, { status: 204 });
    const answer = typeof route === 'function' ? (route as (r: Seen) => unknown)(request) : route;
    return answer instanceof Response ? answer : Response.json(answer);
  };
  globalThis.fetch = Object.assign(fake, { preconnect: () => {} }) as typeof fetch;
  return seen;
}
const safeJSON = (text: string) => { try { return JSON.parse(text); } catch { return text; } };

const SERVER = '00000000-0000-4000-8000-000000000001';

function storeFor(kind: 'jellyfin' | 'plex', origin: string, basePath: string): Vela {
  const secrets = new MemoryStore();
  secrets.set('vela.servers', JSON.stringify({ selectedId: SERVER, servers: [{ id: SERVER, name: 'Home', kind, origin, basePath }] }));
  secrets.set('vela.server-sessions', JSON.stringify({ [SERVER]: tokens('token-1', 'viewer-1') }));
  return createVela({ secrets, device: { name: 'Browser', platform: 'web' }, appVersion: '0.2.9', rendererVersion: 20,
    media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: { native: false, fmp4: false, mpegTs: false }, mse: false } as never,
    artWidth: 640 } as VelaPlatform & { rendererVersion: number });
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await Bun.sleep(10);
  }
}

/** Open a built-in page reading `sources` and wait for every answer. */
async function read(store: Vela, sources: Record<string, SourceSpec>) {
  const doc: ScreenDocument = { schema: 1, kind: 'screen', renderer: 20, screen: 'listen', page: 'probe', version: '1', title: 'Probe', presentation: 'page', sources, tree: { type: 'box' } as never };
  store.screens.provideDocuments(href => (href === 'vela:listen/probe' ? doc : undefined));
  const handle = store.screens.open({ target: { kind: 'screen', id: 'vela.listen', page: 'probe' }, href: 'vela:listen/probe' });
  const page = () => store.getState().screens.pages[handle.key]!;
  await until(() => page()?.load === 'ready' && Object.keys(page().pending).length === 0 && Object.keys(sources).every(name => name in page().sources || name in page().errors));
  const result = { sources: page().sources, errors: page().errors, record: (key: string) => store.screens.records.get(key)?.value };
  handle.release();
  return result;
}

const EVERY: Record<string, SourceSpec> = {
  title: { from: 'vela.title', id: 'al1' },
  children: { from: 'vela.children', id: 'al1', role: 'track' },
  rows: { from: 'vela.rows', placement: 'library', libraryId: 'mu' },
  library: { from: 'vela.library', id: 'mu', tab: 'albums' },
  favorites: { from: 'vela.favorites', role: 'track', library: 'mu' },
  playlists: { from: 'vela.playlists' },
  recent: { from: 'vela.recent' },
  search: { from: 'vela.search', q: 'Northern', library: 'mu' },
  lyrics: { from: 'vela.lyrics', id: 't1' },
  recap: { from: 'vela.recap', period: 'week' },
  duplicates: { from: 'vela.duplicates', libraryId: 'mu' },
  recording: { from: 'vela.recording', id: 't1' },
  musicHome: { from: 'vela.musicHome', library: 'mu' },
  info: { from: 'vela.libraryInfo', id: 'mu' },
  viewer: { from: 'vela.viewer' },
  queue: { from: 'vela.queue' },
  now: { from: 'vela.nowPlaying' },
  guide: { from: 'vela.guide', day: '0' },
  reading: { from: 'vela.readingProgress', id: 'al1' },
  visualizer: { from: 'vela.visualizer' },
};

describe('Jellyfin', () => {
  const ORIGIN = 'https://media.example';
  const album: Item = { Id: 'al1', Name: 'Northern Static', Type: 'MusicAlbum', ProductionYear: 2019, ChildCount: 2, ParentId: 'ar1',
    AlbumArtist: 'Aurora Lines', AlbumArtists: [{ Id: 'ar1', Name: 'Aurora Lines' }], ImageTags: { Primary: 'c1' } };
  const track = (n: number, favorite = false): Item => ({ Id: `t${n}`, Name: `Song ${n}`, Type: 'Audio', MediaType: 'Audio', IndexNumber: n, RunTimeTicks: 250_000_000,
    Album: 'Northern Static', AlbumId: 'al1', AlbumArtists: [{ Id: 'ar1', Name: 'Aurora Lines' }], ArtistItems: [{ Id: 'ar1', Name: 'Aurora Lines' }], ParentId: 'al1', UserData: { IsFavorite: favorite } });
  const music = { Id: 'mu', Name: 'Music', CollectionType: 'music' };
  const routes: Record<string, Route> = {
    'GET /jf/System/Info/Public': { Id: 'srv', ServerName: 'Home', Version: '10.10.0', ProductName: 'Jellyfin Server' },
    'GET /jf/System/Info': { Id: 'srv', ServerName: 'Home', Version: '10.10.0' },
    'GET /jf/Users/Me': { Id: 'viewer-1', Name: 'Viewer', Policy: {} },
    'GET /jf/Users/viewer-1/Views': { Items: [music] },
    'GET /jf/Users/viewer-1/Items/mu': music,
    'GET /jf/Users/viewer-1/Items/al1': album,
    'GET /jf/Users/viewer-1/Items': (r: Seen) => {
      const p = r.url.searchParams;
      if (p.get('ParentId') === 'al1') return { Items: [track(1), track(2)], TotalRecordCount: 2 };
      if (p.get('IncludeItemTypes') === 'Audio' && p.get('IsFavorite') === 'true') return { Items: [track(2, true)], TotalRecordCount: 1 };
      if (p.get('SearchTerm')) return { Items: [album, track(1)], TotalRecordCount: 2 };
      if (p.get('IncludeItemTypes') === 'MusicAlbum') return { Items: [album], TotalRecordCount: 1 };
      return { Items: [], TotalRecordCount: 0 };
    },
  };

  test('answers titles, children, rows, library, search and favorites; the rest reads unsupported', async () => {
    const seen = serve(routes, { Items: [], TotalRecordCount: 0 });
    const store = storeFor('jellyfin', ORIGIN, '/jf');
    await store.auth.start();
    const { sources, errors, record } = await read(store, EVERY);
    // No tuner, an album is not readable, and the app's visualizer setting is not wired in a bare store.
    expect(Object.keys(errors).sort()).toEqual(['duplicates', 'guide', 'lyrics', 'playlists', 'reading', 'recap', 'recent', 'recording', 'visualizer'].sort());
    for (const name of Object.keys(errors)) expect(errors[name]).toBe('unsupported');
    expect((record('item:al1') as { name: string }).name).toBe('Northern Static');
    expect((sources.children as { items: unknown[] }).items).toEqual([{ $record: 'item:t1' }, { $record: 'item:t2' }]);
    expect((sources.favorites as { items: unknown[] }).items).toEqual([{ $record: 'item:t2' }]);
    expect(sources.info).toMatchObject({ media: 'music', listening: 'music', features: { likedByRole: false, playlists: false, lyrics: false, recap: false } });
    expect((sources.search as { top: unknown }).top).toEqual({ $record: 'item:al1' });
    expect(sources.musicHome).toMatchObject({ quick: [], recent: [] });
    // Liking is the server's own favourite; playing an album queues its tracks.
    const { key } = store.screens.open({ target: { kind: 'screen', id: 'vela.listen', page: 'probe' }, href: 'vela:listen/probe' });
    await until(() => store.getState().screens.pages[key]?.load === 'ready' && !Object.keys(store.getState().screens.pages[key]!.pending).length);
    await store.screens.action(key, { name: 'vela.like', args: { item: 'item:t1', on: true } });
    expect(seen.some(r => r.method === 'POST' && r.url.pathname === '/jf/Users/viewer-1/FavoriteItems/t1')).toBe(true);
    await store.screens.action(key, { name: 'vela.play', args: { item: 'item:al1' } });
    expect(store.getState().audio.queue?.items.map(card => card.id)).toEqual(['t1', 't2']);
    await store.audio.stop();
  });
});

describe('Plex', () => {
  const ORIGIN = 'https://plex.example:32400';
  const sections = { MediaContainer: { Directory: [{ key: 2, type: 'artist', title: 'Music' }] } };
  const album = { ratingKey: '8', type: 'album', title: 'Northern Static', parentRatingKey: '7', parentTitle: 'Aurora Lines', year: 2019, leafCount: 2, thumb: '/library/metadata/8/thumb/1', librarySectionID: 2 };
  const track = (n: number) => ({ ratingKey: `${8 + n}`, type: 'track', title: `Song ${n}`, index: n, parentIndex: 1, parentRatingKey: '8', grandparentRatingKey: '7', parentTitle: 'Northern Static', grandparentTitle: 'Aurora Lines', duration: 25051 });
  const routes: Record<string, Route> = {
    'GET /identity': { MediaContainer: { machineIdentifier: 'plex-1', version: '1.43.5' } },
    'GET /': { MediaContainer: { friendlyName: 'Home' } },
    'GET /library/sections': sections,
    'GET /library/sections/2/all': { MediaContainer: { Metadata: [album], totalSize: 1, librarySectionID: 2 } },
    'GET /library/metadata/8': { MediaContainer: { librarySectionID: 2, Metadata: [album] } },
    'GET /library/metadata/8/children': { MediaContainer: { librarySectionID: 2, totalSize: 2, Metadata: [track(1), track(2)] } },
    'GET /hubs/search': { MediaContainer: { Hub: [{ type: 'album', Metadata: [album] }] } },
  };

  test('answers titles, children, rows, library and search; likes, lists and the music extras read unsupported', async () => {
    const seen = serve(routes, { MediaContainer: {} });
    const store = storeFor('plex', ORIGIN, '/');
    await store.auth.start();
    const { sources, errors, record } = await read(store, { ...EVERY, title: { from: 'vela.title', id: '8' }, children: { from: 'vela.children', id: '8', role: 'track' },
      rows: { from: 'vela.rows', placement: 'library', libraryId: '2' }, library: { from: 'vela.library', id: '2' }, favorites: { from: 'vela.favorites', role: 'track', library: '2' },
      search: { from: 'vela.search', q: 'Northern', library: '2' }, musicHome: { from: 'vela.musicHome', library: '2' }, info: { from: 'vela.libraryInfo', id: '2' }, reading: { from: 'vela.readingProgress', id: '8' } });
    expect(Object.keys(errors).sort()).toEqual(['duplicates', 'favorites', 'guide', 'lyrics', 'playlists', 'reading', 'recap', 'recent', 'recording', 'visualizer'].sort());
    for (const name of Object.keys(errors)) expect(errors[name]).toBe('unsupported');
    expect((record('item:8') as { name: string }).name).toBe('Northern Static');
    expect((sources.children as { items: unknown[] }).items).toEqual([{ $record: 'item:9' }, { $record: 'item:10' }]);
    expect(sources.info).toMatchObject({ media: 'music', listening: 'music', features: { likedByRole: false, playlists: false } });
    // Plex keeps no favourites: a like is refused; playing an album queues its tracks.
    const { key } = store.screens.open({ target: { kind: 'screen', id: 'vela.listen', page: 'probe' }, href: 'vela:listen/probe' });
    await until(() => store.getState().screens.pages[key]?.load === 'ready' && !Object.keys(store.getState().screens.pages[key]!.pending).length);
    await expect(store.screens.action(key, { name: 'vela.like', args: { item: 'item:9', on: true } })).rejects.toThrow();
    await store.screens.action(key, { name: 'vela.play', args: { item: 'item:8' } });
    expect(store.getState().audio.queue?.items.map(card => card.id)).toEqual(['9', '10']);
    await store.audio.stop();
    expect(seen.some(r => r.url.pathname.includes('/screens/'))).toBe(false);
  });
});
