import { afterEach, describe, expect, test } from 'bun:test';
import { stopSessionsOnPageHide } from '../src/store/unload';

import { libraryExperience } from '../src/library-presentation';
import { PlexAdapter } from '../src/adapter/plex';
import { partAt, plexProjection } from '../src/adapter/plex/media';
import { VelaError } from '../src/adapter/errors';
import { FakeCredentials, restoreFetch, routeFetch, type Seen } from './helpers';

afterEach(restoreFetch);

// Shapes recorded from Plex Media Server 1.43.5 with music, an audiobooks music section, photos
// and a movie stacked from two files (trimmed to the fields the adapter reads).
const ORIGIN = 'https://plex.example:32400';
const plex = () => new PlexAdapter({ origin: ORIGIN, credentials: new FakeCredentials(), clientIdentifier: 'client-1' });
const sections = { MediaContainer: { Directory: [{ key: 1, type: 'movie', title: 'Movies' }, { key: 2, type: 'artist', title: 'Music' }, { key: 3, type: 'artist', title: 'Audiobooks' }, { key: 4, type: 'photo', title: 'Photos' }] } };
const album = { ratingKey: '8', type: 'album', title: 'Northern Static', parentRatingKey: '7', parentTitle: 'Aurora Lines', year: 2019, leafCount: 3, thumb: '/library/metadata/8/thumb/1' };
const track = { ratingKey: '9', type: 'track', title: 'Opening', index: 1, parentIndex: 1, parentRatingKey: '8', grandparentRatingKey: '7', parentTitle: 'Northern Static', grandparentTitle: 'Aurora Lines',
  duration: 25051, Media: [{ id: 5, container: 'mp3', audioCodec: 'mp3', Part: [{ id: 6, key: '/library/parts/6/1795467461/file.mp3', container: 'mp3', size: 407566, duration: 25051 }] }] };
const twofold = { ratingKey: '1', type: 'movie', title: 'Twofold', duration: 60000, Media: [{ id: 1, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', duration: 60000,
  Part: [{ id: 1, key: '/library/parts/1/1/file.mp4', duration: 30000 }, { id: 2, key: '/library/parts/2/1/file.mp4', duration: 30000 }] }] };
const client = { device: { id: 'd', name: 'd', platform: 'web', appVersion: '1' }, containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [], hls: true, mse: true } as never;
/** Lets detached work (a stop not waited for, and the timeline after it) run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Plex media classes', () => {
  test('music maps to artists, albums and tracks; a section named for audiobooks holds books and their parts', () => {
    expect(plexProjection(album)).toEqual({ kind: 'season', media: { class: 'music', role: 'album', childCount: 3,
      parents: [{ id: '7', name: 'Aurora Lines', role: 'artist' }], credits: [{ name: 'Aurora Lines', role: 'albumArtist' }] } });
    expect(plexProjection(track)?.media).toMatchObject({ class: 'music', role: 'track', index: 1, disc: 1,
      parents: [{ id: '8', role: 'album' }, { id: '7', role: 'artist' }] });
    expect(plexProjection(album, true)).toEqual({ kind: 'show', media: { class: 'audiobook', role: 'audiobook', childCount: 3, credits: [{ name: 'Aurora Lines', role: 'author' }] } });
    expect(plexProjection(track, true)?.media).toMatchObject({ class: 'audiobook', role: 'part', parents: [{ id: '8', role: 'audiobook' }] });
  });

  test('a photo with media is a photo title; an album of photos is not a title', () => {
    expect(plexProjection({ type: 'photo', title: 'IMG_0001', Media: [{ width: 1600, height: 1066, Part: [{}] }] })).toEqual({ kind: 'movie', media: { class: 'photo', role: 'item', facts: [{ label: 'Size', value: '1600 × 1066' }] } });
    expect(plexProjection({ type: 'photo', title: 'Lake Weekend' })).toBeUndefined();
    expect(plexProjection({ type: 'clip', title: 'VID_0001' })).toEqual({ kind: 'movie' });
  });

  test('a position on a stacked title falls in one part', () => {
    const parts = twofold.Media[0]!.Part;
    expect(partAt(parts, 0)).toEqual({ index: 0, offset: 0, inPart: 0 });
    expect(partAt(parts, 42)).toEqual({ index: 1, offset: 30, inPart: 12 });
  });
});

describe('Plex media sections', () => {
  test('music, audiobook and photo sections are listed with their tabs; tabs read albums, artists and songs', async () => {
    const seen = routeFetch({ 'GET /library/sections': sections, 'GET /library/sections/2/all': { MediaContainer: { Metadata: [album], totalSize: 1, librarySectionID: 2 } } });
    const adapter = plex();
    const libraries = (await adapter.libraries({})).items;
    expect(libraries.map(l => [l.name, l.media, l.presentation?.card, l.tabs?.map(t => t.level ?? t.id)])).toEqual([
      ['Movies', undefined, undefined, undefined],
      ['Music', 'music', 'square', ['recommended', 'albums', 'artist', 'track']],
      ['Audiobooks', 'audiobook', 'square', ['recommended', 'library', 'artist']],
      ['Photos', 'photo', 'square', ['recommended', 'library', 'item', 'album']],
    ]);
    // Plex has no features.libraryExperiences: each library opens in its experience by class.
    expect(libraries.map(l => libraryExperience(l, undefined))).toEqual(['watch', 'listen', 'listen', 'gallery']);
    const types: (string | null)[] = [];
    for (const tab of [undefined, 'artists', 'tracks']) {
      await adapter.library('2', { tab });
      types.push(seen.at(-1)!.url.searchParams.get('type'));
    }
    expect(types).toEqual(['9', '8', '10']);
  });

  test('an album of photos opens as a directory of its photos and clips', async () => {
    routeFetch({
      'GET /library/sections': sections,
      'GET /library/sections/4/all': { MediaContainer: { Metadata: [{ ratingKey: '26', type: 'photo', title: 'Lake Weekend', thumb: '/library/metadata/26/thumb/1' }], librarySectionID: 4 } },
      'GET /library/metadata/26': { MediaContainer: { Metadata: [{ ratingKey: '26', type: 'photo', title: 'Lake Weekend' }] } },
      'GET /library/metadata/26/children': { MediaContainer: { totalSize: 2, Metadata: [
        { ratingKey: '27', type: 'photo', title: 'IMG_0001', Media: [{ width: 1600, height: 1066, Part: [{ key: '/library/parts/18/1/file.jpg' }] }] },
        { ratingKey: '30', type: 'clip', title: 'VID_0001', duration: 15000, Media: [{ Part: [{ key: '/library/parts/21/1/file.mp4' }] }] }] } },
    });
    const adapter = plex();
    await adapter.libraries({});
    const root = await adapter.library('4', {});
    expect(root.items[0]).toMatchObject({ kind: 'directory', targetId: 'album:26', name: 'Lake Weekend' });
    const contents = await adapter.collection('album:26');
    expect(contents.items.map(e => e.kind === 'title' ? [e.title.name, e.title.media?.class ?? 'video'] : [])).toEqual([['IMG_0001', 'photo'], ['VID_0001', 'video']]);
  });

  test('an artist\'s children are its albums, newest first', async () => {
    routeFetch({ 'GET /library/sections': sections, 'GET /library/metadata/7/children': { MediaContainer: { librarySectionID: 2, Metadata: [album, { ...album, ratingKey: '12', title: 'Second Light', year: 2021 }] } } });
    const page = await plex().children('7');
    expect(page.items.map(t => [t.name, t.media?.role])).toEqual([['Second Light', 'album'], ['Northern Static', 'album']]);
  });
});

describe('Plex audio and stacked titles', () => {
  test('a track plays as its file when every player decodes it, else as the server\'s MP3 stream', async () => {
    routeFetch({ 'GET /library/sections': sections, 'GET /library/metadata/9': { MediaContainer: { librarySectionID: 2, Metadata: [track] } } });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '9', client, idempotencyKey: 'a' } as never);
    expect(plan).toMatchObject({ media: 'audio', durationSeconds: 25.051, paths: [{ kind: 'direct', transport: 'file', mimeType: 'audio/mpeg', url: `${ORIGIN}/library/parts/6/1795467461/file.mp3` }] });
    routeFetch({ 'GET /library/sections': sections, 'GET /library/metadata/9': { MediaContainer: { Metadata: [{ ...track, Media: [{ ...track.Media[0], container: 'ogg' }] }] } } });
    const transcoded = await adapter.startPlayback({ titleId: '9', client, idempotencyKey: 'b' } as never);
    const url = new URL(transcoded.paths[0]!.url!);
    expect([transcoded.paths[0]!.kind, url.pathname, url.searchParams.get('protocol')]).toEqual(['transcode', '/music/:/transcode/universal/start.mp3', 'http']);
  });

  test('a movie in two parts plays them in turn on one timeline, and a seek moves between them', async () => {
    const seen = routeFetch({
      'GET /library/metadata/1': { MediaContainer: { Metadata: [twofold] } },
      'POST /:/timeline': {}, 'GET /video/:/transcode/universal/stop': {}, 'PUT /:/scrobble': {}, 'GET /video/:/transcode/universal/decision': {},
    });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'm', positionSeconds: 0 } as never);
    const part = (p: typeof plan) => { const u = new URL(p.paths[0]!.url!); return [p.paths[0]!.transport, u.searchParams.get('partIndex'), u.searchParams.get('offset'), p.paths[0]!.timelineOriginSeconds]; };
    expect(plan.durationSeconds).toBe(60);
    expect(plan.paths).toHaveLength(1);
    expect(part(plan)).toEqual(['hls', '0', '0', 0]);
    // The first part ends: the session moves on to the second without ending or being marked watched.
    await adapter.reportObservation(plan.sessionId, { sequence: 1, state: 'ended', positionSeconds: 30, sourceGeneration: 0, seekGeneration: 0 } as never);
    const next = (await adapter.sessionSnapshot(plan.sessionId)).plan;
    expect([next.state, next.sourceGeneration, next.positionSeconds]).toEqual(['playing', 1, 30]);
    expect(part(next)).toEqual(['hls', '1', '0', 30]);
    expect(seen.some(r => r.url.pathname === '/:/scrobble')).toBe(false);
    // A seek back into the first part restarts its stream there.
    const back = await adapter.command(plan.sessionId, { kind: 'seek', positionSeconds: 12, idempotencyKey: 's', sourceGeneration: 1, seekGeneration: 0 });
    expect(part(back)).toEqual(['hls', '0', '12', 12]);
    // The last part's end is the title's end.
    await adapter.command(plan.sessionId, { kind: 'seek', positionSeconds: 50, idempotencyKey: 's2', sourceGeneration: back.sourceGeneration, seekGeneration: back.seekGeneration });
    const last = (await adapter.sessionSnapshot(plan.sessionId)).plan;
    await adapter.reportObservation(plan.sessionId, { sequence: 2, state: 'ended', positionSeconds: 60, sourceGeneration: last.sourceGeneration, seekGeneration: last.seekGeneration } as never);
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan.state).toBe('ended');
    expect(seen.some(r => r.url.pathname === '/:/scrobble')).toBe(false);
    expect(seen.filter(r => r.url.pathname === '/:/timeline' && r.url.searchParams.get('state') === 'stopped').map(r => r.url.searchParams.get('time'))).toEqual(['60000']);
  });

  test('a stacked title needs the server\'s stream', async () => {
    routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [twofold] } } });
    await expect(plex().startPlayback({ titleId: '1', client, idempotencyKey: 'x', allowTranscode: false } as never)).rejects.toThrow('several parts');
  });
});

describe('Plex watchlist', () => {
  const DISCOVER = 'https://discover.provider.plex.tv';
  const heat = { ratingKey: '10', type: 'movie', title: 'Heat', guid: 'plex://movie/5d776b59ad5437001f79c6f8', Media: [{ id: 1, Part: [{ id: 1 }] }] };
  /** Plex's own and plex.tv's discover answers on one routed fetch (paths are distinct). */
  function route(account: boolean, onWatchlist: boolean) {
    const seen: { method: string; url: URL }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const method = init?.method ?? 'GET';
      seen.push({ method, url });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.origin === DISCOVER) {
        if (!account) return json({}, 401);
        if (url.pathname === '/library/sections/watchlist/all') return json({ MediaContainer: { Metadata: [{ guid: heat.guid, type: 'movie', title: 'Heat' }, { guid: 'plex://movie/elsewhere', type: 'movie' }] } });
        if (url.pathname.endsWith('/userState')) return json({ MediaContainer: { UserState: onWatchlist ? [{ watchlistedAt: 1700000000 }] : [{}] } });
        if (url.pathname.startsWith('/actions/')) return json({});
      }
      if (url.pathname === '/library/metadata/10') return json({ MediaContainer: { Metadata: [heat] } });
      if (url.pathname === '/hubs') return json({ MediaContainer: { Hub: [] } });
      if (url.pathname === '/library/all') return json({ MediaContainer: { Metadata: url.searchParams.get('guid') === heat.guid ? [heat] : [] } });
      return json({}, 404);
    }) as typeof fetch;
    return { seen, restore: () => { globalThis.fetch = real; } };
  }

  test('the server\'s owner (whose token is the account\'s) sees, adds to and removes from the watchlist', async () => {
    const r = route(true, true);
    try {
      const adapter = plex();
      const actions = await adapter.titleActions('10');
      expect([actions.watchlist, actions.favorite, actions.watch.watchlisted]).toEqual([true, false, true]);
      await adapter.setTitleWatch('10', { idempotencyKey: 'w', watchlisted: false });
      expect(r.seen.at(-1)).toMatchObject({ method: 'PUT', url: new URL(`${DISCOVER}/actions/removeFromWatchlist?ratingKey=5d776b59ad5437001f79c6f8`) });
      // Home carries the watchlist as far as this server holds it.
      const rows = await adapter.rows({});
      expect(rows.items.map(row => [row.name, row.items.map(e => e.id)])).toEqual([['Watchlist', ['10']]]);
    } finally { r.restore(); }
  });

  test('anyone else\'s token is refused by plex.tv and the watchlist stays hidden', async () => {
    const r = route(false, false);
    try {
      const adapter = plex();
      expect((await adapter.titleActions('10')).watchlist).toBe(false);
      await expect(adapter.setTitleWatch('10', { idempotencyKey: 'w', watchlisted: true })).rejects.toThrow('watchlist is unavailable');
      expect((await adapter.rows({})).items).toEqual([]);
    } finally { r.restore(); }
  });
});

