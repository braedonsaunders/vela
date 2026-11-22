import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as V from '../../packages/protocol/types';
import { audiobookFiles, mediaGroups, musicClips, readingSourceFor } from '../../packages/protocol/fixtures/media';
import { crc32, zip } from '../scripts/book-formats';
import { launchMock, type RunningMock } from './launch';

// Placeholder media in a temporary root: the routes and grants are under test, not the generators.
const device: V.Device = { id: 'media-test-device', name: 'Test', platform: 'web', appVersion: '0.1.0' };
const client: V.ClientCapabilities = { device, protocolVersions: [0], containers: ['mp4', 'mp3', 'flac'], videoCodecs: [], audioCodecs: ['aac', 'mp3', 'flac'], subtitleFormats: [], hls: true, mse: true };
let mock: RunningMock, scratch: string, tokens: V.Tokens, keys = 0;
const key = () => `media-${++keys}`;
const epubBytes = zip([{ name: 'mimetype', data: 'application/epub+zip' }, { name: 'META-INF/container.xml', data: '<container/>' }]);

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'vela-media-kinds-'));
  for (const file of [...musicClips.map(clip => clip.file), ...audiobookFiles.map(book => book.file)]) await Bun.write(join(scratch, 'music', file), new Uint8Array(4096).fill(7));
  for (const book of mediaGroups.books) { const source = readingSourceFor(book.id)!; await Bun.write(join(scratch, 'books', source.file), source.format === 'epub' ? epubBytes : new Uint8Array(2048).fill(9)); }
  mock = await launchMock({ VELA_MOCK_MUSIC_ROOT: join(scratch, 'music'), VELA_MOCK_BOOKS_ROOT: join(scratch, 'books') });
  tokens = await (await post('/auth/sign-in', { username: 'demo', password: 'vela', device, idempotencyKey: key() }, {})).json() as V.Tokens;
});
afterAll(async () => { await mock?.stop(); await rm(scratch, { recursive: true, force: true }); });

const headers = () => ({ Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id });
function post(path: string, body: object, extra: Record<string, string> = headers()) {
  return fetch(`${mock.url}/vela/v0${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
}
async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${mock.url}/vela/v0${path}`, { headers: headers() });
  expect(response.status).toBe(200);
  return response.json() as Promise<T>;
}
const titlesOf = (page: V.Page<V.RowEntry>) => page.items.flatMap(item => item.kind === 'title' ? [item.title] : []);

