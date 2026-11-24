import { afterEach, describe, expect, test } from 'bun:test';
import { libraryExperience } from '../src/library-presentation';
import { JellyfinAdapter, bookFraction } from '../src/adapter/jellyfin';
import { foldAudiobooks, readingFormat, titleProjection } from '../src/adapter/jellyfin/media';
import type { Item } from '../src/adapter/jellyfin/types';
import { FakeCredentials, restoreFetch, routeFetch, tokens } from './helpers';

afterEach(restoreFetch);

// Shapes recorded from Jellyfin 12.4 and Emby 4.10.2 servers holding music, books, audiobooks and
// photos (trimmed to the fields the adapter reads).
const BASE = 'https://media.example/jf';
const JELLYFIN = { 'GET /jf/System/Info/Public': { Id: 'srv', ServerName: 'Home', Version: '12.4.0', ProductName: 'Jellyfin Server' } };
const EMBY = { 'GET /jf/System/Info/Public': { Id: 'srv', ServerName: 'Home', Version: '4.10.2.0' } };
const album: Item = { Id: 'al1', Name: 'Northern Static', Type: 'MusicAlbum', ProductionYear: 2019, ChildCount: 3, ParentId: 'ar1',
  AlbumArtist: 'Aurora Lines', AlbumArtists: [{ Id: 'ar1', Name: 'Aurora Lines' }], ImageTags: { Primary: 'c1' } };
const track = (n: number, disc?: number): Item => ({ Id: `t${n}`, Name: `Song ${n}`, Type: 'Audio', MediaType: 'Audio', IndexNumber: n, ParentIndexNumber: disc, RunTimeTicks: 250_002_490,
  Album: 'Northern Static', AlbumId: 'al1', AlbumPrimaryImageTag: 'c1', AlbumArtists: [{ Id: 'ar1', Name: 'Aurora Lines' }], ArtistItems: [{ Id: 'ar1', Name: 'Aurora Lines' }], ParentId: 'al1' });
const epub: Item = { Id: 'b1', Name: 'The Glass Orchard', Type: 'Book', MediaType: 'Book', RunTimeTicks: 10_000_000, Path: '/media/Books/Mara Quill/The Glass Orchard/The Glass Orchard.epub',
  People: [{ Id: 'p1', Name: 'Mara Quill', Type: 'Author' }], UserData: { PlaybackPositionTicks: 4_000_000, PlayedPercentage: 40, Played: false } };
const m4b: Item = { Id: 'ab1', Name: 'The Long Meridian', Type: 'AudioBook', MediaType: 'Audio', ParentId: 'author', RunTimeTicks: 900_000_000,
  People: [{ Id: 'p2', Name: 'Ines Calder', Type: 'Author' }, { Id: 'p3', Name: 'Theo Marsh', Type: 'Narrator' }], Chapters: [{ Name: 'Prologue', StartPositionTicks: 0 }] };
const part = (n: number): Item => ({ Id: `pt${n}`, Name: `Part ${n}`, Type: 'AudioBook', MediaType: 'Audio', IndexNumber: n, ParentId: 'salt', Album: 'Salt and Signal', RunTimeTicks: 300_000_000,
  People: [{ Id: 'p2', Name: 'Ines Calder', Type: 'Author' }] });