describe('Plex transcode decisions', () => {
  // Plex's own clients ask /decision before the stream; Ether refuses a video start.m3u8 it was not asked one for.
  const single = { ratingKey: '3', type: 'movie', title: 'Single', duration: 60000, Media: [{ id: 3, container: 'mkv', videoCodec: 'h264', audioCodec: 'ac3', duration: 60000,
    Part: [{ id: 3, key: '/library/parts/3/1/file.mkv', duration: 60000 }] }] };
  const mp4 = { ...single, Media: [{ ...single.Media[0]!, container: 'mp4', audioCodec: 'aac' }] };

  test('the stream is offered only after the server was asked its decision for that very stream', async () => {
    const seen = routeFetch({ 'GET /library/metadata/3': { MediaContainer: { Metadata: [single] } }, 'GET /video/:/transcode/universal/decision': { MediaContainer: {} } });
    const plan = await plex().startPlayback({ titleId: '3', client, idempotencyKey: 'd' } as never);
    const stream = new URL(plan.paths[0]!.url!);
    expect(stream.pathname).toBe('/video/:/transcode/universal/start.m3u8');
    const decision = seen.find(r => r.url.pathname === '/video/:/transcode/universal/decision')!;
    expect(Object.fromEntries(decision.url.searchParams)).toEqual(Object.fromEntries(stream.searchParams));
    expect(decision.headers.get('X-Plex-Token')).toBe('token-1');
  });

  test('the accepted decision fills sparse track menus and the new ASS track can be burned in', async () => {
    const media = single.Media[0]!;
    const part = media.Part[0]!;
    const metadataAudio = { id: 31, index: 1, streamType: 2, codec: 'ac3', displayTitle: 'Japanese (metadata)' };
    const ass = { id: 33, index: 3, streamType: '3', codec: 'ass', displayTitle: 'English (ASS)' };
    const decisionPath = '/video/:/transcode/universal/decision';
    const seen = routeFetch({
      'GET /library/metadata/3': { MediaContainer: { Metadata: [{ ...single, Media: [{ ...media, Part: [{ ...part, Stream: [metadataAudio, { ...metadataAudio, id: '31' }] }] }] }] } },
      [`GET ${decisionPath}`]: { MediaContainer: { Metadata: [{ Media: [{ Part: [{ Stream: [
        { ...metadataAudio, codec: 'aac', displayTitle: 'Japanese (decision)' },
        { id: '32', index: 2, streamType: '2', codec: 'aac', displayTitle: 'English audio' },
        ass, { ...ass, id: '33', displayTitle: 'Duplicate' },
        { streamType: 3, codec: 'ass' },
      ] }] }] }] } },
      'PUT /library/parts/3': {}, 'GET /video/:/transcode/universal/stop': {},
    });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'tracks' } as never);
    expect(plan.audioTracks.map(t => [t.id, t.name, t.codec])).toEqual([
      ['31', 'Japanese (metadata)', 'ac3'], ['32', 'English audio', 'aac'],
    ]);
    expect(plan.subtitleTracks).toMatchObject([{ id: '33', name: 'English (ASS)', codec: 'ass', delivery: { kind: 'burn-in' } }]);
    expect(plan.subtitleTracks).toHaveLength(1);
    expect(plan.selectedSubtitleTrackId).toBeNull();

    const updated = await adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '33', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'burn' });
    expect(updated.selectedSubtitleTrackId).toBe('33');
    expect(updated.subtitleTracks).toEqual(plan.subtitleTracks);
    const requests = seen.filter(r => r.url.pathname === decisionPath);
    expect(requests.map(r => [r.url.searchParams.get('subtitleStreamID'), r.url.searchParams.get('subtitles')])).toEqual([['0', 'auto'], ['33', 'burn']]);
  });

  test('a refused decision fails the start, unless the original file can play instead', async () => {
    routeFetch({ 'GET /library/metadata/3': { MediaContainer: { Metadata: [single] } }, 'GET /video/:/transcode/universal/decision': new Response('', { status: 400 }) });
    await expect(plex().startPlayback({ titleId: '3', client, idempotencyKey: 'r' } as never)).rejects.toThrow('Plex request failed (400)');
    routeFetch({ 'GET /library/metadata/3': { MediaContainer: { Metadata: [mp4] } }, 'GET /video/:/transcode/universal/decision': new Response('', { status: 400 }) });
    const plan = await plex().startPlayback({ titleId: '3', client, idempotencyKey: 'o' } as never);
    // The original plays; the stream beside it is decided (and refused) only if it is switched to.
    expect(plan.paths.map(p => [p.id, p.readiness])).toEqual([['original', 'ready'], ['plex-hls', 'on-demand']]);
  });
});

describe('Plex stream beside a playable original', () => {
  // The web client plays this MP4 as its file; the server's stream is offered but decided only when needed.
  const mp4 = { ratingKey: '3', type: 'movie', title: 'Single', duration: 60000, Media: [{ id: 3, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', duration: 60000,
    Part: [{ id: 3, key: '/library/parts/3/1/file.mp4', duration: 60000, Stream: [{ id: 31, index: 1, streamType: 2, codec: 'aac', selected: true }, { id: 32, index: 2, streamType: 3, codec: 'pgs' }, { id: 33, index: 3, streamType: 3, codec: 'pgs' }] }] }] };
  const decision = { MediaContainer: { generalDecisionCode: 1001, Metadata: [{ Media: [{ bitrate: 3800, width: 1280, height: 720, videoCodec: 'h264' }] }] } };
  const route = (answer: unknown = decision) => routeFetch({ 'GET /library/metadata/3': { MediaContainer: { Metadata: [mp4] } }, 'GET /video/:/transcode/universal/decision': answer,
    'GET /video/:/transcode/universal/stop': {}, 'PUT /library/parts/3': {}, 'POST /:/timeline': {} });
  const decisions = (seen: { url: URL }[]) => seen.filter(r => r.url.pathname === '/video/:/transcode/universal/decision');
  const switchTo = (pathId: string, atSeconds: number, idempotencyKey: string, sourceGeneration: number) => ({ kind: 'switch' as const, pathId, atSeconds, idempotencyKey, sourceGeneration, seekGeneration: 0 });
  // Refusals: a request Plex rejects, a refusing decision code, and an output above the client's cap.
  const refusals = [() => new Response('', { status: 400 }), () => ({ MediaContainer: { generalDecisionCode: 2000 } }), () => ({ MediaContainer: { Metadata: [{ Media: [{ bitrate: 12000 }] }] } })];
  const capped = { ...(client as object), maxBitrate: 4_000_000 } as never;

  test('the original starts without a decision; switching to the stream decides it once, from the start\'s own request', async () => {
    const seen = route();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'p' } as never);
    expect(decisions(seen)).toHaveLength(0);
    expect(plan.selectedPathId).toBe('original');
    expect(plan.paths.map(p => [p.id, p.readiness, p.url === undefined])).toEqual([['original', 'ready', false], ['plex-hls', 'on-demand', true]]);
    const switched = await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 42, 's1', 0));
    expect(await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 42, 's1', 0))).toEqual(switched);
    const stream = switched.paths.find(p => p.id === 'plex-hls')!;
    expect([switched.selectedPathId, switched.positionSeconds, switched.sourceGeneration, stream.readiness, stream.timelineOriginSeconds]).toEqual(['plex-hls', 42, 1, 'ready', 0]);
    expect(stream.quality).toEqual({ width: 1280, height: 720, bitrate: 3_800_000, codec: 'h264' });
    const asked = decisions(seen);
    expect(asked).toHaveLength(1);
    expect(Object.fromEntries(asked[0]!.url.searchParams)).toEqual(Object.fromEntries(new URL(stream.url!).searchParams));
    expect([asked[0]!.url.searchParams.get('session'), asked[0]!.url.searchParams.get('offset')]).toEqual([plan.sessionId, '0']);
  });

  test('leaving the stream for the file stops its transcode, reports the file\'s timeline again, and a return decides a new one', async () => {
    const seen = route();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'l' } as never);
    const streamed = await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 42, 'l1', 0));
    const stops = () => seen.filter(r => r.url.pathname === '/video/:/transcode/universal/stop').map(r => r.url.searchParams.get('session'));
    expect(stops()).toEqual([]);
    const back = await adapter.switchPath(plan.sessionId, switchTo('original', 50, 'l2', 1));
    // Repeated, the switch is not applied (or stopped) twice.
    expect(await adapter.switchPath(plan.sessionId, switchTo('original', 50, 'l2', 1))).toEqual(back);
    await settle();
    expect(stops()).toEqual([plan.sessionId]);
    const stream = back.paths.find(p => p.id === 'plex-hls')!;
    // The stream is a choice again: no URL to a stopped transcode, its last facts kept for the menu.
    expect([back.selectedPathId, back.positionSeconds, back.sourceGeneration, stream.readiness, stream.url, stream.quality]).toEqual(
      ['original', 50, 2, 'on-demand', undefined, streamed.paths.find(p => p.id === 'plex-hls')!.quality]);
    // After the stop, the session's timeline is the file's, at the switch's position.
    const stop = seen.findIndex(r => r.url.pathname.endsWith('/stop'));
    const timeline = seen.findIndex((r, i) => i > stop && r.url.pathname === '/:/timeline');
    expect(timeline).toBeGreaterThan(stop);
    expect([seen[timeline]!.url.searchParams.get('session'), seen[timeline]!.url.searchParams.get('time'), seen[timeline]!.url.searchParams.get('state')]).toEqual([plan.sessionId, '50000', 'playing']);
    // Back to the stream: decided again, from the same request, in a transcode session of its own.
    const again = await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 55, 'l3', 2));
    expect(decisions(seen)).toHaveLength(2);
    const asked = Object.fromEntries(decisions(seen)[1]!.url.searchParams);
    expect(asked).toEqual({ ...Object.fromEntries(decisions(seen)[0]!.url.searchParams), session: `${plan.sessionId}-2` });
    expect(Object.fromEntries(new URL(again.paths.find(p => p.id === 'plex-hls')!.url!).searchParams)).toEqual(asked);
    // The stream now playing is the one a stop, or leaving it again, ends; the first is not stopped again.
    await adapter.switchPath(plan.sessionId, switchTo('original', 60, 'l4', 3));
    await settle();
    expect(stops()).toEqual([plan.sessionId, `${plan.sessionId}-2`]);
    await adapter.command(plan.sessionId, { kind: 'stop', sourceGeneration: 4, seekGeneration: 0, idempotencyKey: 'l5' });
    expect(stops()).toEqual([plan.sessionId, `${plan.sessionId}-2`, plan.sessionId]);
  });

  test('a burned subtitle chosen on the file after the stream was left restarts the stream without stopping it again', async () => {
    const seen = route();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'b' } as never);
    await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 5, 'b1', 0));
    await adapter.switchPath(plan.sessionId, switchTo('original', 9, 'b2', 1));
    await settle();
    const moved = await adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '32', sourceGeneration: 2, seekGeneration: 0, idempotencyKey: 'b3' });
    await settle();
    expect([moved.selectedPathId, new URL(moved.paths.find(p => p.id === 'plex-hls')!.url!).searchParams.get('session')]).toEqual(['plex-hls', `${plan.sessionId}-3`]);
    expect(seen.filter(r => r.url.pathname.endsWith('/stop')).map(r => r.url.searchParams.get('session'))).toEqual([plan.sessionId]);
  });

  test('a switch that stays on the stream, or one from the file to the file, stops nothing', async () => {
    const seen = route();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'n' } as never);
    await adapter.switchPath(plan.sessionId, switchTo('original', 5, 'n1', 0));
    await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 6, 'n2', 1));
    await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 7, 'n3', 2));
    await settle();
    expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(false);
  });

  test('a stop of the stream left that fails, or never answers, does not hold or fail the switch', async () => {
    for (const stop of [() => new Response('', { status: 503 }), () => new Promise<Response>(() => {})]) {
      const seen = routeFetch({ 'GET /library/metadata/3': { MediaContainer: { Metadata: [mp4] } }, 'GET /video/:/transcode/universal/decision': decision,
        'GET /video/:/transcode/universal/stop': stop as never, 'POST /:/timeline': {} });
      const adapter = plex();
      const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'f' } as never);
      await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 5, 'f1', 0));
      const within = <T>(command: Promise<T>) => Promise.race([command, new Promise<never>((_, no) => setTimeout(() => no(new Error('held by the stop')), 200))]);
      expect((await within(adapter.switchPath(plan.sessionId, switchTo('original', 6, 'f2', 1)))).selectedPathId).toBe('original');
      expect((await within(adapter.command(plan.sessionId, { kind: 'pause', sourceGeneration: 2, seekGeneration: 0, idempotencyKey: 'f3' }))).state).toBe('paused');
      await settle();
      expect(seen.filter(r => r.url.pathname.endsWith('/stop')).map(r => r.url.searchParams.get('session'))).toEqual([plan.sessionId]);
    }
  });

  test('a refused stream fails the switch to it, not the start, and leaves the session as it was', async () => {
    for (const refusal of refusals) {
      const seen = route(refusal);
      const adapter = plex();
      const plan = await adapter.startPlayback({ titleId: '3', client: capped, idempotencyKey: 'r' } as never);
      expect(plan.paths.map(p => [p.id, p.readiness])).toEqual([['original', 'ready'], ['plex-hls', 'on-demand']]);
      await expect(adapter.switchPath(plan.sessionId, switchTo('plex-hls', 10, 'r1', 0))).rejects.toBeInstanceOf(VelaError);
      expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(plan);
      expect(seen.some(r => r.method === 'PUT' || r.url.pathname.endsWith('/stop'))).toBe(false);
    }
  });

  test('a refused track restart, from the deferred stream or a running one, stops nothing and leaves the plan', async () => {
    for (const refusal of refusals) {
      let refusing = true;
      const seen = route(() => refusing ? refusal() : decision);
      const adapter = plex();
      const plan = await adapter.startPlayback({ titleId: '3', client: capped, idempotencyKey: 'x' } as never);
      const burn = (subtitleTrackId: string, key: string, sourceGeneration: number) => adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId, sourceGeneration, seekGeneration: 0, idempotencyKey: key });
      // From the deferred stream, with no subtitle chosen before: selected for the decision, nothing put back.
      await expect(burn('32', 'x1', 0)).rejects.toBeInstanceOf(VelaError);
      expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(plan);
      // Accepted from the deferred stream: it was never started, so nothing is stopped.
      refusing = false;
      const burned = await burn('32', 'x2', 0);
      // From the running stream: the subtitle burned before is put back after the refusal.
      refusing = true;
      await expect(burn('33', 'x3', 1)).rejects.toBeInstanceOf(VelaError);
      expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(burned);
      expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(false);
      const steps = seen.filter(r => r.method === 'PUT' || r.url.pathname.endsWith('/decision')).map(r => r.method === 'PUT' ? r.url.searchParams.get('subtitleStreamID') : 'decision');
      // A refused fMP4 request is asked once more as MPEG-TS.
      expect(steps).toEqual(['32', 'decision', 'decision', '32', 'decision', '33', 'decision', 'decision', '32']);
    }
  });

  test('a restarted stream whose decision states no output size drops the old quality', async () => {
    let sparse = false;
    route(() => sparse ? { MediaContainer: { generalDecisionCode: 1001 } } : decision);
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'q' } as never);
    expect((await adapter.switchPath(plan.sessionId, switchTo('plex-hls', 10, 'q1', 0))).paths.find(p => p.id === 'plex-hls')!.quality).toBeDefined();
    sparse = true;
    const burned = await adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '32', sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'q2' });
    expect(burned.paths.find(p => p.id === 'plex-hls')!.quality).toBeUndefined();
  });

  test('a subtitle that must be burned in decides the stream at the playing position', async () => {
    const seen = route();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'b' } as never);
    await adapter.reportObservation(plan.sessionId, { sequence: 1, state: 'playing', positionSeconds: 42, sourceGeneration: 0, seekGeneration: 0 } as never);
    const burned = await adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '32', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'b1' });
    const stream = burned.paths.find(p => p.id === 'plex-hls')!;
    expect([burned.selectedPathId, burned.sourceGeneration, stream.readiness, stream.timelineOriginSeconds]).toEqual(['plex-hls', 1, 'ready', 42]);
    const url = new URL(stream.url!);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ session: `${plan.sessionId}-1`, offset: '42', subtitleStreamID: '32', subtitles: 'burn' });
    expect(decisions(seen).map(r => Object.fromEntries(r.url.searchParams))).toEqual([Object.fromEntries(url.searchParams)]);
    // A stop of the old stream is not waited for: let one that was sent arrive before checking.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(false);
  });
});

