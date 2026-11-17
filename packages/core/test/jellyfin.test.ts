import { afterEach, describe, expect, test } from 'bun:test';
import { JellyfinAdapter } from '../src/adapter/jellyfin';
import { VelaError } from '../src/adapter/errors';
import { FakeCredentials, restoreFetch, routeFetch, tokens } from './helpers';

afterEach(restoreFetch);

const BASE = 'https://media.example/jf';
const movie = {
  Id: 'm1', Name: 'Heat', Type: 'Movie', Overview: 'LA crime.', ProductionYear: 1995, Genres: ['Crime'], RunTimeTicks: 102_000_000_000,
  OfficialRating: 'R', CommunityRating: 8.3, CriticRating: 88, ImageTags: { Primary: 'p1', Logo: 'l1' }, BackdropImageTags: ['b1'],
  UserData: { PlaybackPositionTicks: 600_000_000, Played: false, IsFavorite: true },
};
const episode = { Id: 'e1', Name: 'Pilot', Type: 'Episode', SeriesId: 's1', SeasonId: 'se1', ParentIndexNumber: 1, IndexNumber: 2 };

describe('JellyfinAdapter addresses', () => {
  test('refuses credentials, queries and fragments in the server address', () => {
    for (const bad of ['https://u:p@media.example', 'https://media.example/?x=1', 'https://media.example/#a', 'file:///etc']) {
      expect(() => new JellyfinAdapter(bad, new FakeCredentials())).toThrow('Invalid server address');
    }
  });

  test('media URLs stay inside the bound base path and lose persistent credentials', () => {
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    expect(adapter.mediaURL('/jf/Videos/1/stream?api_key=secret&Static=true&X-Emby-Token=t')).toBe('https://media.example/jf/Videos/1/stream?Static=true');
    expect(() => adapter.mediaURL('https://elsewhere.example/jf/Videos/1')).toThrow('Media outside bound server');
    expect(() => adapter.mediaURL('/other/Videos/1')).toThrow('Media outside bound server');
  });

  test('native playback URLs carry the token only as a query the host strips again', async () => {
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials(tokens('abc')));
    expect(await adapter.nativePlaybackURL('/jf/Videos/1/stream')).toBe('https://media.example/jf/Videos/1/stream?api_key=abc');
    expect(await adapter.mediaHeaders()).toEqual({ Authorization: 'MediaBrowser Token="abc"' });
  });
});

