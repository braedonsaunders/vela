import { afterEach, describe, expect, test } from 'bun:test';
import { PlexAdapter, discoverPlexServers, plexHeaders } from '../src/adapter/plex';
import { VelaError } from '../src/adapter/errors';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);

const ORIGIN = 'https://plex.example:32400';
const plex = (credentials = new FakeCredentials()) => new PlexAdapter({ origin: ORIGIN, credentials, clientIdentifier: 'client-1' });

const movie = { ratingKey: 10, type: 'movie', title: 'Heat', summary: 'LA crime.', year: 1995, duration: 6_120_000, viewOffset: 90_000, viewCount: 1,
  contentRating: 'R', rating: 8.7, ratingImage: 'rottentomatoes://image.rating.ripe', audienceRating: 9.1, Genre: [{ tag: 'Crime' }],
  thumb: '/library/metadata/10/thumb/1', art: '/library/metadata/10/art/1', updatedAt: 99 };
const episode = { ratingKey: 20, type: 'episode', title: 'Pilot', index: 1, parentIndex: 2, parentRatingKey: 19, grandparentRatingKey: 18 };

describe('PlexAdapter addresses', () => {
  test('takes a bare origin only', () => {
    expect(plex().origin).toBe(ORIGIN);
    for (const bad of [`${ORIGIN}/web`, 'https://u:p@plex.example', `${ORIGIN}/?a=1`, 'ftp://plex.example']) {
      expect(() => new PlexAdapter({ origin: bad, credentials: new FakeCredentials(), clientIdentifier: 'c' })).toThrow('Plex requires a server origin');
    }
  });

  test('needs a client identifier', () => {
    expect(() => plexHeaders('')).toThrow();
    expect(plexHeaders('abc')).toMatchObject({ 'X-Plex-Client-Identifier': 'abc', Accept: 'application/json' });
  });

  test('media URLs are credential-free paths under media roots', () => {
    const adapter = plex();
    expect(adapter.mediaURL('/library/parts/1/file.mkv')).toBe(`${ORIGIN}/library/parts/1/file.mkv`);
    expect(() => adapter.mediaURL('/library/parts/1/file.mkv?X-Plex-Token=t')).toThrow('Persistent Plex token in media URL');
    expect(() => adapter.mediaURL('/:/prefs')).toThrow('Plex media outside selected server');
    expect(() => adapter.mediaURL('https://other.example/library/parts/1')).toThrow('Plex media outside selected server');
  });
});