describe('Plex stream profile', () => {
  // A 1080p HEVC MKV with TrueHD, for an Apple-shaped client whose HLS carries H.264/HEVC and AAC/AC-3/E-AC-3
  // in MP4 (and whose original-file engine is left out, so the server's stream is the way to play).
  const movie = { ratingKey: '7', type: 'movie', title: 'Surround', duration: 60000, Media: [{ id: 7, container: 'mkv', videoCodec: 'hevc', audioCodec: 'truehd', width: 1920, height: 1080, duration: 60000,
    Part: [{ id: 70, key: '/library/parts/70/1/file.mkv', duration: 60000, Stream: [{ id: 701, index: 0, streamType: 1, codec: 'hevc' }, { id: 702, index: 1, streamType: 2, codec: 'truehd', selected: true }, { id: 703, index: 2, streamType: 3, codec: 'pgs' }] }] }] };
  const apple = { device: { id: 'd', name: 'd', platform: 'ios', appVersion: '1' }, containers: ['mp4'], videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'ac3', 'eac3'], subtitleFormats: [], hls: true } as never;
  const web = { device: { id: 'd', name: 'd', platform: 'web', appVersion: '1' }, containers: ['mp4', 'webm', 'flac', 'm4a'], videoCodecs: ['h264'], audioCodecs: ['aac', 'flac', 'opus', 'mp3'], subtitleFormats: [], hls: false, mse: true } as never;
  // Plex's answer: the output it selected (an unselected media entry first), and each stream's decision.
  const output = (container: string, videoCodec: string, audioCodec: string, video = 'copy') => ({ MediaContainer: { generalDecisionCode: 1001, Metadata: [{ Media: [
    { container: 'mkv', videoCodec: 'hevc', audioCodec: 'truehd', width: 1920, height: 1080 },
    { selected: true, container, videoCodec, audioCodec, width: 1920, height: 1080, bitrate: 12000, Part: [{ decision: 'transcode', Stream: [{ streamType: 1, decision: video }, { streamType: 2, decision: 'transcode' }] }] }] }] } });
  const route = (answer: (q: URLSearchParams) => unknown) => routeFetch({ 'GET /library/metadata/7': { MediaContainer: { Metadata: [movie] } },
    'GET /video/:/transcode/universal/decision': (r: Seen) => answer(r.url.searchParams), 'GET /video/:/transcode/universal/stop': {}, 'PUT /library/parts/70': {}, 'POST /:/timeline': {} });
  const decisions = (seen: Seen[]) => seen.filter(r => r.url.pathname === '/video/:/transcode/universal/decision').map(r => r.url.searchParams);
  const fmp4 = (q: URLSearchParams) => q.get('segmentContainer') === 'mp4';

  test('a client with HEVC in MP4 asks for fMP4 with HEVC and Dolby audio; copied video is a remux', async () => {
    const seen = route(() => output('mp4', 'hevc', 'eac3'));
    const plan = await plex().startPlayback({ titleId: '7', client: apple, idempotencyKey: 'f' } as never);
    const stream = plan.paths.find(p => p.id === 'plex-hls')!;
    const [asked] = decisions(seen);
    expect(decisions(seen)).toHaveLength(1);
    expect(Object.fromEntries(asked!)).toEqual(Object.fromEntries(new URL(stream.url!).searchParams));
    expect(Object.fromEntries(asked!)).toMatchObject({ 'X-Plex-Client-Profile-Name': 'Generic', segmentContainer: 'mp4', directStreamAudio: '1',
      'X-Plex-Client-Profile-Extra': 'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mp4&segmentContainer=mp4&videoCodec=h264,hevc&audioCodec=aac,ac3,eac3&replace=true)',
      // The viewer's ceilings are unchanged.
      maxVideoBitrate: '20000', videoResolution: '1920x1080', session: plan.sessionId });
    expect([stream.kind, stream.quality]).toEqual(['remux', { width: 1920, height: 1080, bitrate: 12_000_000, codec: 'hevc' }]);
  });

  test('a video encode stays a transcode', async () => {
    route(() => output('mp4', 'h264', 'aac', 'transcode'));
    const plan = await plex().startPlayback({ titleId: '7', client: apple, idempotencyKey: 't' } as never);
    expect(plan.paths.find(p => p.id === 'plex-hls')!.kind).toBe('transcode');
  });

  test('a server that ignores or refuses fMP4 is asked once for MPEG-TS with H.264 and AAC, in a fresh session', async () => {
    for (const ignored of [() => output('mpegts', 'hevc', 'eac3'), () => output('mp4', 'hevc', 'truehd'), () => new Response('', { status: 400 }), () => new Response('', { status: 500 }), () => ({ MediaContainer: { generalDecisionCode: 2000 } })]) {
      const seen = route(q => fmp4(q) ? ignored() : output('mpegts', 'h264', 'aac', 'transcode'));
      const adapter = plex();
      const plan = await adapter.startPlayback({ titleId: '7', client: apple, idempotencyKey: 'i' } as never);
      const asked = decisions(seen);
      expect(asked.map(q => [q.get('segmentContainer'), q.get('session')])).toEqual([['mp4', plan.sessionId], ['mpegts', `${plan.sessionId}-ts`]]);
      expect(asked[1]!.get('X-Plex-Client-Profile-Extra')).toBe('add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&segmentContainer=mpegts&videoCodec=h264&audioCodec=aac&replace=true)');
      const stream = plan.paths.find(p => p.id === 'plex-hls')!;
      expect(Object.fromEntries(new URL(stream.url!).searchParams)).toEqual(Object.fromEntries(asked[1]!));
      // The discarded decision's session is not stopped; the stream that plays is the one a stop ends.
      expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(false);
      await adapter.command(plan.sessionId, { kind: 'stop', idempotencyKey: 'stop', sourceGeneration: 0, seekGeneration: 0 });
      expect(seen.filter(r => r.url.pathname.endsWith('/stop')).map(r => r.url.searchParams.get('session'))).toEqual([`${plan.sessionId}-ts`]);
    }
  });

  test('a fallback that also misses fails the start; an auth failure, a missing title, a gateway error and a transport failure are not retried', async () => {
    const both = route(q => fmp4(q) ? output('mpegts', 'hevc', 'eac3') : output('mpegts', 'hevc', 'aac'));
    await expect(plex().startPlayback({ titleId: '7', client: apple, idempotencyKey: 'm' } as never)).rejects.toThrow('No compatible Plex playback path');
    expect(decisions(both)).toHaveLength(2);
    for (const failure of [401, 404, 502, 0]) {
      const once = route(() => { if (!failure) throw new TypeError('fetch failed'); return new Response('', { status: failure }); });
      await expect(plex().startPlayback({ titleId: '7', client: apple, idempotencyKey: 'a' } as never)).rejects.toThrow(failure ? `Plex request failed (${failure})` : 'fetch failed');
      expect(decisions(once)).toHaveLength(1);
    }
  });

  test('a sparse answer is taken as asked; an H.264-only browser never asks for HEVC or its other audio, and a cap is a limitation', async () => {
    const seen = route(() => ({ MediaContainer: {} }));
    const plan = await plex().startPlayback({ titleId: '7', client: { ...(web as object), maxBitrate: 4_000_000 } as never, idempotencyKey: 'w' } as never);
    expect(decisions(seen)).toHaveLength(1);
    expect(plan.paths.find(p => p.id === 'plex-hls')!.kind).toBe('transcode');
    const extra = decisions(seen)[0]!.get('X-Plex-Client-Profile-Extra')!;
    expect(extra).toContain('&videoCodec=h264&audioCodec=aac&');
    expect(extra).toEndWith('+add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.bitrate&value=4000&replace=true)');
  });

  test('a deferred stream that falls back is the one a stop ends', async () => {
    const seen = route(q => fmp4(q) ? output('mpegts', 'hevc', 'eac3') : output('mpegts', 'h264', 'aac', 'transcode'));
    const engine = { ...(apple as object), originalPlayback: { version: 1, range: true, demuxContainers: ['mkv'], videoDecoders: ['hevc'], audioDecoders: ['truehd'], webgpu: false } } as never;
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '7', client: engine, idempotencyKey: 'd' } as never);
    expect(decisions(seen)).toHaveLength(0);
    const switched = await adapter.switchPath(plan.sessionId, { kind: 'switch', pathId: 'plex-hls', atSeconds: 5, idempotencyKey: 'd1', sourceGeneration: 0, seekGeneration: 0 });
    expect(new URL(switched.paths.find(p => p.id === 'plex-hls')!.url!).searchParams.get('session')).toBe(`${plan.sessionId}-ts`);
    await adapter.command(plan.sessionId, { kind: 'stop', idempotencyKey: 'd2', sourceGeneration: 1, seekGeneration: 0 });
    expect(seen.filter(r => r.url.pathname.endsWith('/stop')).map(r => r.url.searchParams.get('session'))).toEqual([`${plan.sessionId}-ts`]);
  });

  test('a client that can claim neither profile keeps the request without one', async () => {
    const seen = route(() => ({ MediaContainer: {} }));
    const vp9 = { ...(web as object), containers: ['webm'], videoCodecs: ['vp9'], audioCodecs: ['opus'] } as never;
    await plex().startPlayback({ titleId: '7', client: vp9, idempotencyKey: 'v' } as never);
    expect(decisions(seen).map(q => [q.has('X-Plex-Client-Profile-Extra'), q.has('segmentContainer')])).toEqual([[false, false]]);
  });

  test('a track restart keeps the profile the stream was accepted with', async () => {
    const seen = route(q => fmp4(q) ? output('mpegts', 'hevc', 'eac3') : output('mpegts', 'h264', 'aac', 'transcode'));
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '7', client: apple, idempotencyKey: 'r' } as never);
    const next = await adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '703', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'r1' });
    const asked = decisions(seen).slice(2);
    expect(asked.map(q => [q.get('segmentContainer'), q.get('session'), q.get('subtitles')])).toEqual([['mpegts', `${plan.sessionId}-1`, 'burn']]);
    expect(next.paths.find(p => p.id === 'plex-hls')!.kind).toBe('transcode');
    // A stream accepted in fMP4 may still fall back once when its restart is refused there.
    let burning = false;
    const again = route(q => fmp4(q) && !burning ? output('mp4', 'hevc', 'eac3') : fmp4(q) ? { MediaContainer: { generalDecisionCode: 2000 } } : output('mpegts', 'h264', 'aac', 'transcode'));
    const other = plex();
    const fmp4Plan = await other.startPlayback({ titleId: '7', client: apple, idempotencyKey: 'r2' } as never);
    burning = true;
    await other.changeTracks(fmp4Plan.sessionId, { kind: 'tracks', subtitleTrackId: '703', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'r3' });
    expect(decisions(again).slice(1).map(q => [q.get('segmentContainer'), q.get('session')])).toEqual([['mp4', `${fmp4Plan.sessionId}-1`], ['mpegts', `${fmp4Plan.sessionId}-1-ts`]]);
  });

  test('the selected output audio row of the selected part is checked, not the summary', async () => {
    // As Ether answers a copied AAC commentary: the summary keeps the source's loudest track (TrueHD), and the part that plays is listed after another.
    const seen = route(() => ({ MediaContainer: { generalDecisionCode: 1001, Metadata: [{ Media: [{ selected: true, container: 'mp4', videoCodec: 'hevc', audioCodec: 'truehd', width: 1920, height: 1080, Part: [
      { Stream: [{ streamType: 1, codec: 'hevc', decision: 'transcode' }] },
      { selected: true, Stream: [{ streamType: 1, codec: 'hevc', decision: 'copy' }, { streamType: 2, codec: 'aac', selected: true, decision: 'copy' }] }] }] }] } }));
    const plan = await plex().startPlayback({ titleId: '7', client: apple, idempotencyKey: 'e' } as never);
    expect(decisions(seen)).toHaveLength(1);
    expect(plan.paths.find(p => p.id === 'plex-hls')!.kind).toBe('remux');
  });

  test('a browser on the MSE route, which takes only fMP4, is never asked MPEG-TS', async () => {
    const seen = route(q => fmp4(q) ? { MediaContainer: { generalDecisionCode: 2000 } } : output('mpegts', 'h264', 'aac', 'transcode'));
    await expect(plex().startPlayback({ titleId: '7', client: web, idempotencyKey: 'm' } as never)).rejects.toThrow('No compatible Plex playback path');
    expect(decisions(seen).map(q => q.get('segmentContainer'))).toEqual(['mp4']);
  });

  test('a transcode or MDE decision code of 2000 or more refuses an answer that states no output; one above the cap tries the next profile', async () => {
    const at = (container: string, bitrate: number) => ({ MediaContainer: { generalDecisionCode: 1001, Metadata: [{ Media: [{ selected: true, container, videoCodec: 'h264', audioCodec: 'aac', bitrate }] }] } });
    for (const [refusal, client] of [[{ MediaContainer: { transcodeDecisionCode: 4005 } }, apple], [{ MediaContainer: { mdeDecisionCode: 2000 } }, apple], [at('mp4', 12000), { ...(apple as object), maxBitrate: 4_000_000 }]] as const) {
      const seen = route(q => fmp4(q) ? refusal : at('mpegts', 3000));
      const plan = await plex().startPlayback({ titleId: '7', client, idempotencyKey: 'k' } as never);
      expect([decisions(seen).map(q => q.get('segmentContainer')), plan.paths.find(p => p.id === 'plex-hls')!.kind]).toEqual([['mp4', 'mpegts'], 'transcode']);
    }
  });

  test('a stacked title whose next part is refused keeps the part that plays', async () => {
    let refusing = false;
    const seen = routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [twofold] } }, 'POST /:/timeline': {}, 'GET /video/:/transcode/universal/stop': {},
      'GET /video/:/transcode/universal/decision': () => refusing ? { MediaContainer: { generalDecisionCode: 2000 } } : {} });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'p', positionSeconds: 0 } as never);
    refusing = true;
    await expect(adapter.command(plan.sessionId, { kind: 'seek', positionSeconds: 42, idempotencyKey: 'p1', sourceGeneration: 0, seekGeneration: 0 })).rejects.toBeInstanceOf(VelaError);
    expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(false);
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(plan);
  });

  test('a secure page whose packet route plays HLS itself may still fall back to MPEG-TS', async () => {
    const seen = route(q => fmp4(q) ? { MediaContainer: { generalDecisionCode: 2000 } } : output('mpegts', 'h264', 'aac', 'transcode'));
    const packet = { ...(web as object), originalPlayback: { version: 1, range: true, demuxContainers: ['mkv', 'mp4'], videoDecoders: ['h264'], audioDecoders: ['aac'], webgpu: true } } as never;
    const plan = await plex().startPlayback({ titleId: '7', client: packet, idempotencyKey: 'g' } as never);
    expect([decisions(seen).map(q => q.get('segmentContainer')), plan.selectedPathId]).toEqual([['mp4', 'mpegts'], 'plex-hls']);
  });

  test('the playing part\'s container and output video row are checked, and its video decides a remux', async () => {
    const at = (part: Record<string, unknown>, media: Record<string, unknown> = {}) => ({ MediaContainer: { Metadata: [{ Media: [{ selected: true, ...media, Part: [part] }] }] } });
    for (const missed of [at({ container: 'mpegts' }), at({ Stream: [{ streamType: 1, codec: 'vc1' }] }, { videoCodec: 'hevc' })]) {
      const seen = route(q => fmp4(q) ? missed : output('mpegts', 'h264', 'aac', 'transcode'));
      await plex().startPlayback({ titleId: '7', client: apple, idempotencyKey: 'c' } as never);
      expect(decisions(seen).map(q => q.get('segmentContainer'))).toEqual(['mp4', 'mpegts']);
    }
    // A stacked title's answer may list every part unmarked: the requested one is read.
    routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [twofold] } }, 'POST /:/timeline': {}, 'GET /video/:/transcode/universal/decision': { MediaContainer: { Metadata: [{ Media: [{ Part: [
      { Stream: [{ streamType: 1, decision: 'transcode' }] }, { Stream: [{ streamType: 1, decision: 'copy' }] }] }] }] } } });
    const plan = await plex().startPlayback({ titleId: '1', client, idempotencyKey: 'c2', positionSeconds: 42 } as never);
    expect(plan.paths.find(p => p.id === 'plex-hls')!.kind).toBe('remux');
  });

  test('a stacked part restart whose decision states no output size drops the previous part\'s quality', async () => {
    routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [twofold] } }, 'POST /:/timeline': {}, 'GET /video/:/transcode/universal/stop': {},
      'GET /video/:/transcode/universal/decision': (r: Seen) => r.url.searchParams.get('partIndex') === '0' ? { MediaContainer: { Metadata: [{ Media: [{ width: 1280, height: 720 }] }] } } : {} });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'q', positionSeconds: 0 } as never);
    expect(plan.paths.find(p => p.id === 'plex-hls')!.quality).toMatchObject({ width: 1280, height: 720 });
    await adapter.reportObservation(plan.sessionId, { sequence: 1, state: 'ended', positionSeconds: 30, sourceGeneration: 0, seekGeneration: 0 } as never);
    const next = (await adapter.sessionSnapshot(plan.sessionId)).plan;
    expect([next.sourceGeneration, next.paths.find(p => p.id === 'plex-hls')!.quality]).toEqual([1, undefined]);
  });

  test('a stacked audio change selects the new track on the part before its restart is decided', async () => {
    const stacked = { ...twofold, Media: [{ ...twofold.Media[0]!, Part: twofold.Media[0]!.Part.map((p, i) => ({ ...p,
      Stream: [{ id: 11 + 10 * i, index: 1, streamType: 2, codec: 'aac', selected: true }, { id: 12 + 10 * i, index: 2, streamType: 2, codec: 'aac' }] })) }] };
    const seen = routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [stacked] } }, 'POST /:/timeline': {}, 'GET /video/:/transcode/universal/stop': {},
      'GET /video/:/transcode/universal/decision': {}, 'PUT /library/parts/1': {} });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'sa', positionSeconds: 0 } as never);
    await adapter.changeTracks(plan.sessionId, { kind: 'tracks', audioTrackId: '12', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'sa1' });
    const steps = seen.filter(r => r.method === 'PUT' || r.url.pathname.endsWith('/decision')).map(r => r.method === 'PUT' ? `PUT ${r.url.searchParams.get('audioStreamID')}` : r.url.searchParams.get('session'));
    expect(steps).toEqual([plan.sessionId, 'PUT 12', `${plan.sessionId}-1`]);
  });

  test('a stacked audio change whose restart is refused puts back the track selected before', async () => {
    const stacked = { ...twofold, Media: [{ ...twofold.Media[0]!, Part: twofold.Media[0]!.Part.map((p, i) => ({ ...p,
      Stream: [{ id: 11 + 10 * i, index: 1, streamType: 2, codec: 'aac', selected: true }, { id: 12 + 10 * i, index: 2, streamType: 2, codec: 'aac' }] })) }] };
    let refusing = false;
    const seen = routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [stacked] } }, 'POST /:/timeline': {}, 'GET /video/:/transcode/universal/stop': {},
      'GET /video/:/transcode/universal/decision': () => refusing ? { MediaContainer: { generalDecisionCode: 2000 } } : {}, 'PUT /library/parts/1': {} });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'sr', positionSeconds: 0 } as never);
    refusing = true;
    await expect(adapter.changeTracks(plan.sessionId, { kind: 'tracks', audioTrackId: '12', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'sr1' })).rejects.toBeInstanceOf(VelaError);
    expect(seen.filter(r => r.method === 'PUT').map(r => r.url.searchParams.get('audioStreamID'))).toEqual(['12', '11']);
    expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(false);
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(plan);
  });

  test('a refused stacked restart on part two puts back no track: none was asked for that part', async () => {
    const stacked = { ...twofold, Media: [{ ...twofold.Media[0]!, Part: twofold.Media[0]!.Part.map((p, i) => ({ ...p,
      Stream: [{ id: 11 + 10 * i, index: 1, streamType: 2, codec: 'aac', selected: true }, { id: 12 + 10 * i, index: 2, streamType: 2, codec: 'aac' }] })) }] };
    let refusing = false;
    const seen = routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [stacked] } }, 'POST /:/timeline': {}, 'GET /video/:/transcode/universal/stop': {},
      'GET /video/:/transcode/universal/decision': () => refusing ? { MediaContainer: { generalDecisionCode: 2000 } } : {}, 'PUT /library/parts/2': {} });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'sp', positionSeconds: 0 } as never);
    const moved = await adapter.command(plan.sessionId, { kind: 'seek', positionSeconds: 42, idempotencyKey: 'sp1', sourceGeneration: 0, seekGeneration: 0 }) as typeof plan;
    refusing = true;
    await expect(adapter.changeTracks(plan.sessionId, { kind: 'tracks', audioTrackId: '12', sourceGeneration: moved.sourceGeneration, seekGeneration: moved.seekGeneration, idempotencyKey: 'sp2' })).rejects.toBeInstanceOf(VelaError);
    expect(seen.filter(r => r.method === 'PUT').map(r => [r.url.pathname, r.url.searchParams.get('audioStreamID')])).toEqual([['/library/parts/2', '12']]);
  });

  test('after a change, a seek to the other part and back, a refused change puts back nothing the start read', async () => {
    const stacked = { ...twofold, Media: [{ ...twofold.Media[0]!, Part: twofold.Media[0]!.Part.map((p, i) => ({ ...p,
      Stream: [{ id: 11 + 10 * i, index: 1, streamType: 2, codec: 'aac', selected: true }, { id: 12 + 10 * i, index: 2, streamType: 2, codec: 'aac' }] })) }] };
    let refusing = false;
    const seen = routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [stacked] } }, 'POST /:/timeline': {}, 'GET /video/:/transcode/universal/stop': {},
      'GET /video/:/transcode/universal/decision': () => refusing ? { MediaContainer: { generalDecisionCode: 2000 } } : {}, 'PUT /library/parts/1': {} });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'sb', positionSeconds: 0 } as never);
    let now = await adapter.changeTracks(plan.sessionId, { kind: 'tracks', audioTrackId: '12', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'sb1' });
    for (const [key, positionSeconds] of [['sb2', 42], ['sb3', 5]] as const) now = await adapter.command(plan.sessionId, { kind: 'seek', positionSeconds, idempotencyKey: key, sourceGeneration: now.sourceGeneration, seekGeneration: now.seekGeneration }) as typeof plan;
    refusing = true;
    await expect(adapter.changeTracks(plan.sessionId, { kind: 'tracks', audioTrackId: '11', sourceGeneration: now.sourceGeneration, seekGeneration: now.seekGeneration, idempotencyKey: 'sb4' })).rejects.toBeInstanceOf(VelaError);
    // 12 was written to every part and is still selected: the 11 Plex marked at the start is not put back.
    expect(seen.filter(r => r.method === 'PUT').map(r => r.url.searchParams.get('audioStreamID'))).toEqual(['12', '11']);
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(now);
  });
});