describe('media kinds', () => {
  test('capabilities and libraries carry media classes', async () => {
    const capabilities = await get<V.ServerCapabilities>('/capabilities');
    expect(capabilities.features.mediaClasses).toEqual({ available: true, classes: ['video', 'music', 'book', 'audiobook'] });
    expect(capabilities.features.reading?.formats).toEqual(['epub', 'pdf', 'cbz']);
    expect(capabilities.features.audioPlayback?.available).toBe(true);
    const libraries = (await get<V.Page<V.Library>>('/libraries?limit=100')).items;
    expect(Object.fromEntries(libraries.filter(library => library.media).map(library => [library.id, [library.media, library.presentation?.card]]))).toEqual({
      music: ['music', 'square'], books: ['book', 'poster'], audiobooks: ['audiobook', 'square'] });
    expect(libraries.find(library => library.id === 'music')!.tabs!.filter(tab => tab.level).map(tab => [tab.id, tab.level])).toEqual([['albums', 'album'], ['tracks', 'track']]);
  });

  test('a library lists its root level, and a level tab lists that level', async () => {
    const root = titlesOf(await get('/libraries/music/items'));
    expect(root.map(title => title.media?.role)).toEqual(Array(mediaGroups.artists.length).fill('artist'));
    // Direct children of every level: an artist's albums and its concerts.
    expect(root.every(title => title.media?.childCount === mediaGroups.albums.filter(album => album.showId === title.id).length
      + mediaGroups.concerts.filter(concert => concert.media?.parents?.[0]?.id === title.id).length)).toBe(true);
    const albums = titlesOf(await get('/libraries/music/items?tab=albums&sort=year&direction=desc&limit=100'));
    expect(albums).toHaveLength(mediaGroups.albums.length);
    expect(albums.every(title => title.media?.role === 'album' && title.media.parents?.[0]?.role === 'artist')).toBe(true);
    expect(albums.map(title => title.year)).toEqual(albums.map(title => title.year).sort((a, b) => b! - a!));
    const tracks = await get<V.LibraryContents>('/libraries/music/items?tab=tracks&sort=title&limit=20');
    expect(tracks.continuation).toBe('more');
    expect(titlesOf(tracks).every(title => title.media?.role === 'track')).toBe(true);
    expect(titlesOf(await get('/libraries/books/items?tab=series')).map(title => title.media?.role)).toEqual(['series', 'series']);
    expect((await fetch(`${mock.url}/vela/v0/libraries/music/items?tab=nope`, { headers: headers() })).status).toBe(400);
  });

  test('children are ordered by disc then index, and books and parts by index', async () => {
    const tracks = (await get<V.ChildrenPage>('/titles/album-northern-almanac/children?limit=100')).items;
    expect(tracks.map(track => [track.media?.disc, track.media?.index])).toEqual([1, 2].flatMap(disc => [1, 2, 3, 4, 5, 6].map(index => [disc, index])));
    expect(tracks[0]!.media?.parents?.map(parent => parent.role)).toEqual(['album', 'artist']);
    const albums = (await get<V.ChildrenPage>('/titles/artist-hollow-lanterns/children?role=album')).items;
    expect(albums.map(album => album.id)).toEqual(['album-paper-boats', 'album-northern-almanac', 'album-small-hours']);
    expect((await get<V.ChildrenPage>('/titles/series-inspector-wren/children')).items.map(book => book.media?.index)).toEqual([1, 2, 3]);
    const parts = (await get<V.ChildrenPage>('/titles/audiobook-long-voyage-of-the-marigold/children')).items;
    expect(parts.map(part => [part.media?.role, part.media?.index])).toEqual([['part', 1], ['part', 2], ['part', 3], ['part', 4]]);
  });

  test('details mark leaves playable and carry audiobook chapters and credits', async () => {
    expect((await get<V.TitleDetail>('/titles/album-paper-boats')).canPlay).toBe(false);
    expect((await get<V.TitleDetail>('/titles/track-paper-boats-1-01')).canPlay).toBe(true);
    const audiobook = await get<V.TitleDetail>('/titles/audiobook-lantern-keepers-almanac');
    expect(audiobook.canPlay).toBe(true);
    expect(audiobook.chapters.length).toBeGreaterThanOrEqual(8);
    expect(audiobook.chapters.at(-1)!.endSeconds).toBe(audiobook.title.durationSeconds);
    expect(audiobook.title.media?.credits?.map(credit => credit.role)).toEqual(['author', 'narrator']);
    const person = audiobook.title.media!.credits![0]!.personId!;
    expect((await get<V.PersonDetail>(`/people/${person}`)).roles).toContain('Author');
    expect(titlesOf(await get(`/people/${person}/titles?libraryId=books`)).every(title => title.media?.class === 'book')).toBe(true);
  });

  test('an audio plan is one direct, range-capable file', async () => {
    const response = await post('/playback', { titleId: 'track-paper-boats-1-01', client, idempotencyKey: key() });
    expect(response.status).toBe(200);
    const plan = await response.json() as V.PlaybackPlan;
    const track = await get<V.TitleDetail>('/titles/track-paper-boats-1-01');
    expect(plan).toMatchObject({ media: 'audio', titleId: 'track-paper-boats-1-01', durationSeconds: track.title.durationSeconds, positionSeconds: 0, audioTracks: [], subtitleTracks: [] });
    expect(plan.paths).toHaveLength(1);
    expect(plan.paths[0]).toMatchObject({ kind: 'direct', transport: 'file', range: true, readiness: 'ready', byteLength: 4096 });
    const media = await fetch(`${mock.url}${plan.paths[0]!.url}`, { headers: { Range: 'bytes=10-19' } });
    expect(media.status).toBe(206);
    expect(media.headers.get('content-range')).toBe('bytes 10-19/4096');
    expect((await media.arrayBuffer()).byteLength).toBe(10);
    const audiobook = await (await post('/playback', { titleId: 'audiobook-cartographers-daughter', client, idempotencyKey: key() })).json() as V.PlaybackPlan;
    expect(audiobook.positionSeconds).toBe(137);
    expect(audiobook.chapters.length).toBeGreaterThan(0);
    const book = await post('/playback', { titleId: 'book-quiet-poison', client, idempotencyKey: key() });
    expect(book.status).toBe(400);
  });

  test('a read grant is a short-lived URL fetched without the bearer, with ranges', async () => {
    const response = await post('/titles/book-harbour-of-bells/read', { idempotencyKey: key() });
    expect(response.status).toBe(200);
    const grant = await response.json() as V.ReadingGrant;
    expect(grant).toMatchObject({ titleId: 'book-harbour-of-bells', format: 'epub', mimeType: 'application/epub+zip', byteLength: epubBytes.length, progress: { fraction: 0.34 } });
    expect(Date.parse(grant.expiresAt) - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    const head = await fetch(`${mock.url}${grant.url}`, { headers: { Range: 'bytes=0-37' } });
    expect(head.status).toBe(206);
    expect(new TextDecoder().decode((await head.arrayBuffer()).slice(30, 38))).toBe('mimetype');
    expect((await fetch(`${mock.url}${grant.url.replace(/\/media\/[a-f0-9]+\//, '/media/0123abcd/')}`)).status).toBe(401);
    expect((await post('/titles/track-paper-boats-1-01/read', { idempotencyKey: key() })).status).toBe(400);
  });

  test('reading progress returns as WatchState.reading and finishes at 0.98', async () => {
    const id = 'book-weight-of-small-stars';
    expect((await post(`/titles/${id}/reading-progress`, { idempotencyKey: key(), locator: 'epubcfi(/6/6!/4/2)', fraction: 1.5 })).status).toBe(400);
    expect((await post(`/titles/${id}/reading-progress`, { idempotencyKey: key(), locator: 'epubcfi(/6/6!/4/2)', fraction: 0.5, label: 'Chapter 2' })).status).toBe(200);
    expect((await get<V.TitleDetail>(`/titles/${id}`)).title.watch).toMatchObject({ played: false, reading: { locator: 'epubcfi(/6/6!/4/2)', fraction: 0.5, label: 'Chapter 2' } });
    const listed = titlesOf(await get('/libraries/books/items?limit=100')).find(title => title.id === id)!;
    expect(listed.watch?.reading?.fraction).toBe(0.5);
    const home = await get<V.Page<V.Row>>('/rows?placement=home&limit=10');
    expect(home.items.find(row => row.id === 'media-continue-reading')!.items.some(item => item.kind === 'title' && item.title.id === id)).toBe(true);
    await post(`/titles/${id}/reading-progress`, { idempotencyKey: key(), locator: 'epubcfi(/6/18!/4/2)', fraction: 0.99 });
    expect((await get<V.TitleDetail>(`/titles/${id}`)).title.watch?.played).toBe(true);
    await post(`/titles/${id}/watch`, { idempotencyKey: key(), played: false });
    const cleared = (await get<V.TitleDetail>(`/titles/${id}`)).title.watch!;
    expect(cleared.played).toBe(false);
    expect(cleared.reading).toBeUndefined();
  });

  test('reading progress keeps the newest observed write', async () => {
    const id = 'book-patient-garden';
    const at = (offset: number) => new Date(Date.now() + offset).toISOString();
    expect((await post(`/titles/${id}/reading-progress`, { idempotencyKey: key(), locator: 'a', fraction: 0.2, observedAt: 'yesterday' })).status).toBe(400);
    await post(`/titles/${id}/reading-progress`, { idempotencyKey: key(), locator: 'newer', fraction: 0.6, observedAt: at(-1_000) });
    // A device syncing late is acknowledged and dropped.
    expect((await post(`/titles/${id}/reading-progress`, { idempotencyKey: key(), locator: 'older', fraction: 0.3, observedAt: at(-3_600_000) })).status).toBe(200);
    expect((await get<V.TitleDetail>(`/titles/${id}`)).title.watch?.reading?.locator).toBe('newer');
    // A write without observedAt wins on arrival.
    await post(`/titles/${id}/reading-progress`, { idempotencyKey: key(), locator: 'plain', fraction: 0.4 });
    expect((await get<V.TitleDetail>(`/titles/${id}`)).title.watch?.reading?.locator).toBe('plain');
  });

  test('home places the media rows after the first two rows', async () => {
    const rows = (await get<V.Page<V.Row>>('/rows?placement=home&limit=10')).items;
    expect(rows.slice(2, 5).map(row => [row.id, row.style])).toEqual([['media-recent-albums', 'square'], ['media-continue-reading', 'poster'], ['media-continue-listening', 'square']]);
    expect((await get<V.Bootstrap>('/bootstrap')).rows.map(row => row.id)).toEqual(rows.slice(0, 2).map(row => row.id));
  });

  test("a concert's tab, children and playback (plugin levels)", async () => {
    const music = (await get<V.Page<V.Library>>('/libraries?limit=100')).items.find(library => library.id === 'music')!;
    expect(music.tabs?.find(tab => tab.id === 'concerts')).toMatchObject({ kind: 'recommended', card: 'landscape' });
    const shelves = (await get<V.Page<V.Row>>('/libraries/music/rows?tab=concerts')).items;
    expect(shelves.map(row => row.id)).toContain('plugin:music:tab:concerts:shelf:recent');
    expect(shelves.find(row => row.purpose === 'continue')?.items).toHaveLength(1);
    expect((await fetch(`${mock.url}/vela/v0/libraries/music/rows?tab=artists`, { headers: headers() })).status).toBe(404);
    expect((await get<V.ChildrenPage>('/titles/artist-velvet-comet/children?level=concert')).items).toHaveLength(3);
    expect((await get<V.ChildrenPage>('/titles/artist-velvet-comet/children')).items).toHaveLength(5);
    // A concert plays through the video path: never refused as not playable audio.
    const response = await post('/playback', { idempotencyKey: key(), titleId: 'concert-comet-arcade-nights', client });
    if (response.status !== 200) expect(((await response.json()) as V.ErrorResponse).error).toMatchObject({ code: "media_not_generated" });
  });
});

test('an older server (VELA_MOCK_OLD=1) has no media libraries or flags', async () => {
  const old = await launchMock({ VELA_MOCK_OLD: '1' });
  try {
    const capabilities = await (await fetch(`${old.url}/vela/v0/capabilities`)).json() as V.ServerCapabilities;
    expect(capabilities.features.mediaClasses).toBeUndefined();
    expect(capabilities.features.reading).toBeUndefined();
    const signed = await (await fetch(`${old.url}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'old', username: 'demo', password: 'vela', device }) })).json() as V.Tokens;
    const libraries = await (await fetch(`${old.url}/vela/v0/libraries?limit=100`, { headers: { Authorization: `Bearer ${signed.accessToken}`, 'X-Vela-Device-Id': device.id } })).json() as V.Page<V.Library>;
    expect(libraries.items.some(library => library.media)).toBe(false);
  } finally { await old.stop(); }
});

test('the book ZIP writer stores mimetype first, uncompressed, with a correct CRC-32', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  const view = new DataView(epubBytes.buffer);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint16(8, true)).toBe(0);
  expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('application/epub+zip')));
  expect(new TextDecoder().decode(epubBytes.slice(30, 58))).toBe('mimetypeapplication/epub+zip');
  expect(view.getUint32(epubBytes.length - 22, true)).toBe(0x06054b50);
});

test('a skewed clock cannot pin reading progress beyond five minutes ahead', async () => {
  const { readingWriteTime } = await import('../media-kinds');
  const now = Date.parse('2026-11-20T12:00:00Z');
  expect(readingWriteTime(undefined, '2027-01-01T00:00:00Z', now)).toBe('2026-11-20T12:05:00.000Z');
  expect(readingWriteTime('2026-11-20T12:05:00.000Z', '2026-11-20T12:04:00Z', now + 600_000)).toBeUndefined();
  expect(readingWriteTime('2026-11-20T12:05:00.000Z', undefined, now)).toBe('2026-11-20T12:00:00.000Z');
});
