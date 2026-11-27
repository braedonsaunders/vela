import { afterEach, expect, test } from 'bun:test';
import { PlexAdapter } from '../src/adapter/plex';
import { JellyfinAdapter } from '../src/adapter/jellyfin';
import { nativeConnection } from '../src/adapter/connection';
import { card, detailModel } from '../src/discovery/models';
import type * as V from '../src/wire';
import { FakeCredentials, device, restoreFetch, routeFetch, type Seen } from './helpers';

afterEach(restoreFetch);
const origin = 'https://media.example';
const plex = () => new PlexAdapter({ origin, credentials: new FakeCredentials(), clientIdentifier: device.id });
const jellyfin = () => new JellyfinAdapter(origin, new FakeCredentials());
const client: V.ClientCapabilities = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['vtt'], hls: true, mse: false };
const movie = { ratingKey: '10', type: 'movie', title: 'Movie', duration: 100000, viewOffset: 12000,
  Media: [{ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', Part: [{ id: 'part', key: '/library/parts/part/file.mp4', Stream: [] }] }] };
const jfMovie = { Id: '10', Type: 'Movie', Name: 'Movie', RunTimeTicks: 1000000000, UserData: { PlaybackPositionTicks: 120000000 } };
const noContent = () => new Response(null, { status: 204 });
const observation = (sequence: number, positionSeconds: number, state: V.PlayerObservation['state'] = 'playing'): V.PlayerObservation => ({
  sequence, positionSeconds, state, sourceGeneration: 0, seekGeneration: 0, selectedPathId: 'original', playableRanges: [], observedAt: new Date().toISOString(), idempotencyKey: `observation-${sequence}`,
});
const command = (kind: 'pause' | 'resume' | 'stop', key = kind) => ({ kind, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: key });

function plexRoutes() {
  return { 'GET /library/metadata/10': { MediaContainer: { Metadata: [movie] } }, 'POST /:/timeline': noContent,
    'PUT /:/scrobble': noContent, 'GET /video/:/transcode/universal/stop': noContent, 'GET /video/:/transcode/universal/decision': { MediaContainer: {} } };
}
function jfRoutes(direct = true) {
  return { 'GET /Users/viewer-1/Items/10': jfMovie, 'POST /Items/10/PlaybackInfo': { PlaySessionId: 'jf-session', MediaSources: [{
    Id: 'source', Container: 'mp4', SupportsDirectPlay: direct, SupportsDirectStream: !direct, RunTimeTicks: 1000000000,
    ...(!direct ? { DirectStreamUrl: '/Videos/10/stream.mp4' } : {}), MediaStreams: [],
  }] }, 'POST /Sessions/Playing': noContent, 'POST /Sessions/Playing/Progress': noContent, 'POST /Sessions/Playing/Stopped': noContent, 'DELETE /Videos/ActiveEncodings': noContent };
}

test('Plex reports identifiers, millisecond positions and state in order; partial stops do not scrobble', async () => {
  const seen = routeFetch(plexRoutes());
  const adapter = plex();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  expect(plan.positionSeconds).toBe(12);
  await Promise.all([
    adapter.reportObservation(plan.sessionId, observation(1, 23.5)),
    adapter.command(plan.sessionId, command('pause')),
    adapter.command(plan.sessionId, command('resume')),
    adapter.command(plan.sessionId, command('stop')),
    adapter.reportObservation(plan.sessionId, observation(2, 30)),
  ]);
  const reports = seen.filter(s => s.url.pathname === '/:/timeline');
  expect(reports.map(r => r.url.searchParams.get('state'))).toEqual(['playing', 'paused', 'playing', 'stopped']);
  for (const r of reports) {
    expect(r.method).toBe('POST');
    expect(Object.fromEntries(r.url.searchParams)).toMatchObject({ ratingKey: '10', key: '/library/metadata/10', time: '23500', duration: '100000', 'X-Plex-Session-Identifier': plan.sessionId });
    expect(r.headers.get('X-Plex-Client-Identifier')).toBe(device.id);
  }
  expect(seen.some(r => r.url.pathname === '/:/scrobble')).toBe(false);
  // A returned plan cannot be mutated into a completed title by the adapter's stop.
  expect(plan.state).toBe('ready');
  expect(plan.positionSeconds).toBe(12);
});

test('Plex completion reports the library identifier and rating key on the stopped timeline', async () => {
  const seen = routeFetch(plexRoutes());
  const adapter = plex();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  await Promise.all([adapter.reportObservation(plan.sessionId, observation(1, 100, 'ended')), adapter.reportObservation(plan.sessionId, observation(1, 100, 'ended'))]);
  const reports = seen.filter(r => r.url.pathname === '/:/timeline');
  expect(reports).toHaveLength(1);
  expect(reports[0]!.method).toBe('POST');
  expect(Object.fromEntries(reports[0]!.url.searchParams)).toMatchObject({
    key: '/library/metadata/10', ratingKey: '10', identifier: 'com.plexapp.plugins.library', state: 'stopped',
  });
});

test('Plex paused seeks stay paused and duplicate seek commands do not report twice', async () => {
  const seen = routeFetch(plexRoutes());
  const adapter = plex();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  await adapter.command(plan.sessionId, command('pause'));
  const seek = { kind: 'seek' as const, positionSeconds: 45, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'seek' };
  await Promise.all([adapter.command(plan.sessionId, seek), adapter.command(plan.sessionId, seek)]);
  expect(seen.filter(r => r.url.pathname === '/:/timeline').map(r => r.url.searchParams.get('state'))).toEqual(['paused', 'paused']);
});

test('Jellyfin/Emby start, progress, pause, resume and stop retain the session, media source and ticks', async () => {
  const seen = routeFetch(jfRoutes());
  const adapter = jellyfin();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  expect(plan.positionSeconds).toBe(12);
  await Promise.all([
    adapter.reportObservation(plan.sessionId, { ...observation(1, 23.5), audioTrackId: '2', subtitleTrackId: null }),
    adapter.command(plan.sessionId, command('pause')),
    adapter.command(plan.sessionId, command('resume')),
    adapter.command(plan.sessionId, command('stop')),
    adapter.reportObservation(plan.sessionId, observation(2, 30)),
  ]);
  const reports = seen.filter(s => s.url.pathname.startsWith('/Sessions/Playing'));
  expect(reports.map(r => r.url.pathname)).toEqual(['/Sessions/Playing', '/Sessions/Playing/Progress', '/Sessions/Playing/Progress', '/Sessions/Playing/Progress', '/Sessions/Playing/Stopped']);
  expect(reports.map(r => (r.body as any).IsPaused)).toEqual([false, false, true, false, false]);
  for (const r of reports) expect(r.body).toMatchObject({ ItemId: '10', MediaSourceId: 'source', PlaySessionId: 'jf-session', PositionTicks: 235000000, PlayMethod: 'DirectPlay', AudioStreamIndex: 2, SubtitleStreamIndex: -1 });
  expect(seen.some(r => r.method === 'DELETE')).toBe(false);
});

test('Jellyfin/Emby completion as the first observation still sends a start before stopped', async () => {
  const seen = routeFetch(jfRoutes(false));
  const adapter = jellyfin();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  await Promise.all([adapter.reportObservation(plan.sessionId, observation(1, 100, 'ended')), adapter.reportObservation(plan.sessionId, observation(2, 100, 'ended'))]);
  const reports = seen.filter(r => r.url.pathname.startsWith('/Sessions/Playing'));
  expect(reports.map(r => r.url.pathname)).toEqual(['/Sessions/Playing', '/Sessions/Playing/Stopped']);
  expect(reports[1]!.body).toMatchObject({ PlayMethod: 'DirectStream', PositionTicks: 1000000000 });
});

test('Jellyfin/Emby seek idempotency survives its own generation change', async () => {
  const seen = routeFetch(jfRoutes());
  const adapter = jellyfin();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  const seek = { kind: 'seek' as const, positionSeconds: 45, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'seek' };
  const [a, b] = await Promise.all([adapter.command(plan.sessionId, seek), adapter.command(plan.sessionId, seek)]);
  expect(a.seekGeneration).toBe(1);
  expect(b).toEqual(a);
  expect(seen.filter(r => r.url.pathname === '/Sessions/Playing/Progress')).toHaveLength(1);
});

test('Plex series load all episodes in number order, put specials last and use the server On Deck', async () => {
  const episode = (id: number, season: number, index: number) => ({ ratingKey: id, type: 'episode', title: `Episode ${id}`, parentIndex: season, index, parentRatingKey: season + 100, duration: 1800000, originallyAvailableAt: '2025-02-03' });
  const seen = routeFetch({
    'GET /library/metadata/show': { MediaContainer: { Metadata: [{ ratingKey: 'show', type: 'show', title: 'Show', OnDeck: { Metadata: [episode(3, 2, 1)] } }] } },
    'GET /library/metadata/show/children': { MediaContainer: { Metadata: [0, 2, 1].map(index => ({ ratingKey: index + 100, type: 'season', index, title: `Season ${index}` })) } },
    'GET /library/metadata/show/allLeaves': (r: Seen) => ({ MediaContainer: r.url.searchParams.get('X-Plex-Container-Start') === '0'
      ? { totalSize: 4, Metadata: [episode(0, 0, 1), episode(3, 2, 1)] }
      : { totalSize: 4, Metadata: [episode(2, 1, 2), episode(1, 1, 1)] } }),
  });
  const detail = await plex().detail('show');
  expect(detail.seasons?.map(t => t.seasonNumber)).toEqual([1, 2, 0]);
  expect(detail.episodes?.map(t => t.id)).toEqual(['1', '2', '3', '0']);
  expect(detail.nextUp?.id).toBe('3');
  expect(detail.episodes?.[0]).toMatchObject({ durationSeconds: 1800, airDate: '2025-02-03' });
  expect(seen[0]!.url.searchParams.get('includeOnDeck')).toBe('1');
});

test('Jellyfin/Emby series page loads seasons plus episodes and asks NextUp with the viewer and series', async () => {
  const episode = (id: number, season: number, index: number) => ({ Id: String(id), Name: `Episode ${id}`, Type: 'Episode', SeriesId: 'show', SeasonId: String(season + 100), ParentIndexNumber: season, IndexNumber: index, RunTimeTicks: 18000000000, PremiereDate: '2025-02-03T00:00:00Z' });
  const seen = routeFetch({
    'GET /Users/viewer-1/Items/show': { Id: 'show', Name: 'Show', Type: 'Series' },
    'GET /Shows/show/Seasons': { Items: [0, 2, 1].map(IndexNumber => ({ Id: String(IndexNumber + 100), Name: 'Season', Type: 'Season', IndexNumber })) },
    'GET /Shows/show/Episodes': { Items: [episode(0, 0, 1), episode(3, 2, 1), episode(2, 1, 2), episode(1, 1, 1)] },
    'GET /Shows/NextUp': { Items: [episode(3, 2, 1)] },
  });
  const detail = await jellyfin().detail('show');
  expect(detail.seasons?.map(t => t.seasonNumber)).toEqual([1, 2, 0]);
  expect(detail.episodes?.map(t => t.id)).toEqual(['1', '2', '3', '0']);
  expect(detail.nextUp?.id).toBe('3');
  expect(detail.episodes?.[0]).toMatchObject({ durationSeconds: 1800, airDate: '2025-02-03' });
  expect(Object.fromEntries(seen.find(r => r.url.pathname === '/Shows/NextUp')!.url.searchParams)).toMatchObject({ UserId: 'viewer-1', SeriesId: 'show', EnableResumable: 'true' });
});

test('Plex artwork supports clear logos, inherited backdrops and proxy sizing for people and collection composites', async () => {
  routeFetch({
    'GET /library/metadata/10': { MediaContainer: { Metadata: [{ ...movie, grandparentArt: '/library/metadata/show/art', clearLogo: '/library/metadata/10/clearLogo', Role: [{ tag: 'Actor', thumb: 'https://images.example/person.jpg' }] }] } },
    'GET /security/token': { token: 'transient-art' },
    'GET /library/collections/1': { MediaContainer: { Metadata: [{ title: 'Collection', composite: '/playlists/1/composite' }] } },
    'GET /library/collections/1/children': { MediaContainer: { Metadata: [], totalSize: 0 } },
  });
  const adapter = plex();
  const detail = await adapter.detail('10');
  expect(detail.title.artwork.map(a => a.kind)).toEqual(['backdrop', 'logo']);
  const connection = nativeConnection({ id: 'p', kind: 'plex', name: 'Plex', origin, basePath: '/' }, new FakeCredentials(), () => {});
  const images = await connection.images();
  const model = detailModel(detail, images);
  expect(model.title[0]!.logo).toContain('/photo/:/transcode');
  expect(new URL(model.castPeople[0]!.portrait).searchParams.get('url')).toBe('https://images.example/person.jpg');
  const collectionArt = (await adapter.collection('1')).collection.artwork;
  expect(card({ ...detail.title, artwork: collectionArt }, '', images).poster).toContain('/photo/:/transcode');
});

test('Jellyfin/Emby inherit parent backdrops and logos and preserve people portraits', async () => {
  routeFetch({ 'GET /Users/viewer-1/Items/episode': { Id: 'episode', Name: 'Episode', Type: 'Episode',
    ParentBackdropItemId: 'show', ParentBackdropImageTags: ['bg'], ParentLogoItemId: 'show', ParentLogoImageTag: 'logo',
    People: [{ Id: 'actor', Name: 'Actor', Type: 'Actor', PrimaryImageTag: 'face' }], ImageTags: { Primary: 'still' },
  } });
  const detail = await jellyfin().detail('episode');
  expect(detail.title.artwork.map(a => [a.kind, a.sizes[0]?.url])).toEqual([
    ['still', `${origin}/Items/episode/Images/Primary?tag=still`], ['logo', `${origin}/Items/show/Images/Logo?tag=logo`], ['backdrop', `${origin}/Items/show/Images/Backdrop/0?tag=bg`],
  ]);
  expect(detail.cast[0]!.artwork?.sizes[0]?.url).toBe(`${origin}/Items/actor/Images/Primary?tag=face`);
});

test('Plex resume and watched state come back from subsequent server reads', async () => {
  let position = 12000, played = false;
  routeFetch({ ...plexRoutes(),
    'GET /library/metadata/10': () => ({ MediaContainer: { Metadata: [{ ...movie, viewOffset: position, viewCount: played ? 1 : 0 }] } }),
    'POST /:/timeline': (r: Seen) => {
      position = Number(r.url.searchParams.get('time'));
      if (r.url.searchParams.get('state') === 'stopped' && position === movie.duration) { played = true; position = 0; }
      return noContent();
    },
    'GET /hubs': () => ({ MediaContainer: { Hub: [{ title: 'Continue', key: '/hubs/home/continueWatching', Metadata: played ? [] : [{ ...movie, viewOffset: position }] }] } }),
  });
  const adapter = plex();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  await adapter.reportObservation(plan.sessionId, observation(1, 34));
  await adapter.command(plan.sessionId, command('stop'));
  expect((await adapter.detail('10')).title.watch?.positionSeconds).toBe(34);
  const resumed = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'resume-start' });
  expect(resumed.positionSeconds).toBe(34);
  await adapter.reportObservation(resumed.sessionId, observation(1, 100, 'ended'));
  expect((await adapter.detail('10')).title.watch).toMatchObject({ played: true, positionSeconds: 0 });
  expect((await adapter.rows({})).items).toHaveLength(0);
});

test('Jellyfin/Emby resume and watched state come back from subsequent server reads', async () => {
  let position = 120000000, played = false;
  routeFetch({ ...jfRoutes(),
    'GET /Users/viewer-1/Items/10': () => ({ ...jfMovie, UserData: { PlaybackPositionTicks: position, Played: played } }),
    'POST /Sessions/Playing/Stopped': (r: Seen) => { position = (r.body as any).PositionTicks; played = position >= 1000000000; if (played) position = 0; return noContent(); },
  });
  const adapter = jellyfin();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  await adapter.reportObservation(plan.sessionId, observation(1, 34));
  await adapter.command(plan.sessionId, command('stop'));
  expect((await adapter.detail('10')).title.watch?.positionSeconds).toBe(34);
  const resumed = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'resume-start' });
  expect(resumed.positionSeconds).toBe(34);
  await adapter.reportObservation(resumed.sessionId, observation(1, 100, 'ended'));
  expect((await adapter.detail('10')).title.watch).toMatchObject({ played: true, positionSeconds: 0 });
});