describe('Plex DTS audio', () => {
  // Plex names DTS `dca` (and DTS-HD MA `dca-ma`); the protocol's codec token is `dts`. The client is a synthetic, Apple-shaped fixture.
  const streams: Record<string, Record<string, string>> = { 'dca-ma': { codec: 'dca', profile: 'ma + dts:x' }, dca: { codec: 'dca' }, wmapro: { codec: 'wmapro' } };
  const movie = (audioCodec: string) => ({ ratingKey: '4', type: 'movie', title: 'Loud', duration: 60000, Media: [{ id: 4, container: 'mkv', videoCodec: 'hevc', audioCodec, duration: 60000,
    Part: [{ id: 4, key: '/library/parts/4/1/file.mkv', size: 1000, duration: 60000, Stream: [{ id: 41, index: 1, streamType: 2, ...streams[audioCodec], selected: true }] }] }] });
  const decoders = ['aac', 'ac3', 'eac3', 'dts', 'truehd', 'flac', 'opus', 'mp3'];
  const withoutDts = decoders.filter(c => c !== 'dts');
  const appleClient = (original: string[], native: string[]) => ({ device: { id: 'd', name: 'd', platform: 'ios', appVersion: '1' }, containers: ['mp4', 'mkv'], videoCodecs: ['h264', 'hevc'], audioCodecs: native,
    subtitleFormats: [], hls: true, originalPlayback: { version: 1, range: true, demuxContainers: ['mkv', 'mp4'], videoDecoders: ['h264', 'hevc'], audioDecoders: original, webgpu: false } }) as never;
  const start = (audioCodec: string, client: never, allowTranscode?: boolean) => {
    routeFetch({ 'GET /library/metadata/4': { MediaContainer: { Metadata: [movie(audioCodec)] } }, 'GET /video/:/transcode/universal/decision': { MediaContainer: {} } });
    return plex().startPlayback({ titleId: '4', client, idempotencyKey: `dts-${audioCodec}`, ...(allowTranscode === undefined ? {} : { allowTranscode }) } as never);
  };

  for (const codec of ['dca-ma', 'dca']) test(`a ${codec} file is offered as the original to a client that declares dts`, async () => {
    const plan = await start(codec, appleClient(decoders, decoders));
    expect(plan.selectedPathId).toBe('original');
    expect(new URL(plan.paths[0]!.url!).pathname).toBe('/library/parts/4/1/file.mkv');
  });

  test('with transcoding off, a DTS file is offered as the original instead of failing', async () => {
    const plan = await start('dca-ma', appleClient(decoders, decoders), false);
    expect(plan.paths.map(p => p.id)).toEqual(['original']);
  });

  test.each([
    ['dts only in originalPlayback.audioDecoders gets the original', decoders, withoutDts, 'original'],
    ['dts only in the top-level audioCodecs gets the original', withoutDts, decoders, 'original'],
    ['dts in neither list gets the server\'s stream', withoutDts, withoutDts, 'plex-hls'],
  ] as const)('a client declaring %s', async (_, original, native, path) => {
    expect((await start('dca-ma', appleClient([...original], [...native]))).selectedPathId).toBe(path);
  });

  test('audio the client does not decode still goes to the server\'s stream', async () => {
    expect((await start('wmapro', appleClient(decoders, decoders))).selectedPathId).toBe('plex-hls');
  });
});

