// Skip markers (intro and credits) on plans from every kind of server, the skip button's action, and
// the next episode a player offers.
import { afterEach, describe, expect, test } from 'bun:test';
import { markerAt, skipAction, skipMarkers } from '../src/protocol/markers';
import { plexMarkers } from '../src/adapter/plex/media';
import { jellyfinMarkers } from '../src/adapter/jellyfin/media';
import { episodeAfter } from '../src/adapter/series';
import { PlexAdapter } from '../src/adapter/plex';
import { JellyfinAdapter } from '../src/adapter/jellyfin';
import { EtherAdapter } from '../src/adapter/ether';
import type * as V from '../src/wire';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);

/** Ether's example: an intro, credits broken by a scene, and the tail credits. */
const etherMarkers: V.SkipMarker[] = [
  { kind: 'intro', startSeconds: 30.5, endSeconds: 92.25 },
  { kind: 'credits', startSeconds: 2880, endSeconds: 2910 },
  { kind: 'credits', startSeconds: 2940, endSeconds: 3000, final: true },
];

describe('skip markers', () => {
  test('keep intro and credits, well formed and sorted, final on the last credits only', () => {
    expect(skipMarkers([
      { kind: 'credits', startSeconds: 2940, endSeconds: 3000, final: true },
      { kind: 'intro', startSeconds: 30.5, endSeconds: 92.25 },
      { kind: 'credits', startSeconds: 2880, endSeconds: 2910, final: true },
      { kind: 'recap' as never, startSeconds: 0, endSeconds: 20 },
      { kind: 'intro', startSeconds: 50, endSeconds: 40 },
      { kind: 'intro', startSeconds: Number.NaN, endSeconds: 40 },
    ], 3000)).toEqual(etherMarkers);
  });

  test('tail credits are final when they end at the end of the title; a range past the end is cut there', () => {
    expect(skipMarkers([{ kind: 'credits', startSeconds: 1700, endSeconds: 1799 }], 1800)).toEqual([{ kind: 'credits', startSeconds: 1700, endSeconds: 1799, final: true }]);
    expect(skipMarkers([{ kind: 'credits', startSeconds: 1700, endSeconds: 1900 }], 1800)).toEqual([{ kind: 'credits', startSeconds: 1700, endSeconds: 1800, final: true }]);
    expect(skipMarkers([{ kind: 'credits', startSeconds: 1500, endSeconds: 1600 }], 1800)).toEqual([{ kind: 'credits', startSeconds: 1500, endSeconds: 1600 }]);
    expect(skipMarkers([{ kind: 'intro', startSeconds: 1900, endSeconds: 1950 }], 1800)).toBeUndefined();
  });

  test('no ranges is no field', () => {
    expect(skipMarkers([])).toBeUndefined();
  });

  test('the range a position is inside: from its start, up to its end', () => {
    expect(markerAt(etherMarkers, 30.5)?.kind).toBe('intro');
    expect(markerAt(etherMarkers, 92.25)).toBeNull();
    expect(markerAt(etherMarkers, 2900)?.endSeconds).toBe(2910);
    expect(markerAt(etherMarkers, 2920)).toBeNull();
    expect(markerAt(undefined, 40)).toBeNull();
  });

  test('the skip button skips to a range\'s end; only the final credits of an episode with a next one start it', () => {
    expect(skipAction(etherMarkers, 40, true)).toEqual({ kind: 'intro', toSeconds: 92.25 });
    // Seeking back into the intro offers it again.
    expect(skipAction(etherMarkers, 31, false)).toEqual({ kind: 'intro', toSeconds: 92.25 });
    expect(skipAction(etherMarkers, 2890, true)).toEqual({ kind: 'credits', toSeconds: 2910 });
    expect(skipAction(etherMarkers, 2950, true)).toEqual({ kind: 'next' });
    expect(skipAction(etherMarkers, 2950, false)).toEqual({ kind: 'credits', toSeconds: 3000 });
    expect(skipAction(etherMarkers, 1000, true)).toBeNull();
  });
});

