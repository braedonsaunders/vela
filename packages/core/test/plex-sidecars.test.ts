// Plex sidecar subtitles: ASS/SSA reach a player that draws them as the authored file; everything
// else, and ASS for a player that does not, is converted to WebVTT by the server.
import { afterEach, describe, expect, test } from 'bun:test';
import { PlexAdapter } from '../src/adapter/plex';
import { isTextSidecar, plexSidecar } from '../src/adapter/plex/media';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);

const ORIGIN = 'https://plex.example:32400';
const at = (path: string) => new URL(path, ORIGIN);

describe('plexSidecar', () => {
  test('ASS and SSA come as the file itself, in UTF-8, where the player names the codec', () => {
    expect(plexSidecar(at('/library/streams/7'), 'ass', ['webvtt', 'ass', 'ssa'])).toEqual({ url: `${ORIGIN}/library/streams/7.ass?encoding=utf-8`, format: 'ass' });
    expect(plexSidecar(at('/library/streams/8'), 'SSA', ['webvtt', 'ass', 'ssa'])).toEqual({ url: `${ORIGIN}/library/streams/8.ass?encoding=utf-8`, format: 'ass' });
  });

  test('a player that does not draw the codec, and every other text format, gets WebVTT', () => {
    expect(plexSidecar(at('/library/streams/7'), 'ass', ['webvtt'])).toEqual({ url: `${ORIGIN}/library/streams/7?format=vtt`, format: 'webvtt' });
    // Declaring ASS does not cover SSA: the codec itself must be named.
    expect(plexSidecar(at('/library/streams/8'), 'ssa', ['webvtt', 'ass']).format).toBe('webvtt');
    expect(plexSidecar(at('/library/streams/9'), 'srt', ['webvtt', 'srt', 'ass']).format).toBe('webvtt');
  });

  test('a key that already names a file keeps it', () => {
    expect(plexSidecar(at('/library/streams/7.ass'), 'ass', ['ass']).url).toBe(`${ORIGIN}/library/streams/7.ass?encoding=utf-8`);
  });

  test('text sidecars are the formats the server can convert', () => {
    for (const codec of ['srt', 'SubRip', 'ass', 'ssa', 'vtt', 'webvtt', 'text']) expect(isTextSidecar(codec)).toBe(true);
    for (const codec of ['pgs', 'vobsub', undefined]) expect(isTextSidecar(codec)).toBe(false);
  });
});

describe('Plex sidecar delivery', () => {
  const streams = [
    { id: 31, streamType: 3, codec: 'ass', key: '/library/streams/31', languageCode: 'jpn', displayTitle: 'Japanese (ASS)' },
    { id: 32, streamType: 3, codec: 'srt', key: '/library/streams/32', languageCode: 'eng', displayTitle: 'English (SRT)' },
    { id: 33, streamType: 3, codec: 'pgs', key: '/library/streams/33', languageCode: 'eng' },
    { id: 34, streamType: 3, codec: 'ass', index: 4, languageCode: 'eng' },
  ];
  const movie = { ratingKey: '6', type: 'movie', title: 'Signs', duration: 60_000, Media: [{ id: 6, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
    Part: [{ id: 66, key: '/library/parts/66/file.mp4', Stream: streams }] }] };
  const client = (subtitleFormats: string[]) => ({ device: { id: 'd', name: 'd', platform: 'ios', appVersion: '1' }, containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats, hls: true, mse: false }) as never;
  const adapter = () => new PlexAdapter({ origin: ORIGIN, credentials: new FakeCredentials(), clientIdentifier: 'c' });

  test('a player that draws ASS gets the ASS sidecar as ASS; SRT stays WebVTT, PGS burns in, embedded stays embedded', async () => {
    routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [movie] } } });
    const plan = await adapter().startPlayback({ titleId: '6', client: client(['webvtt', 'srt', 'ass', 'ssa', 'pgs']), idempotencyKey: 'a' } as never);
    const [ass, srt, pgs, embedded] = plan.subtitleTracks;
    expect(ass).toMatchObject({ codec: 'ass', delivery: { kind: 'external', format: 'ass', url: `${ORIGIN}/library/streams/31.ass?encoding=utf-8` } });
    // Track.url stays WebVTT-only, for readers that know no other format.
    expect(ass!.url).toBeUndefined();
    expect(srt).toMatchObject({ url: `${ORIGIN}/library/streams/32?format=vtt`, delivery: { kind: 'external', format: 'webvtt', url: `${ORIGIN}/library/streams/32?format=vtt` } });
    expect(pgs!.delivery).toEqual({ kind: 'burn-in' });
    expect(embedded!.delivery).toEqual({ kind: 'embedded' });
  });

  test('a player that does not draw ASS gets the same sidecar converted to WebVTT', async () => {
    routeFetch({ 'GET /library/metadata/6': { MediaContainer: { Metadata: [movie] } } });
    const plan = await adapter().startPlayback({ titleId: '6', client: client(['webvtt']), idempotencyKey: 'b' } as never);
    expect(plan.subtitleTracks[0]).toMatchObject({ codec: 'ass', url: `${ORIGIN}/library/streams/31?format=vtt`, delivery: { kind: 'external', format: 'webvtt' } });
  });

  test('a subtitle added mid-session is delivered in a format the player declared at the start', async () => {
    let added = false;
    const found = { id: 41, streamType: 3, codec: 'ass', key: '/library/streams/41', languageCode: 'eng', displayTitle: 'English (ASS)' };
    const metadata = () => ({ MediaContainer: { Metadata: [{ ...movie, Media: [{ ...movie.Media[0]!, Part: [{ ...movie.Media[0]!.Part[0]!, Stream: added ? [...streams, found] : streams }] }] }] } });
    routeFetch({ 'GET /library/metadata/6': metadata, 'PUT /library/metadata/6/subtitles': () => { added = true; return {}; } });
    for (const [formats, format, url] of [[['webvtt', 'ass'], 'ass', `${ORIGIN}/library/streams/41.ass?encoding=utf-8`], [['webvtt'], 'webvtt', `${ORIGIN}/library/streams/41?format=vtt`]] as const) {
      added = false;
      const plex = adapter();
      const plan = await plex.startPlayback({ titleId: '6', client: client([...formats]), idempotencyKey: `s-${format}` } as never);
      const next = await plex.downloadSubtitle(plan.sessionId, 'offer-1');
      const track = next.subtitleTracks.find(t => t.id === '41');
      expect(track).toMatchObject({ codec: format === 'ass' ? 'ass' : 'webvtt', delivery: { kind: 'external', format, url } });
    }
  });
});