describe('Plex selected audio', () => {
  // A file's summary audioCodec is one track's (usually the first); the track that plays is the one
  // asked for, else the one Plex selected, else the file's default, else the first. Stream ids are
  // Plex's (for /library/parts), indices the player's; they differ on purpose here.
  const decoders = ['aac', 'ac3', 'eac3', 'truehd', 'flac', 'opus', 'mp3'];
  const appleClient = (original = decoders, native = decoders) => ({ device: { id: 'd', name: 'd', platform: 'ios', appVersion: '1' }, containers: ['mp4', 'mkv'], videoCodecs: ['h264', 'hevc'], audioCodecs: native,
    subtitleFormats: [], hls: true, originalPlayback: { version: 1, range: true, demuxContainers: ['mkv', 'mp4'], videoDecoders: ['h264', 'hevc'], audioDecoders: original, webgpu: false } }) as never;
  const movie = (audioCodec: string, audio: Record<string, unknown>[]) => ({ ratingKey: '6', type: 'movie', title: 'Tracks', duration: 60000, Media: [{ id: 6, container: 'mkv', videoCodec: 'hevc', audioCodec, duration: 60000,
    Part: [{ id: 60, key: '/library/parts/60/1/file.mkv', size: 1000, duration: 60000, Stream: [{ id: 601, index: 0, streamType: 1, codec: 'hevc' }, ...audio.map(a => ({ streamType: 2, ...a }))] }] }] });
  const dtsFirst = [{ id: 602, index: 1, codec: 'dca', profile: 'ma', default: true }, { id: 603, index: 2, codec: 'aac', selected: true }];
  const aacFirst = [{ id: 612, index: 1, codec: 'aac', selected: true, default: true }, { id: 613, index: 2, codec: 'wmapro' }, { id: 614, index: 3, codec: 'eac3' }];
  const route = (n: ReturnType<typeof movie>) => routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [n] } },
    'GET /video/:/transcode/universal/decision': { MediaContainer: {} }, 'GET /video/:/transcode/universal/stop': {}, 'PUT /library/parts/60': {} });
  const start = (n: ReturnType<typeof movie>, extra: Record<string, unknown> = {}, client = appleClient()) => {
    const seen = route(n);
    return { seen, plan: plex().startPlayback({ titleId: '6', client, idempotencyKey: 'sel', ...extra } as never) };
  };

  test('the AAC track Plex selected admits an MKV whose summary codec is DTS, even with transcoding off', async () => {
    const plan = await start(movie('dca', dtsFirst), { allowTranscode: false }).plan;
    expect(plan.paths.map(p => p.id)).toEqual(['original']);
    expect(plan.selectedAudioTrackId).toBe('603');
    expect(plan.audioTracks.map(t => [t.id, t.streamIndex])).toEqual([['602', 1], ['603', 2]]);
  });

  test.each([
    ['only the original-file engine', [...decoders], ['mp3']],
    ['only the native player', ['mp3'], [...decoders]],
  ] as const)('the selected track is checked against %s', async (_, original, native) => {
    expect((await start(movie('dca', dtsFirst), {}, appleClient([...original], [...native])).plan).selectedPathId).toBe('original');
  });

  test('an explicitly requested track the device cannot decode goes to the server\'s stream, with Plex\'s stream id', async () => {
    const { seen, plan } = start(movie('aac', aacFirst), { audioTrackId: '613' });
    const started = await plan;
    expect(started.selectedPathId).toBe('plex-hls');
    expect(started.selectedAudioTrackId).toBe('613');
    expect(seen.find(r => r.method === 'PUT')!.url.searchParams.get('audioStreamID')).toBe('613');
    const refused = start(movie('aac', aacFirst), { audioTrackId: '613', allowTranscode: false });
    await expect(refused.plan).rejects.toThrow('transcoding is disabled');
    expect(refused.seen.some(r => r.method === 'PUT')).toBe(false);
  });

  test('a DTS-HD MA row Plex names dca-ma is judged as dts, whatever the summary says', async () => {
    const dts = appleClient([...decoders, 'dts'], [...decoders, 'dts']);
    expect((await start(movie('wmapro', [{ id: 671, index: 1, codec: 'dca-ma', selected: true }]), {}, dts).plan).selectedPathId).toBe('original');
  });

  test('the default track that admitted the file is the plan\'s audio, so the player opens it', async () => {
    const { seen, plan } = start(movie('wmapro', [{ id: 661, index: 1, codec: 'wmapro' }, { id: 662, index: 2, codec: 'aac', default: true }]));
    const started = await plan;
    expect(started.selectedPathId).toBe('original');
    expect(started.selectedAudioTrackId).toBe('662');
    expect(started.audioTracks.find(t => t.id === started.selectedAudioTrackId)?.streamIndex).toBe(2);
    expect(seen.some(r => r.method === 'PUT')).toBe(false);
  });

  test('without a selected track the default plays, else the first', async () => {
    const unselected = (audio: Record<string, unknown>[]) => movie('aac', audio.map(({ selected: _, ...a }) => a));
    expect((await start(unselected([{ id: 621, index: 1, codec: 'aac' }, { id: 622, index: 2, codec: 'wmapro', default: true }])).plan).selectedPathId).toBe('plex-hls');
    expect((await start(unselected([{ id: 631, index: 1, codec: 'wmapro' }, { id: 632, index: 2, codec: 'aac' }])).plan).selectedPathId).toBe('plex-hls');
    // No inferred choice is written to the part.
    const { seen, plan } = start(unselected([{ id: 641, index: 1, codec: 'aac' }, { id: 642, index: 2, codec: 'wmapro' }]));
    expect((await plan).selectedPathId).toBe('original');
    expect(seen.some(r => r.method === 'PUT')).toBe(false);
  });

  test('a file whose streams state no audio codec is judged by its summary', async () => {
    expect((await start(movie('aac', [])).plan).selectedPathId).toBe('original');
    expect((await start(movie('wmapro', [])).plan).selectedPathId).toBe('plex-hls');
    expect((await start(movie('wmapro', [{ id: 651, index: 1, selected: true }])).plan).selectedPathId).toBe('plex-hls');
    expect((await start(movie('', [])).plan).selectedPathId).toBe('original');
  });

  test('changing to a track the original cannot play moves to the server\'s stream; a playable one stays on the file', async () => {
    const seen = route(movie('aac', aacFirst));
    const adapter = plex();
    const started = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'c' } as never);
    expect(started.selectedPathId).toBe('original');
    const kept = await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '614', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'c1' });
    expect([kept.selectedPathId, kept.selectedAudioTrackId, kept.sourceGeneration]).toEqual(['original', '614', 0]);
    const moved = await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'c2' });
    expect([moved.selectedPathId, moved.selectedAudioTrackId, moved.sourceGeneration]).toEqual(['plex-hls', '613', 1]);
    const stream = new URL(moved.paths.find(p => p.id === 'plex-hls')!.url!);
    expect(stream.searchParams.get('audioStreamID')).toBe('613');
    expect(seen.filter(r => r.method === 'PUT').map(r => r.url.searchParams.get('audioStreamID'))).toEqual(['614', '613']);
    expect(seen.some(r => r.url.pathname.endsWith('/decision') && r.url.searchParams.get('session') === stream.searchParams.get('session'))).toBe(true);
  });

  test('a track change selects the new audio on the part before its stream is decided, and writes it once', async () => {
    const seen = route(movie('aac', aacFirst));
    const adapter = plex();
    const started = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'p' } as never);
    await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'p1' });
    const puts = seen.filter(r => r.method === 'PUT');
    expect(puts.map(r => [r.url.searchParams.get('audioStreamID'), r.url.searchParams.get('subtitleStreamID')])).toEqual([['613', null]]);
    const decided = seen.findIndex(r => r.url.pathname.endsWith('/decision') && r.url.searchParams.get('session') === `${started.sessionId}-1`);
    expect(decided).toBeGreaterThan(seen.indexOf(puts[0]!));
  });

  test('a refused audio change puts back only an audio stream selected before', async () => {
    const n = movie('aac', aacFirst.map(({ selected: _, ...a }) => a));
    const seen = routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [n] } }, 'GET /video/:/transcode/universal/stop': {}, 'PUT /library/parts/60': {},
      'GET /video/:/transcode/universal/decision': (q: Seen) => /-1(-ts)?$/.test(q.url.searchParams.get('session')!) ? { MediaContainer: { generalDecisionCode: 2000 } } : { MediaContainer: {} } });
    const adapter = plex();
    const puts = () => seen.filter(r => r.method === 'PUT').map(r => r.url.searchParams.get('audioStreamID'));
    const refuse = (sessionId: string, key: string) => expect(adapter.changeTracks(sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: key })).rejects.toThrow();
    // The default track was only inferred: nothing was selected on the part, so nothing is put back.
    const inferred = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'i' } as never);
    expect(inferred.selectedAudioTrackId).toBe('612');
    await refuse(inferred.sessionId, 'i1');
    expect(puts()).toEqual(['613']);
    // A track the start asked for is put back.
    const requested = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'r', audioTrackId: '614' } as never);
    await refuse(requested.sessionId, 'r1');
    expect(puts().slice(1)).toEqual(['614', '613', '614']);
    // So is a track an earlier change selected.
    const changed = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'c' } as never);
    await adapter.changeTracks(changed.sessionId, { kind: 'tracks', audioTrackId: '614', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'c1' });
    await refuse(changed.sessionId, 'c2');
    expect(puts().slice(4)).toEqual(['614', '613', '614']);
  });

  test('after a refusal the session keeps what the part has: the new track where none was known, nothing once a put-back failed', async () => {
    const n = movie('aac', [...aacFirst.map(({ selected: _, ...a }) => a), { id: 615, index: 4, codec: 'wmav2' }]);
    let failing: string | undefined;
    const seen = routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [n] } }, 'GET /video/:/transcode/universal/stop': {},
      'PUT /library/parts/60': (q: Seen) => q.url.searchParams.get('audioStreamID') === failing ? new Response('', { status: 500 }) : {},
      'GET /video/:/transcode/universal/decision': (q: Seen) => q.url.searchParams.get('audioStreamID') ? { MediaContainer: { generalDecisionCode: 2000 } } : { MediaContainer: {} } });
    const adapter = plex();
    const puts = () => seen.filter(r => r.method === 'PUT').map(r => r.url.searchParams.get('audioStreamID'));
    const refuse = (sessionId: string, audioTrackId: string, key: string) => expect(adapter.changeTracks(sessionId, { kind: 'tracks', audioTrackId, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: key })).rejects.toThrow();
    const inferred = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'k' } as never);
    await refuse(inferred.sessionId, '613', 'k1');
    await refuse(inferred.sessionId, '615', 'k2');
    const requested = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'q', audioTrackId: '614' } as never);
    failing = '614';
    await refuse(requested.sessionId, '613', 'q1');
    await refuse(requested.sessionId, '615', 'q2');
    // 613 stays after the first refusal and is put back after the second; once 614 could not be put back, nothing is.
    expect(puts()).toEqual(['613', '615', '613', '614', '613', '614', '615']);
  });

  test('a version switch away and back does not take the start\'s selection for the part\'s again', async () => {
    const n = movie('aac', aacFirst);
    n.Media.push({ ...n.Media[0]!, id: 7, Part: [{ ...n.Media[0]!.Part[0]!, id: 70, key: '/library/parts/70/1/file.mkv' }] });
    const seen = routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [n] } }, 'GET /video/:/transcode/universal/stop': {}, 'PUT /library/parts/60': {},
      'GET /video/:/transcode/universal/decision': (q: Seen) => q.url.searchParams.get('audioStreamID') === '613' ? { MediaContainer: { generalDecisionCode: 2000 } } : { MediaContainer: {} } });
    const adapter = plex();
    const started = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'v' } as never);
    await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '614', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'v1' });
    const away = await adapter.switchVersion(started.sessionId, { kind: 'version', versionId: '7', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'v2' } as never);
    const back = await adapter.switchVersion(started.sessionId, { kind: 'version', versionId: '6', sourceGeneration: away.sourceGeneration, seekGeneration: 0, idempotencyKey: 'v3' } as never);
    await expect(adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: back.sourceGeneration, seekGeneration: 0, idempotencyKey: 'v4' })).rejects.toThrow();
    // The part has 614, not the 612 the start read: nothing known is put back.
    expect(seen.filter(r => r.method === 'PUT').map(r => r.url.searchParams.get('audioStreamID'))).toEqual(['614', '613']);
  });

  test('a subtitle that is not burned in goes in the same write as the audio before the decision, and both are put back on a refusal', async () => {
    const n = movie('aac', aacFirst);
    n.Media[0]!.Part[0]!.Stream.push({ id: 692, index: 4, streamType: 3, codec: 'srt' } as never, { id: 693, index: 5, streamType: 3, codec: 'srt' } as never);
    const seen = routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [n] } }, 'GET /video/:/transcode/universal/stop': {}, 'PUT /library/parts/60': {},
      'GET /video/:/transcode/universal/decision': (q: Seen) => q.url.searchParams.get('audioStreamID') === '614' ? { MediaContainer: { generalDecisionCode: 2000 } } : { MediaContainer: {} } });
    const adapter = plex();
    const started = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'w', subtitleTrackId: '692' } as never);
    const moved = await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', subtitleTrackId: '693', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'w1' });
    await expect(adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '614', subtitleTrackId: '692', sourceGeneration: moved.sourceGeneration, seekGeneration: 0, idempotencyKey: 'w2' })).rejects.toThrow();
    const puts = seen.filter(r => r.method === 'PUT');
    expect(puts.map(r => [r.url.searchParams.get('audioStreamID'), r.url.searchParams.get('subtitleStreamID')])).toEqual([[null, '692'], ['613', '693'], ['614', '692'], ['613', '693']]);
    expect(seen.findIndex(r => r.url.pathname.endsWith('/decision') && r.url.searchParams.get('audioStreamID') === '613')).toBeGreaterThan(seen.indexOf(puts[1]!));
  });

  const overCap = () => ({ MediaContainer: { Metadata: [{ Media: [{ bitrate: 12000, width: 1920, height: 1080 }] }] } });
  for (const [name, refusal] of [['a 400', () => new Response('', { status: 400 })], ['code 2000', () => ({ MediaContainer: { generalDecisionCode: 2000 } })], ['over the cap', overCap]] as const) {
    test(`a track change whose stream is refused (${name}) leaves the part selection, the streams and the plan as they were`, async () => {
      const n = movie('aac', aacFirst);
      n.Media[0]!.Part[0]!.Stream.push({ id: 691, index: 4, streamType: 3, codec: 'pgs', key: '/library/streams/691' } as never, { id: 692, index: 5, streamType: 3, codec: 'srt' } as never);
      const seen = routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [n] } }, 'GET /video/:/transcode/universal/stop': {}, 'PUT /library/parts/60': {},
        'GET /video/:/transcode/universal/decision': (q: Seen) => /-1(-ts)?$/.test(q.url.searchParams.get('session')!) ? refusal() : { MediaContainer: {} } });
      const adapter = plex();
      const capped = { ...(appleClient() as object), maxBitrate: 4_000_000 } as never;
      const started = await adapter.startPlayback({ titleId: '6', client: capped, idempotencyKey: 'f' } as never);
      // Audio the file cannot play: Plex very likely takes it from the part, so it is selected before the decision,
      // and Plex's own selection is put back.
      const puts = () => seen.filter(r => r.method === 'PUT').map(r => [r.url.searchParams.get('audioStreamID'), r.url.searchParams.get('subtitleStreamID')]);
      await expect(adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'f1' })).rejects.toThrow();
      expect(puts()).toEqual([['613', null], ['612', null]]);
      // A subtitle to burn in: Plex burns the part's selection, so it is selected first. With no subtitle
      // stream chosen before, nothing is put back (0 would turn automatic subtitles off).
      await expect(adapter.changeTracks(started.sessionId, { kind: 'tracks', subtitleTrackId: '691', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'f2' })).rejects.toThrow();
      expect(puts().slice(2)).toEqual([[null, '691']]);
      expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(false);
      expect((await adapter.sessionSnapshot(started.sessionId)).plan).toEqual(started);
      // A subtitle stream chosen before is put back.
      const chosen = await adapter.startPlayback({ titleId: '6', client: capped, idempotencyKey: 'g', subtitleTrackId: '692' } as never);
      await expect(adapter.changeTracks(chosen.sessionId, { kind: 'tracks', subtitleTrackId: '691', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'g1' })).rejects.toThrow();
      expect(puts().slice(3)).toEqual([[null, '692'], [null, '691'], [null, '692']]);
    });
  }

  test('an accepted stream is committed once: the burned subtitle is written once, and a failed stop of the old stream does not undo it', async () => {
    const n = movie('aac', aacFirst);
    n.Media[0]!.Part[0]!.Stream.push({ id: 691, index: 4, streamType: 3, codec: 'pgs', key: '/library/streams/691' } as never);
    const seen = routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [n] } }, 'GET /video/:/transcode/universal/decision': { MediaContainer: {} },
      'GET /video/:/transcode/universal/stop': () => new Response('', { status: 503 }), 'PUT /library/parts/60': {} });
    const adapter = plex();
    const started = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'z' } as never);
    // The stream is started, so there is one to stop.
    await adapter.switchPath(started.sessionId, { kind: 'switch', pathId: 'plex-hls', atSeconds: 0, idempotencyKey: 'z0', sourceGeneration: 0, seekGeneration: 0 });
    const moved = await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', subtitleTrackId: '691', sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'z1' });
    expect([moved.selectedPathId, moved.selectedAudioTrackId, moved.selectedSubtitleTrackId, moved.sourceGeneration]).toEqual(['plex-hls', '613', '691', 2]);
    expect(seen.filter(r => r.method === 'PUT').map(r => [r.url.searchParams.get('subtitleStreamID'), r.url.searchParams.get('audioStreamID')])).toEqual([['691', '613']]);
    expect(seen.some(r => r.url.pathname.endsWith('/stop'))).toBe(true);
  });

  test('a stop of the old stream that never answers neither keeps the old plan nor holds later commands', async () => {
    const seen = route(movie('aac', aacFirst));
    const routed = globalThis.fetch;
    globalThis.fetch = Object.assign((input: string | URL | Request, init?: RequestInit) =>
      String(input).includes('/transcode/universal/stop') ? (seen.push({ method: 'GET', url: new URL(String(input)), headers: new Headers() }), new Promise<Response>(() => {})) : routed(input, init), { preconnect: () => {} }) as typeof fetch;
    const adapter = plex();
    const started = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'h' } as never);
    // The stream is started, so there is one to stop.
    await adapter.switchPath(started.sessionId, { kind: 'switch', pathId: 'plex-hls', atSeconds: 0, idempotencyKey: 'h0', sourceGeneration: 0, seekGeneration: 0 });
    const within = <T>(command: Promise<T>) => Promise.race([command, new Promise<never>((_, no) => setTimeout(() => no(new Error('held by the stop')), 200))]);
    const moved = await within(adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'h1' }));
    expect([moved.selectedPathId, moved.selectedAudioTrackId, moved.sourceGeneration]).toEqual(['plex-hls', '613', 2]);
    const again = await within(adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '614', sourceGeneration: 2, seekGeneration: 0, idempotencyKey: 'h2' }));
    expect([again.selectedPathId, again.selectedAudioTrackId, again.sourceGeneration]).toEqual(['plex-hls', '614', 3]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen.filter(r => r.url.pathname.endsWith('/stop')).map(r => r.url.searchParams.get('session'))).toEqual([started.sessionId, `${started.sessionId}-2`]);
  });

  test('a stacked title keeps an inferred track out of its plan, so a subtitle change on part two sends no audio of part one', async () => {
    const stacked = { ...twofold, Media: [{ ...twofold.Media[0]!, Part: twofold.Media[0]!.Part.map((p, i) => ({ ...p, Stream: [{ id: 11 + 10 * i, index: 1, streamType: 2, codec: 'aac' }] })) }] };
    const seen = routeFetch({ 'GET /library/metadata/1': { MediaContainer: { Metadata: [stacked] } }, 'POST /:/timeline': {}, 'GET /video/:/transcode/universal/decision': {}, 'PUT /library/parts/2': {} });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'st', positionSeconds: 0 } as never);
    await adapter.reportObservation(plan.sessionId, { sequence: 1, state: 'ended', positionSeconds: 30, sourceGeneration: 0, seekGeneration: 0 } as never);
    await adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'st1' });
    const decision = seen.filter(r => r.url.pathname.endsWith('/decision')).at(-1)!.url.searchParams;
    expect([decision.get('partIndex'), decision.get('audioStreamID')]).toEqual(['1', null]);
  });

  test('the original is allowed again only once the audio track can play on it', async () => {
    route(movie('aac', aacFirst));
    const adapter = plex();
    const started = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'o' } as never);
    const moved = await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'o1' });
    const back = (plan: typeof moved, key: string) => adapter.switchPath(started.sessionId, { kind: 'switch', pathId: 'original', atSeconds: 5, idempotencyKey: key, sourceGeneration: plan.sourceGeneration, seekGeneration: 0 });
    await expect(back(moved, 'o2')).rejects.toThrow('cannot play');
    const playable = await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '614', sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'o3' });
    expect((await back(playable, 'o4')).selectedPathId).toBe('original');
  });

  test('with no server stream, a track the original cannot play is refused before the part changes', async () => {
    const seen = route(movie('aac', aacFirst));
    const adapter = plex();
    const started = await adapter.startPlayback({ titleId: '6', client: appleClient(), idempotencyKey: 'n', allowTranscode: false } as never);
    expect(started.paths.map(p => p.id)).toEqual(['original']);
    await expect(adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'n1' })).rejects.toThrow('unavailable transcode');
    expect(seen.some(r => r.method === 'PUT')).toBe(false);
    expect((await adapter.sessionSnapshot(started.sessionId)).plan).toEqual(started);
  });
});