describe('server markers', () => {
  test('Plex markers are milliseconds; final comes as a flag', () => {
    const node = { duration: 3_000_000, Marker: [
      { type: 'intro', startTimeOffset: 30_500, endTimeOffset: 92_250 },
      { type: 'commercial', startTimeOffset: 1_000_000, endTimeOffset: 1_100_000 },
      { type: 'credits', startTimeOffset: 2_880_000, endTimeOffset: 2_910_000, final: false },
      { type: 'credits', startTimeOffset: 2_940_000, endTimeOffset: 3_000_000, final: '1' },
    ] };
    expect(plexMarkers(node)).toEqual(etherMarkers);
    expect(plexMarkers({ duration: 1000 })).toBeUndefined();
  });

  test('Jellyfin intro and outro segments are the intro and the credits', () => {
    const t = (s: number) => s * 10_000_000;
    expect(jellyfinMarkers([
      { Type: 'Recap', StartTicks: 0, EndTicks: t(30) },
      { Type: 'Intro', StartTicks: t(30.5), EndTicks: t(92.25) },
      { Type: 'Outro', StartTicks: t(2880), EndTicks: t(2910) },
      { Type: 'Preview', StartTicks: t(2910), EndTicks: t(2940) },
      { Type: 'Outro', StartTicks: t(2940), EndTicks: t(3000) },
    ], 3000)).toEqual(etherMarkers);
    expect(jellyfinMarkers(undefined, 3000)).toBeUndefined();
  });
});