describe('Jellyfin and Emby media classes', () => {
  test('music maps to artists, albums and numbered tracks with their album and artist', () => {
    expect(titleProjection({ Id: 'ar1', Name: 'Aurora Lines', Type: 'MusicArtist', ChildCount: 2 })).toEqual({ kind: 'show', media: { class: 'music', role: 'artist', childCount: 2 } });
    expect(titleProjection(album)).toEqual({ kind: 'season', media: { class: 'music', role: 'album', childCount: 3,
      parents: [{ id: 'ar1', name: 'Aurora Lines', role: 'artist' }], credits: [{ name: 'Aurora Lines', role: 'albumArtist' }] } });
    expect(titleProjection(track(2, 1))?.media).toMatchObject({ class: 'music', role: 'track', index: 2, disc: 1,
      parents: [{ id: 'al1', name: 'Northern Static', role: 'album' }, { id: 'ar1', name: 'Aurora Lines', role: 'artist' }] });
    // Emby counts an artist's songs with its albums.
    expect(titleProjection({ Id: 'ar1', Name: 'A', Type: 'MusicArtist', ChildCount: 7 }, { emby: true })?.media).toEqual({ class: 'music', role: 'artist' });
  });

  test('books are readable by their file type; audiobooks carry author and narrator', () => {
    expect(titleProjection(epub)?.media).toEqual({ class: 'book', role: 'book', credits: [{ name: 'Mara Quill', role: 'author' }], reading: { format: 'epub' } });
    expect(readingFormat({ Id: 'x', Name: 'x', Type: 'Book', Container: 'cbz' })).toBe('cbz');
    expect(readingFormat({ Id: 'x', Name: 'x', Type: 'Book', Path: '/a/b.mobi' })).toBeUndefined();
    expect(titleProjection(m4b)).toEqual({ kind: 'movie', media: { class: 'audiobook', role: 'audiobook',
      credits: [{ name: 'Ines Calder', role: 'author' }, { name: 'Theo Marsh', role: 'narrator' }] } });
    // Emby's audiobook audio is plain Audio: the library says it is a book.
    expect(titleProjection({ ...track(1), Type: 'Audio' }, { audiobook: true, parent: { id: 'al1', name: 'Salt' } })?.media)
      .toMatchObject({ class: 'audiobook', role: 'part', index: 1, parents: [{ id: 'al1', name: 'Salt', role: 'audiobook' }] });
  });

  test('photos are photo titles; folders and albums of photos are not titles', () => {
    expect(titleProjection({ Id: 'ph', Name: 'IMG_0001', Type: 'Photo', Width: 1600, Height: 1066 })).toEqual({ kind: 'movie', media: { class: 'photo', role: 'item', facts: [{ label: 'Size', value: '1600 × 1066' }] } });
    expect(titleProjection({ Id: 'pa', Name: 'Lake', Type: 'PhotoAlbum' })).toBeUndefined();
    expect(titleProjection({ Id: 'f', Name: 'Author', Type: 'Folder' })).toBeUndefined();
    expect(titleProjection({ Id: 'v', Name: 'Cake', Type: 'Video' })).toEqual({ kind: 'movie' });
  });

  test('a multi-file audiobook folds into its folder (Jellyfin) or album (Emby); a single file stays a book', () => {
    const folded = foldAudiobooks([part(1), m4b, part(2), part(3)], false);
    expect(folded.map(x => 'item' in x ? x.item.Id : `${x.group}:${x.parts.length}`)).toEqual(['salt:3', 'ab1']);
    const emby = foldAudiobooks([{ ...part(1), Type: 'Audio', AlbumId: 'alb' }, { ...part(2), Type: 'Audio', AlbumId: 'alb' }, { ...m4b, Type: 'Audio', AlbumId: 'one' }], true);
    expect(emby.map(x => 'item' in x ? x.item.Id : x.group)).toEqual(['alb', 'ab1']);
  });

  test('reading progress is the position in the book runtime, or in one virtual second without one', () => {
    expect(bookFraction(epub)).toBe(0.4);
    expect(bookFraction({ Id: 'e', Name: 'e', UserData: { PlaybackPositionTicks: 2_500_000 } })).toBe(0.25);
    expect(bookFraction({ Id: 'e', Name: 'e' })).toBe(0);
  });
});