describe('Plex progress beside commands on a slow server', () => {
  const single = { ratingKey: '3', type: 'movie', title: 'Single', duration: 600000, Media: [{ id: 3, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', duration: 600000,
    Part: [{ id: 3, key: '/library/parts/3/1/file.mp4', duration: 600000, Stream: [{ id: 31, index: 1, streamType: 2, codec: 'aac', selected: true }, { id: 32, index: 2, streamType: 3, codec: 'pgs' }] }] }] };
  /** The server for a title whose first timeline post is held until `release`; later posts answer 500 while `failing`. */
  const slow = (title: { ratingKey: string } = single) => {
    const server = { failing: false, release: () => {} };
    const held = new Promise<void>(resolve => { server.release = resolve; });
    const seen = routeFetch({ [`GET /library/metadata/${title.ratingKey}`]: { MediaContainer: { Metadata: [title] } }, 'GET /video/:/transcode/universal/decision': {},
      'GET /video/:/transcode/universal/stop': {}, 'PUT /:/scrobble': {}, 'PUT /library/parts/3': {},
      'POST /:/timeline': () => server.failing ? new Response('', { status: 500 }) : {} });
    const routed = globalThis.fetch;
    let first = true;
    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const answer = await routed(input, init);
      if (first && String(input).includes('/:/timeline')) { first = false; await held; }
      return answer;
    }, { preconnect: () => {} }) as typeof fetch;
    const posts = () => seen.filter(r => r.url.pathname === '/:/timeline').map(r => `${r.url.searchParams.get('state')} ${Number(r.url.searchParams.get('time')) / 1000}`);
    return { server, seen, posts };
  };
  const at = (sequence: number, positionSeconds: number, state = 'playing') => ({ sequence, state, positionSeconds, sourceGeneration: 0, seekGeneration: 0 }) as never;
  const seek = (positionSeconds: number, idempotencyKey: string) => ({ kind: 'seek' as const, positionSeconds, idempotencyKey, sourceGeneration: 0, seekGeneration: 0 });

  test('progress waiting behind a slow post is sent once, as its newest, and a seek does not wait behind it', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'q', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 17))];
    await settle();
    for (const [sequence, position] of [[2, 18], [3, 19], [4, 20]] as const) reports.push(adapter.reportObservation(plan.sessionId, at(sequence, position)));
    const moved = adapter.command(plan.sessionId, seek(95, 'q1'));
    await settle();
    expect(posts()).toEqual(['playing 17']);
    server.release();
    expect(await Promise.all(reports)).toEqual(Array(4).fill({ accepted: true }));
    expect((await moved).positionSeconds).toBe(95);
    expect(posts()).toEqual(['playing 17', 'playing 95']);
    expect((await adapter.sessionSnapshot(plan.sessionId)).lastObservationSequence).toBe(4);
  });

  test('a pause reported behind a slow post is sent before the seek after it', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'p', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 17))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(2, 18)), adapter.reportObservation(plan.sessionId, at(3, 19, 'paused')), adapter.reportObservation(plan.sessionId, at(4, 20, 'paused')));
    const moved = adapter.command(plan.sessionId, seek(95, 'p1'));
    server.release();
    await Promise.all(reports);
    expect((await moved).state).toBe('paused');
    expect(posts()).toEqual(['playing 17', 'playing 18', 'paused 20', 'paused 95']);
  });

  test('a failed post fails every report it stood for, and the next one is sent', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'f', positionSeconds: 0 } as never);
    const first = adapter.reportObservation(plan.sessionId, at(1, 17));
    await settle();
    server.failing = true;
    const waiting = [[2, 18], [3, 19], [4, 20]].map(([sequence, position]) => adapter.reportObservation(plan.sessionId, at(sequence!, position!)));
    server.release();
    expect(await first).toEqual({ accepted: true });
    expect((await Promise.allSettled(waiting)).map(r => r.status === 'rejected' && r.reason instanceof VelaError)).toEqual([true, true, true]);
    server.failing = false;
    expect(await adapter.reportObservation(plan.sessionId, at(5, 21))).toEqual({ accepted: true });
    expect(posts()).toEqual(['playing 17', 'playing 20', 'playing 21']);
  });

  test('a stop is the last post, at the newest position, and progress after it sends nothing', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 's', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 17))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(2, 18)), adapter.reportObservation(plan.sessionId, at(3, 19)));
    const stopped = adapter.command(plan.sessionId, { kind: 'stop', idempotencyKey: 's1', sourceGeneration: 0, seekGeneration: 0 });
    server.release();
    await Promise.all(reports);
    expect((await stopped).state).toBe('ended');
    expect(await adapter.reportObservation(plan.sessionId, at(4, 20))).toEqual({ accepted: true });
    expect(posts()).toEqual(['playing 17', 'stopped 19']);
  });

  test('an older report waiting beside a newer one is not sent', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'o', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 17))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(3, 19)), adapter.reportObservation(plan.sessionId, at(2, 18)));
    const moved = adapter.command(plan.sessionId, seek(95, 'o1'));
    server.release();
    expect(await Promise.all(reports)).toEqual(Array(3).fill({ accepted: true }));
    await moved;
    expect(posts()).toEqual(['playing 17', 'playing 95']);
    expect((await adapter.sessionSnapshot(plan.sessionId)).lastObservationSequence).toBe(3);
  });

  test('an end waits for the progress before it and stops the timeline once', async () => {
    const { server, seen, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'e', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 17))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(2, 18)), adapter.reportObservation(plan.sessionId, at(3, 19)),
      adapter.reportObservation(plan.sessionId, at(4, 600.001, 'ended')), adapter.reportObservation(plan.sessionId, at(5, 600.001, 'ended')));
    server.release();
    await Promise.all(reports);
    expect(posts()).toEqual(['playing 17', 'playing 19', 'stopped 600']);
    const stopped = seen.find(r => r.url.searchParams.get('state') === 'stopped')!;
    expect(stopped.method).toBe('POST');
    expect(stopped.url.pathname).toBe('/:/timeline');
    expect(Object.fromEntries(stopped.url.searchParams)).toEqual({
      ratingKey: '3', key: '/library/metadata/3', time: '600000', duration: '600000', state: 'stopped',
      session: plan.sessionId, hasMDE: '1', identifier: 'com.plexapp.plugins.library', 'X-Plex-Session-Identifier': plan.sessionId,
    });
    expect(Object.fromEntries(stopped.headers)).toEqual({
      accept: 'application/json', 'x-plex-product': 'Vela', 'x-plex-version': '0.1.0',
      'x-plex-client-identifier': 'client-1', 'x-plex-platform': 'Web', 'x-plex-device': 'Browser',
      'x-plex-device-name': 'Test Device', 'x-plex-token': 'token-1',
    });
    expect(seen.filter(r => r.url.pathname === '/:/scrobble')).toHaveLength(0);
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan.state).toBe('ended');
  });

  test('one play-through sends exactly one view-recording request even when the player ends short of the library duration', async () => {
    const seen = routeFetch({
      'GET /library/metadata/3': { MediaContainer: { Metadata: [single] } },
      'POST /:/timeline': {}, 'PUT /:/scrobble': {}, 'GET /video/:/transcode/universal/stop': {},
    });
    const adapter = plex();
    const { sessionId } = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'play-through' } as never);
    await adapter.reportObservation(sessionId, at(1, 10));
    await adapter.reportObservation(sessionId, at(2, 590));
    await adapter.reportObservation(sessionId, at(3, 590, 'ended'));
    await adapter.reportObservation(sessionId, at(4, 590, 'ended'));
    const completion = seen.filter(r => r.url.pathname === '/:/scrobble'
      || r.url.pathname === '/:/timeline' && r.url.searchParams.get('state') === 'stopped');
    expect(completion.map(r => [r.method, r.url.pathname, r.url.searchParams.get('time')])).toEqual([
      ['POST', '/:/timeline', '600000'],
    ]);
  });

  test('a refused stopped timeline still scrobbles, cleans up, and ends the session', async () => {
    const seen = routeFetch({
      'GET /library/metadata/3': { MediaContainer: { Metadata: [single] } },
      'POST /:/timeline': new Response(null, { status: 400 }),
      'PUT /:/scrobble': new Response(null, { status: 204 }),
      'GET /video/:/transcode/universal/stop': new Response(null, { status: 204 }),
    });
    const adapter = plex();
    const { sessionId } = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'eos' } as never);
    expect(await adapter.reportObservation(sessionId, at(1, 601, 'ended'))).toEqual({ accepted: true });
    expect(await adapter.reportObservation(sessionId, at(2, 601, 'ended'))).toEqual({ accepted: true });
    expect(seen.slice(1).map(r => [r.method, r.url.pathname])).toEqual([
      ['POST', '/:/timeline'], ['PUT', '/:/scrobble'], ['GET', '/video/:/transcode/universal/stop'],
    ]);
    expect(Object.fromEntries(seen[2]!.url.searchParams)).toEqual({ key: '3', identifier: 'com.plexapp.plugins.library' });
    expect((await adapter.sessionSnapshot(sessionId)).plan.state).toBe('ended');
  });

  test('pagehide during a refused completion sends the scrobble fallback without another timeline', async () => {
    const { server, seen, posts } = slow();
    server.failing = true;
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'end-pagehide' } as never);
    const completion = adapter.reportObservation(plan.sessionId, at(1, 600, 'ended'));
    await settle();
    expect(adapter.unloadStop(plan.sessionId, plan).map(r => new URL(r.url).pathname)).toEqual(['/video/:/transcode/universal/stop']);
    server.release();
    expect(await completion).toEqual({ accepted: true });
    expect(posts()).toEqual(['stopped 600']);
    expect(seen.filter(r => r.url.pathname === '/:/scrobble')).toHaveLength(1);
  });

  test('a burned-in subtitle chosen behind a slow post starts the stream at the newest position, without its post', async () => {
    const { server, seen, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'b', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 5))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(2, 13)));
    const burned = adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '32', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'b1' });
    server.release();
    await Promise.all(reports);
    const stream = (await burned).paths.find(p => p.id === 'plex-hls')!;
    expect([new URL(stream.url!).searchParams.get('offset'), stream.timelineOriginSeconds]).toEqual(['13', 13]);
    expect(seen.filter(r => r.url.pathname.endsWith('/decision')).map(r => r.url.searchParams.get('offset'))).toEqual(['13']);
    expect(posts()).toEqual(['playing 5']);
  });

  test('a stacked title\'s next part follows each progress report before it, in order', async () => {
    const { server, posts } = slow(twofold);
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 't', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 28))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(2, 29)), adapter.reportObservation(plan.sessionId, at(3, 29.2)), adapter.reportObservation(plan.sessionId, at(4, 30, 'ended')));
    server.release();
    await Promise.all(reports);
    expect(posts()).toEqual(['playing 28', 'playing 29', 'playing 29.2', 'playing 30']);
    const next = (await adapter.sessionSnapshot(plan.sessionId)).plan;
    expect([next.state, next.positionSeconds, next.sourceGeneration, new URL(next.paths[0]!.url!).searchParams.get('partIndex')]).toEqual(['playing', 30, 1, '1']);
  });

  test('progress that reaches the end of a stacked title\'s part is not replaced by a later one', async () => {
    const { server, posts } = slow(twofold);
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '1', client, idempotencyKey: 'u', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 17))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(2, 29.6)), adapter.reportObservation(plan.sessionId, at(3, 29)));
    server.release();
    const settled = await Promise.allSettled(reports);
    expect(settled.map(r => r.status === 'fulfilled' || r.reason instanceof VelaError && r.reason.detail.code)).toEqual([true, true, 'stale_generation']);
    expect(posts()).toEqual(['playing 17', 'playing 30']);
    const next = (await adapter.sessionSnapshot(plan.sessionId)).plan;
    expect([next.sourceGeneration, new URL(next.paths[0]!.url!).searchParams.get('partIndex')]).toEqual([1, '1']);
  });

  for (const [from, to] of [['buffering', 'playing'], ['playing', 'buffering']] as const) {
    test(`${to} after ${from} is still sent before a command that does not post it`, async () => {
      const { server, posts } = slow();
      const adapter = plex();
      const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: `${to}`, positionSeconds: 0 } as never);
      const reports = [adapter.reportObservation(plan.sessionId, at(1, 17, from))];
      await settle();
      reports.push(adapter.reportObservation(plan.sessionId, at(2, 19, to)));
      const burned = adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '32', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: `${to}1` });
      server.release();
      await Promise.all(reports);
      await burned;
      expect(posts()).toEqual([`${from} 17`, `${to} 19`]);
    });
  }

  test('an invalid position waiting behind a slow post is refused, and the report after it is sent', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'i', positionSeconds: 0 } as never);
    const first = adapter.reportObservation(plan.sessionId, at(1, 17));
    await settle();
    const waiting = [adapter.reportObservation(plan.sessionId, at(2, -1)), adapter.reportObservation(plan.sessionId, at(3, 19))];
    server.release();
    await first;
    expect((await Promise.allSettled(waiting)).map(r => r.status)).toEqual(['rejected', 'fulfilled']);
    expect(posts()).toEqual(['playing 17', 'playing 19']);
  });

  test('a command for other generations does not take the waiting report\'s post', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'g', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 17))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(2, 19)));
    const stale = adapter.command(plan.sessionId, { kind: 'pause', idempotencyKey: 'g1', sourceGeneration: 0, seekGeneration: 1 });
    server.release();
    await Promise.all(reports);
    expect((await Promise.allSettled([stale]))[0]!.status).toBe('rejected');
    expect(posts()).toEqual(['playing 17', 'playing 19']);
  });

  test('progress taken over by a command still moves the session on from ready', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'r', positionSeconds: 0 } as never);
    const first = adapter.command(plan.sessionId, seek(5, 'r1'));
    await settle();
    const report = adapter.reportObservation(plan.sessionId, { sequence: 1, state: 'playing', positionSeconds: 17, sourceGeneration: 0, seekGeneration: 1 } as never);
    const again = adapter.command(plan.sessionId, { ...seek(40, 'r2'), seekGeneration: 1 });
    server.release();
    expect((await first).state).toBe('ready');
    expect(await report).toEqual({ accepted: true });
    expect((await again).state).toBe('playing');
    expect(posts()).toEqual(['playing 5', 'playing 40']);
  });

  test('a refused seek does not take the waiting report\'s post', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'n', positionSeconds: 0 } as never);
    const reports = [adapter.reportObservation(plan.sessionId, at(1, 17))];
    await settle();
    reports.push(adapter.reportObservation(plan.sessionId, at(2, 19)));
    const refused = adapter.command(plan.sessionId, seek(-1, 'n1'));
    server.release();
    await Promise.all(reports);
    expect((await Promise.allSettled([refused]))[0]!.status).toBe('rejected');
    expect(posts()).toEqual(['playing 17', 'playing 19']);
  });

  test('a command repeated with its key does not take the waiting report\'s post', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'k', positionSeconds: 0 } as never);
    const resume = { kind: 'resume' as const, idempotencyKey: 'k1', sourceGeneration: 0, seekGeneration: 0 };
    server.release();
    const resumed = await adapter.command(plan.sessionId, resume);
    const report = adapter.reportObservation(plan.sessionId, at(1, 17));
    const repeated = adapter.command(plan.sessionId, resume);
    expect(await report).toEqual({ accepted: true });
    expect(await repeated).toEqual(resumed);
    expect(posts()).toEqual(['playing 0', 'playing 17']);
  });

  test('a failed post for a command that took over the waiting reports fails each of them', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'x', positionSeconds: 0 } as never);
    const first = adapter.reportObservation(plan.sessionId, at(1, 17));
    await settle();
    const waiting = [adapter.reportObservation(plan.sessionId, at(2, 18)), adapter.reportObservation(plan.sessionId, at(3, 19))];
    const paused = adapter.command(plan.sessionId, { kind: 'pause', idempotencyKey: 'x1', sourceGeneration: 0, seekGeneration: 0 });
    server.failing = true;
    server.release();
    expect(await first).toEqual({ accepted: true });
    const settled = await Promise.allSettled([...waiting, paused]);
    expect(settled.map(r => r.status === 'rejected' && r.reason instanceof VelaError)).toEqual([true, true, true]);
    expect(posts()).toEqual(['playing 17', 'paused 19']);
  });

  test('a command repeated with its key while it is still in flight does not take the waiting report\'s post', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'w', positionSeconds: 0 } as never);
    const resume = { kind: 'resume' as const, idempotencyKey: 'w1', sourceGeneration: 0, seekGeneration: 0 };
    const resumed = adapter.command(plan.sessionId, resume);
    await settle();
    const report = adapter.reportObservation(plan.sessionId, at(1, 19));
    const repeated = adapter.command(plan.sessionId, resume);
    server.release();
    expect(await report).toEqual({ accepted: true });
    expect(await repeated).toEqual(await resumed);
    expect(posts()).toEqual(['playing 0', 'playing 19']);
  });

  /** Answers `status` to each request matching `method path` from here on. */
  const refuse = (method: string, path: string, status: number) => {
    const routed = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) =>
      (init?.method ?? 'GET') === method && new URL(String(input)).pathname === path ? new Response('', { status }) : routed(input, init), { preconnect: () => {} }) as typeof fetch;
  };

  test('a track change that fails on its own request after taking the waiting report\'s post still accepts the report', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 't', positionSeconds: 0 } as never);
    const first = adapter.reportObservation(plan.sessionId, at(1, 17));
    await settle();
    const report = adapter.reportObservation(plan.sessionId, at(2, 19));
    refuse('PUT', '/library/parts/3', 404);
    const tracks = adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '32', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 't1' });
    server.release();
    expect(await first).toEqual({ accepted: true });
    const settled = await Promise.allSettled([report, tracks]);
    expect(settled.map(r => r.status === 'fulfilled' ? r.value : r.reason instanceof VelaError && r.reason.status)).toEqual([{ accepted: true }, 404]);
    expect(posts()).toEqual(['playing 17']);
  });

  test('a stop whose timeline is accepted accepts the report it took over though its transcode stop fails', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'c', positionSeconds: 0 } as never);
    const first = adapter.reportObservation(plan.sessionId, at(1, 17));
    await settle();
    const report = adapter.reportObservation(plan.sessionId, at(2, 19));
    refuse('GET', '/video/:/transcode/universal/stop', 500);
    const stopped = adapter.command(plan.sessionId, { kind: 'stop', idempotencyKey: 'c1', sourceGeneration: 0, seekGeneration: 0 });
    server.release();
    expect(await first).toEqual({ accepted: true });
    const settled = await Promise.allSettled([report, stopped]);
    expect(settled.map(r => r.status === 'fulfilled' ? r.value : r.reason instanceof VelaError && r.reason.status)).toEqual([{ accepted: true }, 500]);
    expect(posts()).toEqual(['playing 17', 'stopped 19']);
  });

  /** Holds the next request matching `method path`, once answered, until the returned function is called. */
  const hold = (method: string, path: string) => {
    const routed = globalThis.fetch;
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let waiting = true;
    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      const answer = await routed(input, init);
      if (waiting && (init?.method ?? 'GET') === method && new URL(String(input)).pathname === path) { waiting = false; await held; }
      return answer;
    }, { preconnect: () => {} }) as typeof fetch;
    return release;
  };

  test('a command queued again with its key while a retry of it is in flight does not take the waiting report\'s post', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'v', positionSeconds: 0 } as never);
    const resume = { kind: 'resume' as const, idempotencyKey: 'v1', sourceGeneration: 0, seekGeneration: 0 };
    server.failing = true;
    const first = adapter.command(plan.sessionId, resume);
    await settle();
    const second = adapter.command(plan.sessionId, resume);
    const release = hold('POST', '/:/timeline');
    server.release();
    server.failing = false;
    expect(await first.catch(error => error instanceof VelaError && error.status)).toBe(500);
    await settle();
    expect(posts()).toEqual(['playing 0', 'playing 0']);
    const report = adapter.reportObservation(plan.sessionId, at(1, 19));
    const third = adapter.command(plan.sessionId, resume);
    release();
    expect(await report).toEqual({ accepted: true });
    expect(await third).toEqual(await second);
    expect(posts()).toEqual(['playing 0', 'playing 0', 'playing 19']);
  });

  test('a report taken over by a command that posts no timeline is answered once its position is applied, not when the command ends', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'a', positionSeconds: 0 } as never);
    const first = adapter.reportObservation(plan.sessionId, at(1, 17));
    await settle();
    const report = adapter.reportObservation(plan.sessionId, at(2, 19));
    const release = hold('PUT', '/library/parts/3');
    const tracks = adapter.changeTracks(plan.sessionId, { kind: 'tracks', subtitleTrackId: '32', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'a1' });
    server.release();
    expect(await first).toEqual({ accepted: true });
    expect(await Promise.race([report, settle().then(() => 'still waiting')])).toEqual({ accepted: true });
    release();
    expect((await tracks).positionSeconds).toBe(19);
    expect(posts()).toEqual(['playing 17']);
  });

  test('a report folded into a command leaves no abort listener behind once it settles', async () => {
    const add = AbortSignal.prototype.addEventListener, remove = AbortSignal.prototype.removeEventListener;
    let live = 0;
    AbortSignal.prototype.addEventListener = function (this: AbortSignal, type: string, ...rest: unknown[]) {
      if (type === 'abort') live++;
      return (add as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof add;
    AbortSignal.prototype.removeEventListener = function (this: AbortSignal, type: string, ...rest: unknown[]) {
      if (type === 'abort') live--;
      return (remove as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof remove;
    try {
      const { server } = slow();
      const adapter = plex();
      const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'l', positionSeconds: 0 } as never);
      let before = -1;
      for (let i = 0; i < 4; i++) {
        const first = adapter.reportObservation(plan.sessionId, at(3 * i + 1, 17 + i));
        await settle();
        if (before < 0) before = live;
        const folded = adapter.reportObservation(plan.sessionId, at(3 * i + 2, 18 + i));
        const resumed = adapter.command(plan.sessionId, { kind: 'resume', idempotencyKey: `l${i}`, sourceGeneration: 0, seekGeneration: 0 });
        server.release();
        expect(await first).toEqual({ accepted: true });
        expect(await folded).toEqual({ accepted: true });
        await resumed;
        await settle();
      }
      expect(live).toBeLessThanOrEqual(before);
    } finally {
      AbortSignal.prototype.addEventListener = add;
      AbortSignal.prototype.removeEventListener = remove;
    }
  });

  test('a report taken over by a pause is accepted when the page is unloaded during the pause\'s post', async () => {
    const { server, posts } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'u', positionSeconds: 0 } as never);
    const first = adapter.reportObservation(plan.sessionId, at(1, 17));
    await settle();
    const report = adapter.reportObservation(plan.sessionId, at(2, 19));
    const paused = adapter.command(plan.sessionId, { kind: 'pause', idempotencyKey: 'u1', sourceGeneration: 0, seekGeneration: 0 }).catch(error => error);
    const release = hold('POST', '/:/timeline');
    server.release();
    expect(await first).toEqual({ accepted: true });
    await settle();
    expect(posts()).toHaveLength(2);
    adapter.unloadStop(plan.sessionId, plan);
    expect(await Promise.race([report.catch(error => error), settle().then(() => 'still waiting')])).toEqual({ accepted: true });
    release();
    await paused;
  });

  test('a report taken over by a stop is accepted when the page is unloaded, though the stop\'s post later answers 404', async () => {
    const { server } = slow();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '3', client, idempotencyKey: 'z', positionSeconds: 0 } as never);
    const first = adapter.reportObservation(plan.sessionId, at(1, 17));
    await settle();
    const report = adapter.reportObservation(plan.sessionId, at(2, 19));
    const stopped = adapter.command(plan.sessionId, { kind: 'stop', idempotencyKey: 'z1', sourceGeneration: 0, seekGeneration: 0 }).catch(error => error);
    refuse('POST', '/:/timeline', 404);
    const release = hold('POST', '/:/timeline');
    server.release();
    expect(await first).toEqual({ accepted: true });
    await settle();
    adapter.unloadStop(plan.sessionId, plan);
    expect(await Promise.race([report.catch(error => error), settle().then(() => 'still waiting')])).toEqual({ accepted: true });
    release();
    await stopped;
    expect(await report).toEqual({ accepted: true });
  });
});