describe('PlexAdapter requests', () => {
  test('filmography filters the selected section by actor and pages', async () => {
    const seen = routeFetch({ 'GET /library/sections/7/all': { MediaContainer: { Metadata: [movie], totalSize: 6 } } });
    const result = await plex().personTitles('42', '7', '4');
    expect(seen[0]!.url.searchParams.get('actor')).toBe('42');
    expect(seen[0]!.url.searchParams.get('X-Plex-Container-Start')).toBe('4');
    expect(result).toMatchObject({ items: [{ id: '10' }], nextCursor: '5' });
  });
  test('search merges hubs, keeps playable kinds once and maps titles', async () => {
    const seen = routeFetch({ 'GET /hubs/search': { MediaContainer: { Hub: [
      { type: 'movie', Metadata: [movie, { ...movie }] },
      { type: 'episode', Metadata: [episode] },
      { type: 'actor', Directory: [{ ratingKey: 30, type: 'actor', title: 'Al Pacino' }] },
    ] } } });
    const result = await plex().search({ query: 'heat', generation: 7, idempotencyKey: 'k' });
    expect(seen[0]!.url.searchParams.get('query')).toBe('heat');
    expect(seen[0]!.headers.get('x-plex-token')).toBe('token-1');
    expect(result).toMatchObject({ query: 'heat', generation: 7, continuation: 'exhausted' });
    expect(result.items.map(t => t.id)).toEqual(['10', '20']);
    expect(result.items[0]).toMatchObject({
      kind: 'movie', name: 'Heat', year: 1995, genres: ['Crime'], durationSeconds: 6120, rating: 'R',
      ratings: [{ source: 'rottentomatoes://image.rating.ripe', kind: 'critic', value: 8.7, scale: 10 }, { source: 'Plex', kind: 'audience', value: 9.1, scale: 10 }],
      watch: { positionSeconds: 90, played: true, favorite: false, watchlisted: false },
    });
    expect(result.items[0]!.artwork.map(a => [a.kind, a.sizes[0]!.url, a.tag])).toEqual([
      ['poster', `${ORIGIN}/library/metadata/10/thumb/1`, '99'],
      ['backdrop', `${ORIGIN}/library/metadata/10/art/1`, '99'],
    ]);
    expect(result.items[1]).toMatchObject({ kind: 'episode', showId: '18', seasonId: '19', seasonNumber: 2, episodeNumber: 1 });
  });

  test('home rows skip empty finished hubs and classify purposes', async () => {
    routeFetch({ 'GET /hubs': { MediaContainer: { Hub: [
      { key: '/hubs/home/continueWatching', title: 'Continue', Metadata: [movie], size: 1 },
      { key: '/hubs/home/onDeck', title: 'On Deck', Metadata: [], size: 0 },
      { key: '/hubs/home/recentlyAdded', title: 'New', Metadata: [movie], more: true, size: 1 },
      { hubIdentifier: 'home.other', title: 'Picks', Metadata: [{ ratingKey: 5, type: 'collection', title: 'Noir' }], size: 1 },
    ] } } });
    const rows = await plex().rows({});
    expect(rows.items.map(r => [r.id, r.purpose, r.continuation])).toEqual([
      ['/hubs/home/continueWatching', 'continue', 'exhausted'],
      ['/hubs/home/recentlyAdded', 'recentlyAdded', 'more'],
      ['home.other', 'recommendation', 'exhausted'],
    ]);
    expect(rows.items[2]!.items[0]).toMatchObject({ kind: 'collection', targetId: 'collection:5', name: 'Noir' });
  });

  test('library recommendations read the selected Plex section hubs', async () => {
    const seen = routeFetch({ 'GET /hubs/sections/7': { MediaContainer: { Hub: [
      { key: '/hubs/sections/7/recentlyAdded', title: 'Recently Added', Metadata: [movie], size: 1 },
      { key: '/hubs/sections/7/genres', title: 'By Genre', Directory: [{ type: 'genre', key: '8', title: 'Crime' }], size: 1 },
      { key: '/hubs/sections/7/empty', title: 'Empty', Metadata: [], size: 0 },
    ] } } });
    const rows = await plex().libraryRows('7', 'movies');
    expect(seen[0]!.url.pathname).toBe('/hubs/sections/7');
    expect(rows.map(row => [row.name, row.purpose, row.items[0]?.id])).toEqual([['Recently Added', 'recentlyAdded', '10'], ['By Genre', 'recommendation', 'genre:8']]);
    expect(rows[1]!.items[0]).toMatchObject({ kind: 'directory', targetId: 'vela-library-genre:8' });
  });

  test('library collections and genres stay scoped to the selected section', async () => {
    const seen = routeFetch({
      'GET /library/sections/7/collections': { MediaContainer: { Metadata: [{ type: 'collection', ratingKey: 9, title: 'Noir' }], totalSize: 2 } },
      'GET /library/sections/7/genre': { MediaContainer: { Directory: [{ key: '8', title: 'Crime' }, { key: '/unrelated/path', fastKey: '/library/sections/7/all?genre=12', title: 'Drama' }] } },
    });
    const adapter = plex();
    const collections = await adapter.libraryCollections('7');
    expect(collections.items[0]).toMatchObject({ kind: 'collection', targetId: 'collection:9' });
    expect(collections.nextCursor).toBe('1');
    expect(await adapter.libraryGenres('7')).toEqual([{ id: '8', label: 'Crime' }, { id: '12', label: 'Drama' }]);
    expect(seen.map(call => call.url.pathname)).toEqual(['/library/sections/7/collections', '/library/sections/7/genre']);
  });

  test('libraries list movie, show and music sections and refuse unsupported filters', async () => {
    const seen = routeFetch({
      'GET /library/sections': { MediaContainer: { Directory: [{ key: 1, title: 'Films', type: 'movie' }, { key: 2, title: 'Music', type: 'artist' }, { key: 3, title: 'TV', type: 'show' }] } },
      'GET /library/sections/1/all': { MediaContainer: { Metadata: [movie], totalSize: 30, size: 1 } },
    });
    const adapter = plex();
    const libraries = await adapter.libraries({});
    expect(libraries.items.map(l => [l.id, l.kind, l.media])).toEqual([['1', 'movies', undefined], ['2', 'mixed', 'music'], ['3', 'shows', undefined]]);
    const contents = await adapter.library('1', { sort: 'year', direction: 'desc', played: false, cursor: '5', limit: 1 });
    const query = seen.at(-1)!.url.searchParams;
    expect(query.get('sort')).toBe('year:desc');
    expect(query.get('unwatched')).toBe('1');
    expect(query.get('X-Plex-Container-Start')).toBe('5');
    expect(contents).toMatchObject({ sort: 'year', direction: 'desc', continuation: 'more', nextCursor: '6' });
    await expect(adapter.library('1', { favorite: true })).rejects.toThrow('Unsupported Plex library filter or sort');
    await expect(adapter.library('9', {})).rejects.toThrow('Plex library not found');
    await expect(adapter.library('1', { cursor: 'abc' })).rejects.toThrow('Invalid Plex continuation');
  });

  test('a series or season is played only once every episode is', async () => {
    const show = { ratingKey: 30, type: 'show', title: 'Lost', leafCount: 10 };
    routeFetch({
      'GET /library/sections': { MediaContainer: { Directory: [{ key: 3, title: 'TV', type: 'show' }] } },
      'GET /library/sections/3/all': { MediaContainer: { Metadata: [
        { ...show, viewedLeafCount: 4, viewCount: 9 },
        { ...show, ratingKey: 31, viewedLeafCount: 10, viewCount: 12 },
        { ...show, ratingKey: 32, type: 'season', leafCount: 0, viewedLeafCount: 0 },
      ], totalSize: 3, size: 3 } },
    });
    const contents = await plex().library('3', {});
    expect(contents.items.map(entry => entry.kind === 'title' ? entry.title.watch?.played : undefined)).toEqual([false, true, false]);
  });

  test('detail maps people, chapters, extras and streams', async () => {
    routeFetch({ 'GET /library/metadata/10': { MediaContainer: { Metadata: [{ ...movie,
      Role: [{ id: 42, tag: 'Al Pacino', role: 'Hanna', thumb: '/library/people/1' }], Director: [{ tag: 'Michael Mann' }],
      Chapter: [{ id: 1, tag: 'Opening', startTimeOffset: 0, endTimeOffset: 60_000 }, { id: 2, index: 1, startTimeOffset: 60_000 }],
      Extras: { Metadata: [{ ratingKey: 11, extraType: 1, title: 'Trailer', duration: 120_000, Media: [{}] }, { ratingKey: 12, extraType: 5, title: 'Making of' }] },
      Media: [{ Part: [{ Stream: [{ streamType: 1, codec: 'hevc', width: 3840, height: 2160, bitDepth: 10, colorTrc: 'smpte2084' }, { streamType: 2, codec: 'eac3', channels: 6, languageCode: 'eng', selected: 1 }, { streamType: 3, codec: 'srt' }] }] }, { Part: [{ Stream: [{ streamType: 2, codec: 'aac' }, { streamType: 3, codec: 'srt' }] }] }],
    }] } } });
    const detail = await plex().detail('10');
    expect(detail.canPlay).toBe(true);
    expect(detail.cast).toEqual([{ id: '42', name: 'Al Pacino', role: 'Hanna', artwork: expect.objectContaining({ kind: 'person' }) }]);
    expect(detail.crew).toEqual([{ name: 'Michael Mann', role: 'Director', artwork: undefined }]);
    expect(detail.chapters).toEqual([
      { id: '1', name: 'Opening', startSeconds: 0, endSeconds: 60 },
      { id: '2', name: 'Chapter 2', startSeconds: 60, endSeconds: undefined },
    ]);
    expect(detail.extras?.map(e => [e.id, e.kind, e.availability, e.durationSeconds])).toEqual([['11', 'trailer', 'ready', 120], ['12', 'other', 'unresolved', 0]]);
    expect(detail.mediaSummary).toEqual({
      video: [{ codec: 'hevc', width: 3840, height: 2160, bitDepth: 10, colorTransfer: 'smpte2084' }],
      audio: [{ codec: 'eac3', channels: 6, language: 'eng', default: true }],
      subtitleCount: 1,
    });
  });

  test('a 401 is an auth failure', async () => {
    routeFetch({ 'GET /library/sections': new Response('', { status: 401 }) });
    const error = await plex().libraries({}).catch(e => e);
    expect(error).toBeInstanceOf(VelaError);
    expect(error).toMatchObject({ status: 401, detail: { class: 'auth', code: 'plex_http' } });
  });

  test('validateSession ends only a rejected session', async () => {
    const credentials = new FakeCredentials();
    routeFetch({ 'GET /library/sections': new Response('', { status: 401 }) });
    expect(await plex(credentials).validateSession()).toBeNull();
    expect(credentials.current).toBeNull();
    const kept = new FakeCredentials();
    routeFetch({ 'GET /library/sections': { MediaContainer: {} } });
    expect(await plex(kept).validateSession()).toEqual(kept.current);
  });

  test('live TV reads the DVR grid and maps airings to programmes', async () => {
    const seen = routeFetch({
      'GET /identity': { MediaContainer: { machineIdentifier: 'pms-1', friendlyName: 'Den', version: '1.40' } },
      'GET /livetv/dvrs': { MediaContainer: { Dvr: [{ key: '/livetv/dvrs/4' }] } },
      'GET /media/providers': { MediaContainer: { MediaProvider: [{ Feature: [{ type: 'search' }, { type: 'grid', key: '/tv.plex.providers.epg/grid' }] }] } },
      'GET /tv.plex.providers.epg/grid': { MediaContainer: { size: 1, Metadata: [{ ratingKey: 77, grandparentTitle: 'The Show', title: 'Episode One', parentIndex: 1, index: 3, Genre: [{ tag: 'Drama' }],
        Media: [{ channelIdentifier: 'ch-5', beginsAt: 1_773_144_000, endsAt: 1_773_147_600 }] }] } },
      'GET /tv.plex.providers.epg/lineups/dvr/channels': { MediaContainer: { Channel: [{ id: 5, gridKey: 'ch-5', vcn: '5.1', title: 'Five' }, { id: 6, callSign: 'KSIX' }] } },
    });
    const adapter = plex();
    expect((await adapter.describe()).features.liveTV).toEqual({ available: true });
    const channels = await adapter.channels(undefined, 1);
    expect(channels).toMatchObject({ items: [{ id: 'ch-5', number: '5.1', name: 'Five', kind: 'tv', favorite: false }], continuation: 'more', nextCursor: '1' });
    expect((await adapter.channels('1')).items[0]).toMatchObject({ id: '6', name: 'KSIX', number: '' });
    const guide = await adapter.guide({ from: '2026-03-10T12:00:00Z', until: '2026-03-10T18:00:00Z', channelIds: ['ch-5'] });
    const grid = seen.find(s => s.url.pathname === '/tv.plex.providers.epg/grid')!.url.searchParams;
    expect(grid.get('endsAt>')).toBe(String(Date.parse('2026-03-10T12:00:00Z') / 1000));
    expect(grid.get('beginsAt<')).toBe(String(Date.parse('2026-03-10T18:00:00Z') / 1000));
    expect(grid.get('type')).toBe('1,4');
    expect(grid.has('beginsAt')).toBe(false);
    expect(seen.some(s => s.url.pathname === '/livetv/epg/channels')).toBe(false);
    expect(grid.get('channelGridKey')).toBe('ch-5');
    expect(guide.items).toEqual([{ id: '77', channelId: 'ch-5', name: 'The Show', episodeTitle: 'Episode One', summary: '',
      start: '2026-03-10T12:00:00.000Z', end: '2026-03-10T13:00:00.000Z', artwork: [], seasonNumber: 1, episodeNumber: 3, rating: undefined, genres: ['Drama'] }]);
    await expect(adapter.guide({ from: '2026-03-10T12:00:00Z', until: '2026-03-10T11:00:00Z' })).rejects.toThrow('Invalid Plex guide window');
    await expect(adapter.guide({ from: '2026-03-01T00:00:00Z', until: '2026-03-10T00:00:00Z' })).rejects.toThrow('Invalid Plex guide window');
  });

  test.each(['xmltv', 'cloud'])('%s DVR channels and airings share the provider grid identity', async kind => {
    const base = `/tv.plex.providers.epg.${kind}:48`;
    const seen = routeFetch({
      'GET /identity': { MediaContainer: {} },
      'GET /livetv/dvrs': { MediaContainer: { Dvr: [{ key: '48' }] } },
      'GET /media/providers': { MediaContainer: { MediaProvider: [{ identifier: base.slice(1), Feature: [{ type: 'grid', key: `${base}/grid` }] }] } },
      [`GET ${base}/lineups/dvr/channels`]: { MediaContainer: { Channel: [{ id: 1000, gridKey: 'station-1000', title: 'News', vcn: '10' }] } },
      [`GET ${base}/grid`]: { MediaContainer: { size: 1, Metadata: [{ ratingKey: 7, title: 'Evening News', Media: [{ channelIdentifier: 'station-1000', beginsAt: 1_773_144_000, endsAt: 1_773_147_600 }] }] } },
      'GET /livetv/epg/channels': new Response('', { status: 400 }),
    });
    const adapter = plex();
    const channel = (await adapter.channels()).items[0]!;
    const guide = await adapter.guide({ from: '2026-03-10T12:00:00Z', until: '2026-03-10T18:00:00Z', channelIds: [channel.id] });
    expect(channel).toMatchObject({ id: 'station-1000', number: '10', name: 'News' });
    expect(guide.items[0]?.channelId).toBe(channel.id);
    expect(seen.some(r => r.url.pathname === '/livetv/epg/channels')).toBe(false);
  });

  test('removing the DVR clears a previously available guide without querying providers', async () => {
    let present = true;
    const seen = routeFetch({
      'GET /identity': { MediaContainer: {} },
      'GET /livetv/dvrs': () => ({ MediaContainer: { Dvr: present ? [{ key: '/livetv/dvrs/4' }] : [] } }),
      'GET /media/providers': { MediaContainer: { MediaProvider: [{ Feature: [{ type: 'grid', key: '/grid' }] }] } },
    });
    const adapter = plex();
    expect((await adapter.describe()).features.liveTV?.available).toBe(true);
    present = false;
    expect((await adapter.describe()).features.liveTV?.available).toBe(false);
    expect(await adapter.channels()).toEqual({ items: [], continuation: 'exhausted' });
    expect(seen.filter(r => r.url.pathname === '/media/providers')).toHaveLength(1);
    await expect(adapter.guide({ from: 'bad', until: 'bad' })).rejects.toThrow('Invalid Plex guide window');
  });

  test('without a DVR, live TV is unavailable', async () => {
    routeFetch({
      'GET /identity': { MediaContainer: {} },
      'GET /livetv/dvrs': new Response('', { status: 404 }),
    });
    const adapter = plex();
    const described = await adapter.describe();
    expect(described.server).toEqual({ id: ORIGIN, name: 'Plex Media Server', version: '' });
    expect(described.features.liveTV?.available).toBe(false);
    expect(await adapter.channels()).toEqual({ items: [], continuation: 'exhausted' });
    expect(await adapter.guide({ from: '2026-03-10T12:00:00Z', until: '2026-03-10T18:00:00Z' })).toEqual({
      from: '2026-03-10T12:00:00Z', until: '2026-03-10T18:00:00Z', items: [], continuation: 'exhausted',
    });
  });
});