describe('JellyfinAdapter requests', () => {
  test('filmography is scoped to person and library', async () => {
    const seen = routeFetch({ 'GET /jf/Users/viewer-1/Items': { Items: [movie], TotalRecordCount: 2 } });
    const result = await new JellyfinAdapter(BASE, new FakeCredentials()).personTitles('p1', 'l1');
    expect(seen[0]!.url.searchParams.get('PersonIds')).toBe('p1');
    expect(seen[0]!.url.searchParams.get('ParentId')).toBe('l1');
    expect(result).toMatchObject({ items: [{ id: 'm1' }], nextCursor: '1' });
  });
  test('library recommendations and latest are scoped to the chosen library', async () => {
    const seen = routeFetch({
      'GET /jf/Users/viewer-1/Items/Latest': [movie],
      'GET /jf/Movies/Recommendations': [{ CategoryId: 'c1', BaselineItemName: 'Crime', Items: [movie] }],
    });
    const rows = await new JellyfinAdapter(BASE, new FakeCredentials()).libraryRows('l1', 'movies');
    expect(rows.map(row => [row.name, row.purpose, row.items[0]?.id])).toEqual([
      ['Recently Added', 'recentlyAdded', 'm1'], ['Crime', 'recommendation', 'm1'],
    ]);
    expect(seen.every(call => call.url.searchParams.get('ParentId') === 'l1')).toBe(true);
  });

  test('show recommendations use library-scoped next up and latest', async () => {
    const seen = routeFetch({ 'GET /jf/Users/viewer-1/Items/Latest': [episode], 'GET /jf/Shows/NextUp': { Items: [episode] } });
    const rows = await new JellyfinAdapter(BASE, new FakeCredentials()).libraryRows('l2', 'shows');
    expect(rows.map(row => row.purpose)).toEqual(['nextUp', 'recentlyAdded']);
    expect(seen.every(call => call.url.searchParams.get('ParentId') === 'l2')).toBe(true);
  });

  test('collections and genres use the selected library as parent', async () => {
    const seen = routeFetch({
      'GET /jf/Users/viewer-1/Items': { Items: [{ Id: 'set', Name: 'Noir', Type: 'BoxSet' }], TotalRecordCount: 1 },
      'GET /jf/Genres': { Items: [{ Id: 'g', Name: 'Crime' }] },
    });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    expect((await adapter.libraryCollections('l1')).items[0]).toMatchObject({ kind: 'collection', targetId: 'set' });
    expect(await adapter.libraryGenres('l1')).toEqual([{ id: 'Crime', label: 'Crime' }]);
    expect(seen.every(call => call.url.searchParams.get('ParentId') === 'l1')).toBe(true);
  });
  test('signs in by name without a token and maps the user', async () => {
    const seen = routeFetch({ 'POST /jf/Users/AuthenticateByName': { AccessToken: 'tok', User: { Id: 'u1', Name: 'Ana', PrimaryImageTag: 'av' } } });
    const credentials = new FakeCredentials(null);
    const result = await new JellyfinAdapter(BASE, credentials).signInWithPassword({ username: 'ana', password: 'pw', device: credentials.device, idempotencyKey: 'k' });
    expect(result).toMatchObject({ accessToken: 'tok', refreshToken: 'tok', expiresAt: '9999-12-31T23:59:59Z', viewer: { id: 'u1', name: 'Ana', policyRevision: 'jellyfin' } });
    expect(result.viewer.avatar?.sizes[0]?.url).toBe('https://media.example/jf/Items/u1/Images/Primary?tag=av');
    expect(seen[0]!.body).toEqual({ Username: 'ana', Pw: 'pw' });
    const authorization = seen[0]!.headers.get('authorization')!;
    expect(authorization).toContain('Client="Vela"');
    expect(authorization).toContain('DeviceId="device-test"');
    expect(authorization).not.toContain('Token=');
    expect(seen[0]!.headers.has('x-emby-token')).toBe(false);
  });

  test('search maps catalogue items to titles and drops unsupported kinds', async () => {
    const seen = routeFetch({ 'GET /jf/Users/viewer-1/Items': { Items: [movie, episode, { Id: 'f', Name: 'Folder', Type: 'Folder' }], TotalRecordCount: 10 } });
    const result = await new JellyfinAdapter(BASE, new FakeCredentials()).search({ query: 'heat', generation: 3, idempotencyKey: 'k', limit: 3 });
    expect(seen[0]!.url.searchParams.get('SearchTerm')).toBe('heat');
    expect(seen[0]!.url.searchParams.get('Limit')).toBe('3');
    expect(seen[0]!.headers.get('x-emby-token')).toBe('token-1');
    expect(result).toMatchObject({ query: 'heat', generation: 3, continuation: 'more', nextCursor: '3' });
    expect(result.items.map(t => t.id)).toEqual(['m1', 'e1']);
    const heat = result.items[0]!;
    expect(heat).toMatchObject({
      kind: 'movie', name: 'Heat', summary: 'LA crime.', year: 1995, genres: ['Crime'], durationSeconds: 10200, rating: 'R',
      ratings: [{ source: 'Community', kind: 'audience', value: 8.3, scale: 10 }, { source: 'Critic', kind: 'critic', value: 88, scale: 100 }],
      watch: { positionSeconds: 60, played: false, favorite: true, watchlisted: false },
    });
    expect(heat.artwork.map(a => [a.kind, a.sizes[0]!.url])).toEqual([
      ['poster', 'https://media.example/jf/Items/m1/Images/Primary?tag=p1'],
      ['logo', 'https://media.example/jf/Items/m1/Images/Logo?tag=l1'],
      ['backdrop', 'https://media.example/jf/Items/m1/Images/Backdrop/0?tag=b1'],
    ]);
    expect(result.items[1]).toMatchObject({ kind: 'episode', showId: 's1', seasonId: 'se1', seasonNumber: 1, episodeNumber: 2, summary: '', genres: [] });
  });

  test('detail summarises the played source and preserves its preferred audio and subtitle count', async () => {
    routeFetch({
      'GET /jf/Users/viewer-1/Items/m1': { ...movie, People: [{ Id: 'person-1', Name: 'Mara Vale', Type: 'Actor', Role: 'Commander' }], MediaSources: [{ Id: 'main', DefaultAudioStreamIndex: 2, MediaStreams: [
        { Index: 0, Type: 'Video', Width: 3840, Height: 2160, ColorTransfer: 'smpte2084', DvProfile: 8 },
        { Index: 1, Type: 'Audio', Codec: 'aac', Channels: 2, IsDefault: true },
        { Index: 2, Type: 'Audio', Codec: 'truehd', Channels: 8 },
        { Index: 3, Type: 'Subtitle' }, { Index: 4, Type: 'Subtitle' },
      ] }, { Id: 'alternate', MediaStreams: [{ Index: 0, Type: 'Subtitle' }] }] },
    });
    const result = await new JellyfinAdapter(BASE, new FakeCredentials()).detail('m1');
    expect(result.cast[0]).toMatchObject({ id: 'person-1', name: 'Mara Vale', role: 'Commander' });
    expect(result.mediaSummary).toMatchObject({
      video: [{ width: 3840, height: 2160, dolbyVisionProfile: 8 }],
      audio: [{ codec: 'aac' }, { codec: 'truehd', channels: 8, default: true }], subtitleCount: 2,
    });
    expect(result.mediaSummary!.audio[0]!.default).toBeUndefined();
  });

  test('continuation follows the record count', async () => {
    routeFetch({ 'GET /jf/Users/viewer-1/Items': { Items: [movie], TotalRecordCount: 4 } });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    expect(await adapter.search({ query: 'h', generation: 1, idempotencyKey: 'k', cursor: '3', limit: 1 })).toMatchObject({ continuation: 'exhausted' });
    routeFetch({ 'GET /jf/Users/viewer-1/Items': { Items: [movie] } });
    expect((await adapter.search({ query: 'h', generation: 1, idempotencyKey: 'k' })).continuation).toBe('unknown');
  });

  test.each(['-1', 'x', '1.5'])('refuses cursor %p before asking the server', async cursor => {
    const seen = routeFetch({});
    await expect(new JellyfinAdapter(BASE, new FakeCredentials()).search({ query: 'h', generation: 1, idempotencyKey: 'k', cursor })).rejects.toThrow('Invalid page');
    expect(seen).toHaveLength(0);
  });

  test('libraries map collection types and page locally', async () => {
    routeFetch({ 'GET /jf/Users/viewer-1/Views': { Items: [
      { Id: 'l1', Name: 'Films', CollectionType: 'movies' }, { Id: 'l2', Name: 'TV', CollectionType: 'tvshows' },
      { Id: 'l3', Name: 'Live', CollectionType: 'livetv' }, { Id: 'l4', Name: 'Other' },
    ] } });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    const first = await adapter.libraries({ limit: 3 });
    expect(first.items.map(l => [l.id, l.kind])).toEqual([['l1', 'movies'], ['l2', 'shows'], ['l3', 'live']]);
    expect(first).toMatchObject({ continuation: 'more', nextCursor: '3' });
    expect(first.items[0]!.browse.sorts.map(s => s.id)).toEqual(['title', 'added', 'released', 'year', 'rating', 'duration']);
    const rest = await adapter.libraries({ cursor: '3', limit: 3 });
    expect(rest.items.map(l => [l.id, l.kind])).toEqual([['l4', 'mixed']]);
    expect(rest.continuation).toBe('exhausted');
  });

  test('a rejected token ends the session', async () => {
    routeFetch({ 'GET /jf/Users/viewer-1/Views': new Response('', { status: 401 }) });
    const credentials = new FakeCredentials();
    let rejected = 0;
    const error = await new JellyfinAdapter(BASE, credentials, () => rejected++).libraries({}).catch(e => e);
    expect(error).toBeInstanceOf(VelaError);
    expect(error.status).toBe(401);
    expect(error.detail.class).toBe('auth');
    expect(credentials.current).toBeNull();
    expect(rejected).toBe(1);
  });

  test('other failures keep the session and classify the status', async () => {
    const credentials = new FakeCredentials();
    for (const [status, kind] of [[404, 'not-found'], [403, 'policy'], [500, 'request']] as const) {
      routeFetch({ 'GET /jf/Users/viewer-1/Views': new Response('', { status }) });
      const error = await new JellyfinAdapter(BASE, credentials).libraries({}).catch(e => e);
      expect(error.detail.class).toBe(kind);
    }
    expect(credentials.current).not.toBeNull();
  });

  test('signed-out catalogue reads fail without a request', async () => {
    const seen = routeFetch({});
    await expect(new JellyfinAdapter(BASE, new FakeCredentials(null)).libraries({})).rejects.toThrow('Sign in required');
    expect(seen).toHaveLength(0);
  });

  test('describe reports live TV only with a visible tuner or channels', async () => {
    const info = { Id: 'srv', ServerName: 'Home', Version: '10.9' };
    routeFetch({
      'GET /jf/System/Info/Public': info,
      'GET /jf/QuickConnect/Enabled': true,
      'GET /jf/LiveTv/Info': { IsEnabled: true, Services: [{ IsVisible: true, Tuners: ['t'] }] },
    });
    const adapter = new JellyfinAdapter(BASE, new FakeCredentials());
    const described = await adapter.describe();
    expect(described.server).toEqual({ id: 'srv', name: 'Home', version: '10.9' });
    expect(described.features.liveTV).toEqual({ available: true });
    expect(described.features.quickConnect).toEqual({ available: true });

    routeFetch({
      'GET /jf/System/Info/Public': info,
      'GET /jf/QuickConnect/Enabled': false,
      'GET /jf/LiveTv/Info': { IsEnabled: true, Services: [] },
      'GET /jf/LiveTv/Channels': { Items: [] },
    });
    const none = await adapter.describe();
    expect(none.features.liveTV?.available).toBe(false);
    expect(none.features.quickConnect?.available).toBe(false);
  });

  test('guide maps programmes and drops entries without times or a channel', async () => {
    const seen = routeFetch({ 'GET /jf/LiveTv/Programs': { Items: [
      { Id: 'p1', Name: 'News', ChannelId: 'c1', StartDate: '2026-03-10T12:00:00Z', EndDate: '2026-03-10T13:00:00Z', EpisodeTitle: 'Noon', Genres: ['News'], OfficialRating: 'TV-G' },
      { Id: 'p2', Name: 'No end', ChannelId: 'c1', StartDate: '2026-03-10T12:00:00Z' },
      { Id: 'p3', Name: 'No channel', StartDate: '2026-03-10T12:00:00Z', EndDate: '2026-03-10T13:00:00Z' },
    ], TotalRecordCount: 3 } });
    const result = await new JellyfinAdapter(BASE, new FakeCredentials()).guide({ from: '2026-03-10T00:00:00Z', until: '2026-03-11T00:00:00Z', channelIds: ['c1', 'c2'] });
    expect(seen[0]!.url.searchParams.get('ChannelIds')).toBe('c1,c2');
    expect(seen[0]!.url.searchParams.get('MinEndDate')).toBe('2026-03-10T00:00:00Z');
    expect(result.items).toEqual([{ id: 'p1', channelId: 'c1', name: 'News', summary: '', start: '2026-03-10T12:00:00Z', end: '2026-03-10T13:00:00Z',
      episodeTitle: 'Noon', seasonNumber: undefined, episodeNumber: undefined, artwork: [], rating: 'TV-G', genres: ['News'] }]);
    expect(result.continuation).toBe('exhausted');
  });

  test('channels use the channel number and channel artwork', async () => {
    routeFetch({ 'GET /jf/LiveTv/Channels': { Items: [{ Id: 'c1', Name: 'One', ChannelNumber: '4.1', ImageTags: { Primary: 'x' }, UserData: { IsFavorite: true } }], TotalRecordCount: 1 } });
    const page = await new JellyfinAdapter(BASE, new FakeCredentials()).channels();
    expect(page.items[0]).toMatchObject({ id: 'c1', number: '4.1', name: 'One', kind: 'tv', favorite: true });
    expect(page.items[0]!.artwork.map(a => a.kind)).toEqual(['channel']);
  });
});

