import { afterEach, describe, expect, test } from 'bun:test';
import { PlexAdapter } from '../src/adapter/plex';
import { partAt, plexProjection } from '../src/adapter/plex/media';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

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
    expect(plexProjection({ type: 'photo', title: 'IMG_0001', Media: [{ Part: [{}] }] })).toEqual({ kind: 'movie', media: { class: 'photo', role: 'item' } });
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
      ['Photos', 'photo', 'landscape', ['recommended', 'library']],
    ]);
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
      'POST /:/timeline': {}, 'GET /video/:/transcode/universal/stop': {}, 'PUT /:/scrobble': {},
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