describe('Jellyfin media libraries', () => {
  test('a music library is square-covered with albums, artists and songs; a books library shows audiobooks only when it has some', async () => {
    routeFetch({ ...JELLYFIN,
      'GET /jf/Users/viewer-1/Views': { Items: [{ Id: 'mu', Name: 'Music', CollectionType: 'music' }, { Id: 'bk', Name: 'Books', CollectionType: 'books' }, { Id: 'ph', Name: 'Photos', CollectionType: 'homevideos' }] },
      'GET /jf/Users/viewer-1/Items': (r: { url: URL }) => ({ Items: [], TotalRecordCount: r.url.searchParams.get('IncludeItemTypes') === 'Book' ? 4 : 2 }),
    });
    const libraries = (await new JellyfinAdapter(BASE, new FakeCredentials()).libraries({})).items;
    expect(libraries.map(l => [l.name, l.media, l.presentation?.card, l.tabs?.map(t => t.level ?? t.id)])).toEqual([
      ['Music', 'music', 'square', ['recommended', 'albums', 'artist', 'track']],
      ['Books', 'book', 'poster', ['recommended', 'library', 'audiobook']],
      ['Photos', 'photo', 'square', ['recommended', 'library']],
    ]);
    // A server without features.libraryExperiences: each library still opens in its experience, by class.
    expect(libraries.map(l => libraryExperience(l, undefined))).toEqual(['listen', 'read', 'gallery']);
  });

  test('library tabs read albums, the library\'s album artists, and songs', async () => {
    const seen = routeFetch({ ...JELLYFIN,
      'GET /jf/Users/viewer-1/Items/mu': { Id: 'mu', Name: 'Music', CollectionType: 'music' },
      'GET /jf/Users/viewer-1/Items': { Items: [album], TotalRecordCount: 1 },
      'GET /jf/Artists/AlbumArtists': { Items: [{ Id: 'ar1', Name: 'Aurora Lines', Type: 'MusicArtist' }], TotalRecordCount: 1 },
    });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    expect((await adapter.library('mu', {})).items[0]).toMatchObject({ kind: 'title', title: { id: 'al1', media: { role: 'album' } } });
    expect(seen.at(-1)!.url.searchParams.get('IncludeItemTypes')).toBe('MusicAlbum');
    expect((await adapter.library('mu', { tab: 'artists' })).items[0]).toMatchObject({ title: { media: { role: 'artist' } } });
    expect(seen.at(-1)!.url.pathname).toBe('/jf/Artists/AlbumArtists');
    expect(seen.at(-1)!.url.searchParams.get('ParentId')).toBe('mu');
    await adapter.library('mu', { tab: 'tracks' });
    expect(seen.at(-1)!.url.searchParams.get('IncludeItemTypes')).toBe('Audio');
  });

  test('an audiobook listing indexes the whole library before paging, so a book\'s parts never split', async () => {
    const seen = routeFetch({ ...JELLYFIN,
      'GET /jf/Users/viewer-1/Items/bk': { Id: 'bk', Name: 'Books', CollectionType: 'books' },
      'GET /jf/Users/viewer-1/Items': (r: { url: URL }) => {
        const p = r.url.searchParams;
        if (p.get('Limit') === '0') return { Items: [], TotalRecordCount: p.get('IncludeItemTypes') === 'Book' ? 0 : 4 };
        if (p.get('Ids')) return { Items: [{ Id: 'salt', Name: 'Salt and Signal', Type: 'Folder', ChildCount: 3 }, m4b, part(1)].filter(i => p.get('Ids')!.split(',').includes(i.Id)) };
        return { Items: [part(1), part(2), part(3), m4b], TotalRecordCount: 4 };
      },
    });
    const page = await new JellyfinAdapter(BASE, new FakeCredentials()).library('bk', { limit: 1 });
    expect(page.library.media).toBe('audiobook');
    expect(page.total).toBe(2);
    // By title: the multi-file book (named by its parts' album) before the single file.
    expect(page.items).toMatchObject([{ title: { id: 'salt', kind: 'show', name: 'Salt and Signal', durationSeconds: 90,
      media: { role: 'audiobook', childCount: 3, credits: [{ name: 'Ines Calder', role: 'author' }] } } }]);
    expect(page.nextCursor).toBe('1');
    const scan = seen.find(r => r.url.searchParams.get('IncludeItemTypes') === 'AudioBook' && r.url.searchParams.get('Limit') === '1000');
    expect(scan).toBeDefined();
  });

  test('an album\'s children are its tracks in disc and track order; an artist\'s are its albums, newest first', async () => {
    const seen = routeFetch({ ...JELLYFIN,
      'GET /jf/Users/viewer-1/Items/al1': album,
      'GET /jf/Users/viewer-1/Items/ar1': { Id: 'ar1', Name: 'Aurora Lines', Type: 'MusicArtist' },
      'GET /jf/Users/viewer-1/Items': (r: { url: URL }) => ({ Items: r.url.searchParams.get('AlbumArtistIds') ? [album] : [track(1), track(2)], TotalRecordCount: 2 }),
    });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    const tracks = await adapter.children('al1');
    expect(tracks.items.map(t => [t.id, t.media?.role, t.media?.index])).toEqual([['t1', 'track', 1], ['t2', 'track', 2]]);
    expect(seen.at(-1)!.url.searchParams.get('SortBy')).toBe('ParentIndexNumber,IndexNumber,SortName');
    // A track without its own cover shows its album's.
    expect(tracks.items[0]!.artwork.map(a => a.sizes[0]!.url)).toEqual(['https://media.example/jf/Items/al1/Images/Primary?tag=c1']);
    const albums = await adapter.children('ar1');
    expect(albums.items[0]!.media?.role).toBe('album');
    expect(seen.at(-1)!.url.searchParams.get('AlbumArtistIds')).toBe('ar1');
    expect(seen.at(-1)!.url.searchParams.get('SortOrder')).toBe('Descending');
  });
});