test('Jellyfin and Emby episode primaries remain stills and series primaries supply posters', async () => {
  routeFetch({ 'GET /jf/Users/viewer-1/Items': { Items: [
    { ...episode, SeriesName: 'Severance', SeriesPrimaryImageTag: 'series-p', ImageTags: { Primary: 'still' } },
    { Id: 'se1', Name: 'Season 1', Type: 'Season', SeriesId: 's1', SeriesName: 'Severance', SeriesPrimaryImageTag: 'series-p', IndexNumber: 1, ImageTags: { Primary: 'season-p' } },
    { ...episode, Id: 'e2', ImageTags: { Primary: 'still-only' } },
  ], TotalRecordCount: 3 } });
  const { items } = await new JellyfinAdapter(BASE, new FakeCredentials()).search({ query: 'show', generation: 1, idempotencyKey: 'art' });
  expect(items[0]).toMatchObject({ showName: 'Severance', seasonNumber: 1, episodeNumber: 2 });
  expect(items[0]!.artwork.map(a => [a.kind, a.sizes[0]!.url])).toEqual([
    ['poster', `${BASE}/Items/s1/Images/Primary?tag=series-p`], ['still', `${BASE}/Items/e1/Images/Primary?tag=still`],
  ]);
  expect(items[1]).toMatchObject({ showName: 'Severance', seasonNumber: 1, episodeNumber: undefined });
  expect(items[1]!.artwork[0]!.sizes[0]!.url).toBe(`${BASE}/Items/s1/Images/Primary?tag=series-p`);
  expect(items[2]!.artwork.map(a => a.kind)).toEqual(['still']);
});
