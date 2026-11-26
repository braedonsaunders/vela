// The Listen parity knobs (tools/parity/listen-mock.ts): liked titles served as Ether's liked lists,
// timed lyrics, a music playlist and pinned playlist dates, so every capture set reads the same state.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { launchMock, type RunningMock } from './launch';

const NOW = '2026-11-24T20:00:00.000Z';
const device: V.Device = { id: 'listen-parity-device', name: 'Test', platform: 'web', appVersion: '0.2.0' };
let mock: RunningMock;
let tokens: V.Tokens;

beforeAll(async () => {
  mock = await launchMock({
    VELA_MOCK_NOW: NOW, VELA_MOCK_FAVORITES_LIST: '1', VELA_MOCK_LYRICS: '1',
    VELA_MOCK_LIKED: 'track-paper-boats-1-01,album-glasshouse-weather,artist-mira-solenne',
    VELA_MOCK_PLAYLIST_TRACKS: 'track-neon-orchard-1-02,track-late-tram-home-1-01',
  });
  const response = await fetch(`${mock.url}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'vela', device, idempotencyKey: 'listen-parity-sign-in' }) });
  tokens = await response.json() as V.Tokens;
});
afterAll(async () => { await mock?.stop(); });

const get = (path: string) => fetch(`${mock.url}/vela/v0${path}`, { headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id } });

describe('mock server: Listen parity knobs', () => {
  test('liked titles are listed by role, and the feature is advertised', async () => {
    const boot = await (await get('/bootstrap')).json() as V.Bootstrap;
    expect(boot.capabilities.features.favoritesList?.available).toBe(true);
    expect(boot.capabilities.features.lyrics?.available).toBe(true);
    const tracks = await (await get('/favorites/titles?role=track')).json() as V.FavoriteTitlesPage;
    expect(tracks.items.map(item => item.id)).toEqual(['track-paper-boats-1-01']);
    expect(tracks.total).toBe(1);
    expect(tracks.items[0]!.likedAt).toBe(NOW);
    const albums = await (await get('/favorites/titles?role=album')).json() as V.FavoriteTitlesPage;
    expect(albums.items.map(item => item.id)).toEqual(['album-glasshouse-weather']);
  });

  test('a track has timed lyrics, a line every five seconds, the same on every read', async () => {
    const first = await (await get('/titles/track-paper-boats-1-03/lyrics')).json() as V.TitleLyrics;
    expect(first.instrumental).toBe(false);
    expect(first.lines.length).toBeGreaterThan(3);
    expect(first.lines.slice(0, 3).map(line => line.startMs)).toEqual([0, 5000, 10000]);
    const again = await (await get('/titles/track-paper-boats-1-03/lyrics')).json() as V.TitleLyrics;
    expect(again).toEqual(first);
    expect((await get('/titles/album-paper-boats/lyrics')).status).toBe(404);
  });

  test('the music playlist holds the listed tracks in order, dated at the pinned instant', async () => {
    const list = await (await get('/playlists/playlist-evening-drive')).json() as V.CollectionContents;
    expect(list.items.map(item => item.kind === 'title' ? item.title.id : '')).toEqual(['track-neon-orchard-1-02', 'track-late-tram-home-1-01']);
    const playlists = await (await get('/playlists')).json() as { items: { id: string; updatedAt: string }[] };
    expect(playlists.items.find(p => p.id === 'playlist-evening-drive')?.updatedAt).toBe(NOW);
    expect(playlists.items.every(p => p.updatedAt === NOW)).toBe(true);
  });
});
