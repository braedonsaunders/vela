import { afterEach, describe, expect, test } from 'bun:test';
import { libraryExperience } from '../src/library-presentation';
import { PlexAdapter } from '../src/adapter/plex';
import { partAt, plexProjection } from '../src/adapter/plex/media';
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
      ['Photos', 'photo', 'square', ['recommended', 'library']],
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
    expect(seen.some(r => r.url.pathname === '/:/scrobble')).toBe(true);
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

  test('a refused decision fails the start, unless the original file can play instead', async () => {
    routeFetch({ 'GET /library/metadata/3': { MediaContainer: { Metadata: [single] } }, 'GET /video/:/transcode/universal/decision': new Response('', { status: 400 }) });
    await expect(plex().startPlayback({ titleId: '3', client, idempotencyKey: 'r' } as never)).rejects.toThrow('Plex request failed (400)');
    routeFetch({ 'GET /library/metadata/3': { MediaContainer: { Metadata: [mp4] } }, 'GET /video/:/transcode/universal/decision': new Response('', { status: 400 }) });
    const plan = await plex().startPlayback({ titleId: '3', client, idempotencyKey: 'o' } as never);
    expect(plan.paths.map(p => p.id)).toEqual(['original']);
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
      'GET /video/:/transcode/universal/decision': (q: Seen) => q.url.searchParams.get('session')!.endsWith('-1') ? { MediaContainer: { generalDecisionCode: 2000 } } : { MediaContainer: {} } });
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
        'GET /video/:/transcode/universal/decision': (q: Seen) => q.url.searchParams.get('session')!.endsWith('-1') ? refusal() : { MediaContainer: {} } });
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
    const moved = await adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', subtitleTrackId: '691', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'z1' });
    expect([moved.selectedPathId, moved.selectedAudioTrackId, moved.selectedSubtitleTrackId, moved.sourceGeneration]).toEqual(['plex-hls', '613', '691', 1]);
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
    const within = <T>(command: Promise<T>) => Promise.race([command, new Promise<never>((_, no) => setTimeout(() => no(new Error('held by the stop')), 200))]);
    const moved = await within(adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '613', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'h1' }));
    expect([moved.selectedPathId, moved.selectedAudioTrackId, moved.sourceGeneration]).toEqual(['plex-hls', '613', 1]);
    const again = await within(adapter.changeTracks(started.sessionId, { kind: 'tracks', audioTrackId: '614', sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'h2' }));
    expect([again.selectedPathId, again.selectedAudioTrackId, again.sourceGeneration]).toEqual(['plex-hls', '614', 2]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen.filter(r => r.url.pathname.endsWith('/stop')).map(r => r.url.searchParams.get('session'))).toEqual([started.sessionId, `${started.sessionId}-1`]);
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