describe('Jellyfin audio and reading', () => {
  const client = { device: { id: 'd', name: 'd', platform: 'web', appVersion: '1' }, containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [], hls: true, mse: true };
  test('a track plays as its file when every player decodes it, else as the server\'s MP3 transcode', async () => {
    let container = 'mp3';
    const seen = routeFetch({ ...JELLYFIN,
      'GET /jf/Users/viewer-1/Items/t1': track(1),
      'POST /jf/Items/t1/PlaybackInfo': () => ({ PlaySessionId: 'ps', MediaSources: [{ Id: 't1', Container: container, SupportsDirectPlay: container === 'mp3', TranscodingUrl: '/jf/Audio/t1/universal?Container=mp3&api_key=x' }] }),
    });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    const plan = await adapter.startPlayback({ titleId: 't1', client, idempotencyKey: 'a' } as never);
    expect(plan.media).toBe('audio');
    expect(plan.paths.map(p => [p.kind, p.transport, p.mimeType, p.url])).toEqual([['direct', 'file', 'audio/mpeg', 'https://media.example/jf/Audio/t1/stream?Static=true&MediaSourceId=t1&PlaySessionId=ps&DeviceId=d']]);
    const profile = (seen.find(r => r.url.pathname.endsWith('/PlaybackInfo'))!.body as { DeviceProfile: { DirectPlayProfiles: { Type: string }[]; TranscodingProfiles: { Container: string; Protocol: string }[] } }).DeviceProfile;
    expect(profile.DirectPlayProfiles[0]!.Type).toBe('Audio');
    expect(profile.TranscodingProfiles[0]).toMatchObject({ Container: 'mp3', Protocol: 'http' });
    container = 'ogg';
    const transcoded = await adapter.startPlayback({ titleId: 't1', client, idempotencyKey: 'b' } as never);
    expect(transcoded.paths.map(p => [p.kind, p.transport, p.mimeType, p.url])).toEqual([['transcode', 'file', 'audio/mpeg', 'https://media.example/jf/Audio/t1/universal?Container=mp3']]);
  });

  test('a book opens as the server\'s download with the token for a reader that sends no headers', async () => {
    routeFetch({ ...EMBY, 'GET /jf/Users/viewer-1/Items/b1': { ...epub, MediaSources: [{ Id: 'b1', Size: 33080 }] } });
    const grant = await new JellyfinAdapter(BASE, new FakeCredentials(tokens('tok'))).openReading('b1', { idempotencyKey: 'r' });
    expect(grant).toMatchObject({ titleId: 'b1', format: 'epub', mimeType: 'application/epub+zip', byteLength: 33080, progress: { locator: '', fraction: 0.4 } });
    expect(grant.url).toBe('https://media.example/jf/Items/b1/Download?api_key=tok&ApiKey=tok');
  });

  test('reading progress is written as the position in the book (Jellyfin) or a virtual second (Emby)', async () => {
    const seen = routeFetch({ ...JELLYFIN,
      'GET /jf/Users/viewer-1/Items/b1': epub,
      'POST /jf/UserItems/b1/UserData': {},
    });
    await new JellyfinAdapter(BASE, new FakeCredentials()).saveReadingProgress('b1', { idempotencyKey: 'p', locator: 'epubcfi(/6/4)', fraction: 0.99 });
    expect(seen.at(-1)!.body).toMatchObject({ PlaybackPositionTicks: 9_900_000, Played: true });
    const emby = routeFetch({ ...EMBY, 'GET /jf/Users/viewer-1/Items/b1': { ...epub, RunTimeTicks: undefined }, 'POST /jf/Users/viewer-1/Items/b1/UserData': {} });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    await adapter.describe().catch(() => undefined);
    await adapter.saveReadingProgress('b1', { idempotencyKey: 'p', locator: '', fraction: 0.25 });
    expect(emby.at(-1)).toMatchObject({ url: new URL('https://media.example/jf/Users/viewer-1/Items/b1/UserData'), body: { PlaybackPositionTicks: 2_500_000, Played: false } });
  });
});

test('an artist whose albums carry no album-artist tags has the albums in its folder', async () => {
  const seen = routeFetch({ ...JELLYFIN,
    'GET /jf/Users/viewer-1/Items/ar9': { Id: 'ar9', Name: 'Binaerpilot', Type: 'MusicArtist' },
    'GET /jf/Users/viewer-1/Items': (r: { url: URL }) => r.url.searchParams.get('ParentId') === 'ar9'
      ? { Items: [{ Id: 'promo', Name: 'Promo', Type: 'MusicAlbum' }], TotalRecordCount: 1 } : { Items: [], TotalRecordCount: 0 },
  });
  const albums = await new JellyfinAdapter(BASE, new FakeCredentials()).children('ar9');
  expect(albums.items.map(a => [a.id, a.media?.role])).toEqual([['promo', 'album']]);
  expect(seen.at(-1)!.url.searchParams.get('IncludeItemTypes')).toBe('MusicAlbum');
});