describe('discoverPlexServers', () => {
  test('keeps servers and their usable connections, secure and direct first', async () => {
    routeFetch({ 'GET /api/v2/resources': [
      { name: 'Den', clientIdentifier: 'a', accessToken: 't', owned: true, provides: 'server,player', connections: [
        { uri: 'https://relay.plex.direct:8443', local: false, relay: true, protocol: 'https' },
        { uri: 'http://192.168.1.2:32400', local: true, relay: false, protocol: 'http' },
        { uri: 'https://10-0-0-2.abc.plex.direct:32400', local: true, relay: false, protocol: 'https' },
        { uri: 'https://bad.example/path', local: false, relay: false, protocol: 'https' },
        { uri: 'not a url', local: false, relay: false, protocol: 'https' },
      ] },
      { name: 'Phone', clientIdentifier: 'b', accessToken: 't', owned: true, provides: 'player', connections: [] },
    ] });
    const servers = await discoverPlexServers('client-1', 'account');
    expect(servers.map(s => s.name)).toEqual(['Den']);
    expect(servers[0]!.connections.map(c => c.uri)).toEqual([
      'https://10-0-0-2.abc.plex.direct:32400', 'https://relay.plex.direct:8443', 'http://192.168.1.2:32400',
    ]);
  });
});