test('live channel logos reach channel artwork for both native-server families', async () => {
  routeFetch({
    'GET /identity': { MediaContainer: { machineIdentifier: 'plex' } },
    'GET /livetv/dvrs': { MediaContainer: { Dvr: [{ key: 'dvr' }] } },
    'GET /media/providers': { MediaContainer: { MediaProvider: [{ Feature: [{ type: 'grid', key: '/grid' }] }] } },
    'GET /lineups/dvr/channels': { MediaContainer: { Channel: [{ id: 'channel', title: 'One', logo: 'https://images.example/channel.png' }] } },
    'GET /LiveTv/Channels': { Items: [{ Id: 'channel', Name: 'One', ImageTags: { Primary: 'thumb', Logo: 'logo' } }] },
  });
  expect((await plex().channels()).items[0]?.artwork[0]?.sizes[0]?.url).toBe('https://images.example/channel.png');
  expect((await jellyfin().channels()).items[0]?.artwork[0]?.sizes[0]?.url).toBe(`${origin}/Items/channel/Images/Logo?tag=logo`);
});

test('Plex changes direct tracks through the capability and exposes SRT sidecars as WebVTT', async () => {
  const { sendCommand } = await import('../src/adapter/commands');
  const tracked = { ...movie, Media: [{ ...movie.Media[0], Part: [{ ...movie.Media[0]!.Part[0], Stream: [
    { id: 1, index: 1, streamType: 2, codec: 'aac', selected: true },
    { id: 2, index: 2, streamType: 2, codec: 'aac' },
    { id: 3, streamType: 3, codec: 'srt', key: '/library/streams/3.srt' },
  ] }] }] };
  const seen = routeFetch({ ...plexRoutes(), 'GET /library/metadata/10': { MediaContainer: { Metadata: [tracked] } }, 'PUT /library/parts/part': noContent,
    'GET /library/streams/3.srt': () => new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA subtitle\n', { headers: { 'Content-Type': 'text/vtt' } }),
  });
  const adapter = plex();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  expect(plan.subtitleTracks[0]!.delivery).toMatchObject({ kind: 'external', format: 'webvtt', url: `${origin}/library/streams/3.srt?format=vtt` });
  const subtitle = await fetch(plan.subtitleTracks[0]!.url!, { headers: await adapter.mediaHeaders() });
  expect(await subtitle.text()).toContain('WEBVTT');
  const change = { kind: 'tracks' as const, audioTrackId: '2', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'tracks' };
  const next = await sendCommand(adapter, plan.sessionId, change);
  expect(next).toMatchObject({ selectedAudioTrackId: '2', selectedSubtitleTrackId: '3', selectedPathId: 'original', sourceGeneration: 0 });
  expect(Object.fromEntries(seen.find(r => r.method === 'PUT')!.url.searchParams)).toEqual({ audioStreamID: '2', subtitleStreamID: '3', allParts: '1' });
  await sendCommand(adapter, plan.sessionId, change);
  expect(seen.filter(r => r.method === 'PUT')).toHaveLength(1);
  await sendCommand(adapter, plan.sessionId, { ...change, idempotencyKey: 'off', audioTrackId: undefined, subtitleTrackId: null });
  expect(seen.at(-1)!.url.searchParams.get('subtitleStreamID')).toBe('0');
  await expect(sendCommand(adapter, plan.sessionId, { ...change, idempotencyKey: 'invalid', audioTrackId: '99' })).rejects.toThrow('Unknown Plex audio track');
});

