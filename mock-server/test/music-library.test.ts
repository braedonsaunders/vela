import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { launchMock, type RunningMock } from './launch';

const device: V.Device = { id: 'music-lib-test-device', name: 'Test', platform: 'web', appVersion: '0.1.0' };
let mock: RunningMock;
let tokens: V.Tokens;
let keys = 0;
const key = () => `mlib-${++keys}`;

beforeAll(async () => {
  mock = await launchMock();
  const res = await post('/auth/sign-in', { username: 'demo', password: 'vela', device, idempotencyKey: key() }, {});
  tokens = (await res.json()) as V.Tokens;
});

afterAll(async () => {
  await mock?.stop();
});

const headers = () => ({ Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id });

function post(path: string, body: object, extra: Record<string, string> = headers()) {
  return fetch(`${mock.url}/vela/v0${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${mock.url}/vela/v0${path}`, { headers: headers() });
  expect(response.status).toBe(200);
  return response.json() as Promise<T>;
}

describe('B6 Rewind, B7 Playlist Import, B8b Duplicates mock server routes', () => {
  test('capabilities advertise historyRecap, playlistImport, and duplicates', async () => {
    const caps = await get<V.ServerCapabilities>('/capabilities');
    expect(caps.features.historyRecap).toEqual({
      available: true,
      periods: ['week', 'month', 'year', 'all'],
    });
    expect(caps.features.playlistImport).toEqual({
      available: true,
      links: ['deezer', 'spotify'],
      files: ['m3u', 'csv'],
      maxTracks: 500,
    });
    expect(caps.features.duplicates).toEqual({ available: true });
  });

  test('B6 GET /history/recap returns period recap for music, audiobooks, podcasts, and empty dates', async () => {
    const month = await get<V.HistoryRecap>('/history/recap?period=month&library=music');
    expect(month.period).toBe('month');
    expect(month.minutes).toBeGreaterThan(0);
    expect(month.plays).toBeGreaterThan(0);
    expect(month.topArtists.length).toBeGreaterThan(0);
    expect(month.topTracks.length).toBeGreaterThan(0);
    expect(month.topAlbums.length).toBeGreaterThan(0);
    expect(month.byDay).toHaveLength(30);
    expect(month.streak.longest).toBeGreaterThanOrEqual(month.streak.current);

    const year = await get<V.HistoryRecap>('/history/recap?period=year&library=music');
    expect(year.byDay).toHaveLength(365);

    const audiobooks = await get<V.HistoryRecap>('/history/recap?period=month&library=audiobooks');
    expect(audiobooks.plays).toBeGreaterThan(0);
    expect(audiobooks.topAlbums[0]?.title.media?.role).toBe('audiobook');

    const podcasts = await get<V.HistoryRecap>('/history/recap?period=month&library=podcasts');
    expect(podcasts.plays).toBeGreaterThan(0);
    expect(podcasts.topAlbums[0]?.title.media?.role).toBe('show');

    // Empty period before any plays returns zeros and empty lists, never 404.
    const empty = await get<V.HistoryRecap>('/history/recap?period=week&at=1999-01-01&library=music');
    expect(empty.plays).toBe(0);
    expect(empty.minutes).toBe(0);
    expect(empty.topArtists).toEqual([]);
    expect(empty.topTracks).toEqual([]);
    expect(empty.topAlbums).toEqual([]);
    expect(empty.byDay).toHaveLength(7);
  });

  test('B7 playlist import handles Spotify/Deezer links, M3U/CSV files, bad links, and playlist saving', async () => {
    const badRes = await post('/playlists/import', {
      idempotencyKey: key(),
      library: 'music',
      url: 'https://music.apple.com/us/playlist/unsupported',
    });
    expect(badRes.status).toBe(400);
    const badErr = (await badRes.json()) as V.ErrorResponse;
    expect(badErr.error.code).toBe('unsupported_link');

    const startRes = await post('/playlists/import', {
      idempotencyKey: key(),
      library: 'music',
      url: 'https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk',
    });
    expect(startRes.status).toBe(202);
    const { id } = (await startRes.json()) as V.PlaylistImportJobRef;
    expect(id).toBeTruthy();

    let job = await get<V.PlaylistImport>(`/playlists/import/${id}`);
    for (let i = 0; i < 4 && job.state !== 'done'; i++) {
      job = await get<V.PlaylistImport>(`/playlists/import/${id}`);
    }
    expect(job.state).toBe('done');
    expect(job.matched.length).toBeGreaterThan(0);
    expect(job.unmatched.length).toBeGreaterThan(0);
    expect(job.matched.some(m => m.by === 'isrc')).toBe(true);
    expect(job.unmatched.some(u => u.reason === 'ambiguous' || u.reason === 'not_found')).toBe(true);

    const excludedIdx = job.matched[0]!.index;
    const saveRes = await post(`/playlists/import/${id}/save`, {
      idempotencyKey: key(),
      name: 'Imported Driftwood Mix',
      exclude: [excludedIdx],
    });
    expect(saveRes.status).toBe(200);
    const created = (await saveRes.json()) as V.PlaylistCard;
    expect(created.name).toBe('Imported Driftwood Mix');
    expect(created.itemCount).toBe(job.matched.length - 1);

    // M3U file import
    const m3uStart = await post('/playlists/import', {
      idempotencyKey: key(),
      library: 'music',
      file: {
        name: 'harbour.m3u',
        format: 'm3u',
        text: '#EXTM3U\n#EXTINF:228,The Hollow Lanterns - Paper Boats\nPaper Boats.flac\n#EXTINF:200,Unknown Artist - Missing Song\nMissing.flac',
      },
    });
    expect(m3uStart.status).toBe(202);
    const m3uRef = (await m3uStart.json()) as V.PlaylistImportJobRef;
    let m3uJob = await get<V.PlaylistImport>(`/playlists/import/${m3uRef.id}`);
    while (m3uJob.state !== 'done') {
      m3uJob = await get<V.PlaylistImport>(`/playlists/import/${m3uRef.id}`);
    }
    expect(m3uJob.matched).toHaveLength(1);
    expect(m3uJob.unmatched).toHaveLength(1);
    expect(m3uJob.unmatched[0]?.reason).toBe('not_found');
  });

  test('B8b duplicates lists recording groups, returns title recording releases, and persists preferred release + hides others', async () => {
    const page = await get<V.DuplicateGroupsPage>('/libraries/music/duplicates');
    expect(page.items.length).toBeGreaterThanOrEqual(6);
    // Ordered most copies first (3 copies before 2 copies)
    expect(page.items[0]!.count).toBeGreaterThanOrEqual(page.items.at(-1)!.count);

    const group = page.items.find(g => g.recordingId === 'US-DRW-19-00101')!;
    expect(group).toBeDefined();
    expect(group.count).toBe(3);
    expect(group.titles.every(t => t.media?.recordingId === 'US-DRW-19-00101')).toBe(true);

    const rec = await get<V.RecordingReleases>('/titles/track-paper-boats-1-01/recording');
    expect(rec.recordingId).toBe('US-DRW-19-00101');
    expect(rec.titles).toHaveLength(3);

    const preferId = 'track-harbour-sessions-deluxe-1-01';
    const hideId = 'track-coastal-anthology-1-01';
    const prefRes = await post('/libraries/music/duplicates/US-DRW-19-00101', {
      idempotencyKey: key(),
      preferredTitleId: preferId,
      hideOtherIds: [hideId],
    });
    expect(prefRes.status).toBe(200);
    const updated = (await prefRes.json()) as V.DuplicateGroup;
    expect(updated.preferredTitleId).toBe(preferId);
    expect(updated.titles.some(t => t.id === hideId)).toBe(true);

    // Recording endpoint reflects updated preferredTitleId
    const recAfter = await get<V.RecordingReleases>('/titles/track-paper-boats-1-01/recording');
    expect(recAfter.preferredTitleId).toBe(preferId);

    // Library track listing excludes hidden duplicate release for this viewer
    const libraryTracks = await get<V.LibraryContents>('/libraries/music/items?tab=tracks&query=Paper%20Boats&limit=50');
    const trackIds = libraryTracks.items.flatMap(i => (i.kind === 'title' ? [i.title.id] : []));
    expect(trackIds).not.toContain(hideId);
    expect(trackIds).toContain(preferId);
    expect(trackIds).toContain('track-paper-boats-1-01');
  });
});