test('episode and season posters use series art, while landscape cards keep episode stills', async () => {
  routeFetch({ 'GET /hubs/search': { MediaContainer: { Hub: [{ Metadata: [
    { ...episode, grandparentTitle: 'Severance', thumb: '/library/metadata/20/thumb', grandparentThumb: '/library/metadata/18/thumb', art: '/library/metadata/18/art' },
    { ratingKey: 19, type: 'season', title: 'Season 2', index: 2, parentRatingKey: 18, parentTitle: 'Severance', thumb: '/library/metadata/19/thumb', parentThumb: '/library/metadata/18/thumb' },
    { ...episode, ratingKey: 21, thumb: '/library/metadata/21/thumb' },
  ] }] } } });
  const { items } = await plex().search({ query: 'show', generation: 1, idempotencyKey: 'art' });
  expect(items[0]).toMatchObject({ showName: 'Severance', seasonNumber: 2, episodeNumber: 1 });
  expect(items[0]!.artwork.map(a => [a.kind, a.sizes[0]!.url])).toEqual([
    ['poster', `${ORIGIN}/library/metadata/18/thumb`], ['still', `${ORIGIN}/library/metadata/20/thumb`], ['backdrop', `${ORIGIN}/library/metadata/18/art`],
  ]);
  expect(items[1]).toMatchObject({ showName: 'Severance', seasonNumber: 2 });
  expect(items[1]!.artwork[0]!.sizes[0]!.url).toBe(`${ORIGIN}/library/metadata/18/thumb`);
  expect(items[2]!.artwork.map(a => a.kind)).toEqual(['still']);
});