test('Plex transcode track changes restart at the observed offset with a new source generation', async () => {
  const tracked = { ...movie, Media: [{ ...movie.Media[0], Part: [{ ...movie.Media[0]!.Part[0], Stream: [
    { id: 1, index: 1, streamType: 2, codec: 'aac' }, { id: 2, index: 2, streamType: 2, codec: 'aac' }, { id: 3, index: 3, streamType: 3, codec: 'pgs' },
  ] }] }] };
  const seen = routeFetch({ ...plexRoutes(), 'GET /library/metadata/10': { MediaContainer: { Metadata: [tracked] } }, 'PUT /library/parts/part': noContent });
  const adapter = plex();
  const plan = await adapter.startPlayback({ titleId: '10', client: { ...client, containers: [] }, idempotencyKey: 'start' });
  await adapter.reportObservation(plan.sessionId, observation(1, 42, 'paused'));
  const next = await adapter.changeTracks(plan.sessionId, { kind: 'tracks', audioTrackId: '2', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'tracks' });
  expect(next).toMatchObject({ sourceGeneration: 1, positionSeconds: 42, state: 'paused', selectedSubtitleTrackId: '3' });
  const path = next.paths.find(p => p.id === next.selectedPathId)!;
  const url = new URL(path.url!);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ offset: '42', audioStreamID: '2', subtitleStreamID: '3' });
  expect(url.searchParams.get('session')).not.toBe(plan.sessionId);
  expect(path.timelineOriginSeconds).toBe(42);
  expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(true);
  // Each new transcode is asked a decision for first, with the transcode's own session.
  const decided = seen.filter(r => r.url.pathname.endsWith('/decision')).map(r => r.url.searchParams.get('session'));
  expect(decided).toEqual([plan.sessionId, url.searchParams.get('session')]);
});