test.each(['pagehide before response', 'pagehide during cleanup', 'queued progress'] as const)('Plex sends one terminal timeline with %s', async race => {
  const timelineSent = Promise.withResolvers<void>();
  const timelineResponse = Promise.withResolvers<Response>();
  const cleanupSent = Promise.withResolvers<void>();
  const cleanupResponse = Promise.withResolvers<Response>();
  let cleanupAttempts = 0;
  const seen = routeFetch({
    'GET /library/metadata/9': { MediaContainer: { Metadata: [track] } },
    'POST /:/timeline': () => {
      timelineSent.resolve();
      return race === 'pagehide before response' ? timelineResponse.promise : new Response(null, { status: 204 });
    },
    'GET /music/:/transcode/universal/stop': () => {
      if (++cleanupAttempts > 1) return new Response(null, { status: 204 });
      cleanupSent.resolve();
      return cleanupResponse.promise;
    },
  });
  const adapter = plex();
  const { sessionId, sourceGeneration, seekGeneration } = await adapter.startPlayback({ titleId: '9', client, idempotencyKey: 'start' } as never);
  const at = { sourceGeneration, seekGeneration };
  const stopped = adapter.command(sessionId, { ...at, kind: 'stop', idempotencyKey: 'stop' }).catch(error => error);
  await (race === 'pagehide before response' ? timelineSent.promise : cleanupSent.promise);

  const page = new EventTarget();
  stopSessionsOnPageHide(page, {
    stopOnUnload(send) {
      const requests = adapter.unloadStop(sessionId, at);
      requests.forEach(send);
      return requests.length;
    },
  });
  const queued = race === 'queued progress' ? adapter.reportObservation(sessionId, {
    ...at, sequence: 1, state: 'playing', positionSeconds: 19, observedAt: '2026-01-01T00:00:00Z',
    idempotencyKey: 'progress', playableRanges: [], selectedPathId: 'plex-file',
  }) : undefined;
  if (race !== 'queued progress') page.dispatchEvent(new Event('pagehide'));
  timelineResponse.resolve(new Response(null, { status: 204 }));
  cleanupResponse.resolve(new Response(null, { status: 500 }));
  const [stopResult] = await Promise.all([stopped, queued]);
  if (race === 'queued progress') {
    expect(stopResult).toMatchObject({ status: 500 });
    expect(await adapter.command(sessionId, { ...at, kind: 'stop', idempotencyKey: 'retry' })).toMatchObject({ state: 'ended' });
  }
  expect(cleanupAttempts).toBe(race === 'pagehide before response' ? 1 : 2);
  expect(seen.filter(({ url }) => url.pathname === '/:/timeline').map(({ url }) => url.searchParams.get('state'))).toEqual(['stopped']);
});