describe('PlexAdapter server name', () => {
  test('reads the name from the root container, not /identity', async () => {
    routeFetch({ 'GET /identity': { MediaContainer: { machineIdentifier: 'm1', version: '1.43' } }, 'GET /': { MediaContainer: { friendlyName: 'Ether' } } });
    expect((await plex().describe()).server.name).toBe('Ether');
  });
  test('falls back to the name it was added under', async () => {
    routeFetch({ 'GET /identity': { MediaContainer: { machineIdentifier: 'm1', version: '1.43' } } });
    const adapter = new PlexAdapter({ origin: ORIGIN, credentials: new FakeCredentials(), clientIdentifier: 'client-1', name: 'MEDIASERVER' });
    expect((await adapter.describe()).server.name).toBe('MEDIASERVER');
  });
});

test('Plex hub search scopes the upstream type and excludes other hubs', async () => {
  const seen = routeFetch({ 'GET /hubs/search': { MediaContainer: { Hub: [{ Metadata: [movie, episode] }] } } });
  const result = await plex().search({ query: 'heat', generation: 1, idempotencyKey: 'kind', kind: 'movie' });
  expect(seen[0]!.url.searchParams.get('type')).toBe('1');
  expect(result.items.map(x => x.kind)).toEqual(['movie']);
});


test('Plex searches the selected library section and maps its direct metadata', async () => {
  const seen = routeFetch({ 'GET /library/sections/4/search': { MediaContainer: { Metadata: [movie, episode] } } });
  const result = await plex().search({ query: 'heat', generation: 1, idempotencyKey: 'library', library: '4', kind: 'movie' });
  expect(seen[0]!.url.searchParams.get('query')).toBe('heat');
  expect(seen[0]!.url.searchParams.get('type')).toBe('1');
  expect(result.items.map(t => t.id)).toEqual(['10']);
});