for (const direct of [true, false]) test(`Jellyfin/Emby mid-play track changes (${direct ? 'direct' : 'transcode'})`, async () => {
  const { sendCommand } = await import('../src/adapter/commands');
  let decisions = 0;
  const source = { Id: 'source', Container: 'mp4', SupportsDirectPlay: direct, SupportsDirectStream: false, MediaStreams: [
    { Index: 1, Type: 'Audio', Codec: 'aac' }, { Index: 2, Type: 'Audio', Codec: 'aac' }, { Index: 3, Type: 'Subtitle', Codec: 'srt', IsTextSubtitleStream: true },
  ], ...(!direct ? { TranscodingUrl: '/Videos/10/master.m3u8?AudioStreamIndex=1' } : {}) };
  const seen = routeFetch({ ...jfRoutes(), 'POST /Items/10/PlaybackInfo': (r: Seen) => {
    decisions++;
    return { PlaySessionId: decisions === 1 ? 'jf-session' : 'jf-restart', MediaSources: [{ ...source,
      ...(!direct && decisions > 1 ? { TranscodingUrl: '/Videos/10/master.m3u8?AudioStreamIndex=2&SubtitleStreamIndex=3&StartTimeTicks=420000000' } : {}) }] };
  } });
  const adapter = jellyfin();
  const plan = await adapter.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  await adapter.reportObservation(plan.sessionId, observation(1, 42, 'paused'));
  const change = { kind: 'tracks' as const, audioTrackId: '2', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'tracks' };
  const next = await sendCommand(adapter, plan.sessionId, change);
  expect(next).toMatchObject({ selectedAudioTrackId: '2', selectedSubtitleTrackId: '3', positionSeconds: 42, state: 'paused', sourceGeneration: direct ? 0 : 1 });
  expect(decisions).toBe(direct ? 1 : 2);
  if (!direct) {
    expect(seen.filter(r => r.url.pathname.endsWith('/PlaybackInfo')).at(-1)!.body).toMatchObject({ AudioStreamIndex: 2, SubtitleStreamIndex: 3, StartTimeTicks: 420000000 });
    expect(next.paths[0]!.timelineOriginSeconds).toBe(42);
    expect(seen.find(r => r.method === 'DELETE')!.url.searchParams.get('PlaySessionId')).toBe('jf-session');
  }
  expect(seen.filter(r => r.url.pathname.endsWith('/Progress')).at(-1)!.body).toMatchObject({ AudioStreamIndex: 2, SubtitleStreamIndex: 3, IsPaused: true });
  await sendCommand(adapter, plan.sessionId, change);
  expect(decisions).toBe(direct ? 1 : 2);
});