describe('plans carry markers', () => {
  const client = { device: { id: 'd', name: 'd', platform: 'web', appVersion: '1' }, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [], hls: true, mse: true } as never;

  test('Ether\'s markers pass through as the server sent them', async () => {
    const plan = { sessionId: 's1', revision: 1, sourceGeneration: 0, seekGeneration: 0, state: 'ready', positionSeconds: 0, paths: [], selectedPathId: '', audioTracks: [], subtitleTracks: [],
      selectedSubtitleTrackId: null, chapters: [], fallback: { state: 'unsupported' }, markers: etherMarkers };
    routeFetch({ 'POST /vela/v0/playback': plan });
    const answer = await new EtherAdapter('https://ether.example', new FakeCredentials(), 'web-1').startPlayback({ titleId: 't', client, idempotencyKey: 'k' });
    expect('markers' in answer && answer.markers).toEqual(etherMarkers);
  });

  describe('Plex', () => {
    const ORIGIN = 'https://plex.example:32400';
    const episode = (markers?: object[]) => ({ ratingKey: '7', type: 'episode', title: 'Pilot', duration: 3_000_000, ...(markers ? { Marker: markers } : {}),
      Media: [{ id: 7, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', Part: [{ id: 77, key: '/library/parts/77/file.mp4' }] }] });
    const plex = () => new PlexAdapter({ origin: ORIGIN, credentials: new FakeCredentials(), clientIdentifier: 'c' });
    const intro = { type: 'intro', startTimeOffset: 30_500, endTimeOffset: 92_250 };

    test('asks for markers and puts them on the plan', async () => {
      const seen = routeFetch({ 'GET /library/metadata/7': { MediaContainer: { Metadata: [episode([intro])] } } });
      const plan = await plex().startPlayback({ titleId: '7', client, idempotencyKey: 'k' } as never);
      expect(seen[0]!.url.searchParams.get('includeMarkers')).toBe('1');
      expect(plan.markers).toEqual([{ kind: 'intro', startSeconds: 30.5, endSeconds: 92.25 }]);
    });

    test('markers the server learns once the session streams reach the plan on a later snapshot', async () => {
      let known = false, reads = 0;
      routeFetch({ 'GET /library/metadata/7': () => { reads++; return { MediaContainer: { Metadata: [episode(known ? [intro] : undefined)] } }; } });
      const realNow = Date.now;
      let now = realNow();
      Date.now = () => now;
      try {
        const adapter = plex();
        const plan = await adapter.startPlayback({ titleId: '7', client, idempotencyKey: 'k' } as never);
        expect(plan.markers).toBeUndefined();
        // Not asked again at once.
        await adapter.sessionSnapshot(plan.sessionId);
        expect(reads).toBe(1);
        now += 31_000;
        await adapter.sessionSnapshot(plan.sessionId);
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(reads).toBe(2);
        known = true;
        now += 31_000;
        await adapter.sessionSnapshot(plan.sessionId);
        for (let i = 0; i < 10; i++) await Promise.resolve();
        const snapshot = await adapter.sessionSnapshot(plan.sessionId);
        expect(snapshot.plan.markers).toEqual([{ kind: 'intro', startSeconds: 30.5, endSeconds: 92.25 }]);
        expect(snapshot.revision).toBeGreaterThan(plan.revision);
        // Found: never asked again.
        now += 31_000;
        await adapter.sessionSnapshot(plan.sessionId);
        expect(reads).toBe(3);
      } finally { Date.now = realNow; }
    });
  });

  describe('Jellyfin', () => {
    const source = { Id: 'media', SupportsDirectPlay: true, Container: 'mp4', RunTimeTicks: 30_000_000_000, MediaStreams: [] };
    const routes = (segments: unknown) => ({
      'GET /Users/viewer-1/Items/10': { Id: '10', Type: 'Episode', Name: 'Pilot', MediaSources: [source] },
      'POST /Items/10/PlaybackInfo': { PlaySessionId: 'session', MediaSources: [source] },
      'GET /MediaSegments/10': segments,
    });

    test('reads intro and outro segments beside the playback answer', async () => {
      const seen = routeFetch(routes({ Items: [{ Type: 'Intro', StartTicks: 305_000_000, EndTicks: 922_500_000 }, { Type: 'Outro', StartTicks: 29_400_000_000, EndTicks: 30_000_000_000 }] }));
      const plan = await new JellyfinAdapter('https://test.example', new FakeCredentials()).startPlayback({ titleId: '10', client, idempotencyKey: 'k' });
      expect(seen.find(r => r.url.pathname === '/MediaSegments/10')!.url.searchParams.getAll('includeSegmentTypes')).toEqual(['Intro', 'Outro']);
      expect(plan.markers).toEqual([{ kind: 'intro', startSeconds: 30.5, endSeconds: 92.25 }, { kind: 'credits', startSeconds: 2940, endSeconds: 3000, final: true }]);
    });

    test('a server without media segments plays without markers', async () => {
      routeFetch(routes(new Response('not found', { status: 404 })));
      const plan = await new JellyfinAdapter('https://test.example', new FakeCredentials()).startPlayback({ titleId: '10', client, idempotencyKey: 'k' });
      expect(plan.markers).toBeUndefined();
    });
  });
});

describe('the next episode', () => {
  const ep = (season: number, episode: number, seasonId = `s${season}`): V.Title => ({ id: `e${season}-${episode}`, kind: 'episode', name: `E${episode}`, summary: '', genres: [], artwork: [],
    showId: 'show', seasonId, seasonNumber: season, episodeNumber: episode } as V.Title);
  const season = (n: number): V.Title => ({ id: `s${n}`, kind: 'season', name: `Season ${n}`, summary: '', genres: [], artwork: [], showId: 'show', seasonNumber: n } as V.Title);
  const detail = (title: V.Title, extra: Partial<V.TitleDetail> = {}): V.TitleDetail => ({ title, extras: [], chapters: [], cast: [], ...extra });
  /** A server whose show lists only its first season's episodes, as Ether's may. */
  const server = (seasons: Record<number, V.Title[]>, showEpisodes = seasons[1] ?? []) => {
    const reads: string[] = [];
    const read = async (id: string) => {
      reads.push(id);
      if (id === 'show') return detail({ ...season(0), id: 'show', kind: 'show' }, { seasons: Object.keys(seasons).map(Number).map(season).reverse(), episodes: showEpisodes });
      const n = Number(id.slice(1));
      if (!seasons[n]) throw new Error('missing');
      return detail(season(n), { episodes: [...seasons[n]!].reverse() });
    };
    return { reads, read };
  };
  const ref = (t: V.Title) => ({ id: t.id, showId: t.showId, seasonId: t.seasonId, seasonNumber: t.seasonNumber });

  test('the next in its season, in episode order, from the season alone', async () => {
    const { reads, read } = server({ 1: [ep(1, 1), ep(1, 2), ep(1, 3)] });
    expect((await episodeAfter(ref(ep(1, 1)), read))?.id).toBe('e1-2');
    expect(reads).toEqual(['s1']);
  });

  test('after a season\'s last, the first of the next season with episodes', async () => {
    const { read } = server({ 1: [ep(1, 1), ep(1, 2)], 2: [], 3: [ep(3, 2), ep(3, 1)] });
    expect((await episodeAfter(ref(ep(1, 2)), read))?.id).toBe('e3-1');
  });

  test('specials follow the regular run; the last episode has none after it', async () => {
    const { read } = server({ 0: [ep(0, 1)], 1: [ep(1, 1)] });
    expect((await episodeAfter(ref(ep(1, 1)), read))?.id).toBe('e0-1');
    expect(await episodeAfter(ref(ep(0, 1)), read)).toBeNull();
  });

  test('without a readable season, the show\'s own list', async () => {
    const { read } = server({ 1: [ep(1, 1), ep(1, 2)] });
    expect((await episodeAfter({ id: 'e1-1', showId: 'show', seasonId: 'gone' }, read))?.id).toBe('e1-2');
    expect(await episodeAfter({ id: 'e1-1' }, read)).toBeNull();
    expect(await episodeAfter({ id: 'x', showId: 'nowhere' }, async () => { throw new Error('offline'); })).toBeNull();
  });
});