test('Gallery pages Plex photos and albums and resolves an album without losing its photo tags', async () => {
  const galleryAlbum = { ratingKey: '26', type: 'photoalbum', title: 'Lake', childCount: 1, thumb: '/library/metadata/26/thumb/1' };
  const galleryPhoto = { ratingKey: '27', type: 'photo', title: 'Lake at sunset', originallyAvailableAt: '2026-01-03',
    parentRatingKey: '26', parentTitle: 'Lake', Tag: [{ tag: 'Travel' }], Media: [{ width: 1600, height: 1066 }] };
  const seen = routeFetch({
    'GET /library/sections': sections,
    'GET /library/sections/4/all': (r: Seen) => {
      const albums = r.url.searchParams.get('type') === '14';
      return { MediaContainer: { Metadata: albums ? [galleryAlbum] : [galleryPhoto], totalSize: 1, librarySectionID: 4 } };
    },
    'GET /library/metadata/26': { MediaContainer: { Metadata: [galleryAlbum], librarySectionID: 4 } },
    'GET /library/metadata/26/children': { MediaContainer: { Metadata: [{ ratingKey: '25', type: 'clip', title: 'Clip' }, galleryPhoto], totalSize: 3 } },
  });
  const adapter = plex();
  expect((await adapter.library('4', { tab: 'photo-timeline', sort: 'released', direction: 'desc' })).items).toMatchObject([
    { kind: 'title', title: { id: '27', airDate: '2026-01-03', media: { class: 'photo', role: 'item' } } },
  ]);
  expect(seen.at(-1)!.url.searchParams.get('type')).toBe('13');
  expect(seen.at(-1)!.url.searchParams.get('sort')).toBe('originallyAvailableAt:desc');
  expect((await adapter.library('4', { tab: 'photo-albums' })).items).toMatchObject([
    { kind: 'title', title: { id: 'album:26', media: { class: 'photo', role: 'album', childCount: 1 } } },
  ]);
  expect((await adapter.detail('album:26')).title.id).toBe('album:26');
  const children = await adapter.children('album:26', undefined, 2);
  expect(children.nextCursor).toBe('2');
  expect(children.items).toMatchObject([{ id: '27', media: {
    parents: [{ id: 'album:26', name: 'Lake', role: 'album' }],
    facts: [{ label: 'Size', value: '1600 × 1066' }, { label: 'Tags', value: 'Travel' }],
  } }]);
  expect(seen.at(-1)!.url.searchParams.has('excludeAllLeaves')).toBe(false);
});
