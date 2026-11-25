import { afterEach, describe, expect, test } from 'bun:test';
import { PlexAdapter } from '../src/adapter/plex';
import { advertise } from '../src/adapter/advertise';
import { hasVersions } from '../src/adapter/capabilities';
import { VelaError } from '../src/adapter/errors';
import { plexVersion } from '../src/adapter/plex/media';
import { FakeCredentials, restoreFetch, routeFetch, type Seen } from './helpers';

afterEach(restoreFetch);

// A movie Plex holds as two files: a 4K HEVC HDR10 remux and a 1080p H.264 optimized copy
// (`proxyType` 42), trimmed to the fields the adapter reads.
const ORIGIN = 'https://plex.example:32400';
const plex = () => new PlexAdapter({ origin: ORIGIN, credentials: new FakeCredentials(), clientIdentifier: 'client-1' });
const remux = { id: 51, container: 'mkv', videoCodec: 'hevc', videoResolution: '4k', audioCodec: 'truehd', audioChannels: 8, width: 3840, height: 2160, duration: 60000,
  Part: [{ id: 511, key: '/library/parts/511/1/file.mkv', size: 60_000_000_000, duration: 60000, Stream: [
    { id: 5111, index: 0, streamType: 1, codec: 'hevc', colorTrc: 'smpte2084' },
    { id: 5112, index: 1, streamType: 2, codec: 'truehd', channels: 8, selected: true }] }] };
const optimized = { id: 52, proxyType: 42, container: 'mp4', videoCodec: 'h264', videoResolution: '1080', audioCodec: 'aac', audioChannels: 2, width: 1920, height: 1080, duration: 60000,
  Part: [{ id: 521, key: '/library/parts/521/1/file.mp4', size: 4_000_000_000, duration: 60000, Stream: [
    { id: 5211, index: 0, streamType: 1, codec: 'h264', colorTrc: 'bt709' },
    { id: 5212, index: 1, streamType: 2, codec: 'aac', channels: 2, selected: true }] }] };
const movie = { ratingKey: '5', type: 'movie', title: 'Two Copies', duration: 60000, Media: [remux, optimized] };
const single = { ...movie, ratingKey: '6', title: 'One Copy', Media: [optimized] };
// A 30-second cut of the same title, resumed by Plex at 45 s of the title's 60.
const short = { ...optimized, id: 54, duration: 30000, Part: [{ ...optimized.Part[0]!, id: 541, key: '/library/parts/541/1/file.mp4', duration: 30000 }] };
const cut = { ...movie, ratingKey: '7', title: 'Two Lengths', viewOffset: 45000, Media: [optimized, short] };
// A file Plex lists without a part (nothing to play), between the two that have one.
const partless = { id: 53, container: 'mp4', videoCodec: 'h264', videoResolution: '720', audioCodec: 'ac3', audioChannels: 6, duration: 60000 };
const gap = { ...movie, ratingKey: '8', title: 'Missing Copy', Media: [remux, partless, optimized] };
// A browser: plays the MP4 copy as its file; the MKV/HEVC remux only through the server's stream.
const client = { device: { id: 'd', name: 'd', platform: 'web', appVersion: '1' }, containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [], hls: true, mse: true } as never;

function route(refuse: (decision: URL) => boolean = () => false) {
  return routeFetch({
    'GET /identity': { MediaContainer: { machineIdentifier: 'm' } },
    'GET /library/metadata/5': { MediaContainer: { Metadata: [movie] } },
    'GET /library/metadata/6': { MediaContainer: { Metadata: [single] } },
    'GET /library/metadata/7': { MediaContainer: { Metadata: [cut] } },
    'GET /library/metadata/8': { MediaContainer: { Metadata: [gap] } },
    'GET /video/:/transcode/universal/decision': (r: Seen) => refuse(r.url) ? new Response('refused', { status: 400 }) : { MediaContainer: {} },
    'GET /video/:/transcode/universal/stop': {},
  });
}
const hls = (plan: { paths: { id: string; url?: string }[] }) => new URL(plan.paths.find(p => p.id === 'plex-hls')!.url!).searchParams;
const at = (seen: { url: URL }[], path: string, session?: string) => seen.findIndex(r => r.url.pathname === `/video/:/transcode/universal/${path}` && (!session || r.url.searchParams.get('session') === session));
const original = (plan: { paths: { id: string; url?: string }[] }) => plan.paths.find(p => p.id === 'original')?.url && new URL(plan.paths.find(p => p.id === 'original')!.url!).pathname;

describe('Plex versions', () => {
  test('a title with two files lists both, labelled from Plex\'s facts, and the server offers versions', async () => {
    route();
    const adapter = plex();
    expect(hasVersions(adapter)).toBe(true);
    expect(advertise(adapter, await adapter.describe()).features.versions).toEqual({ available: true });
    expect(await adapter.titleVersions('5')).toEqual({ titleId: '5', selectedVersionId: null, versions: [
      { id: '51', label: '4K HDR10 HEVC · TrueHD 7.1', recommended: true, resolution: '4K', dynamicRange: 'hdr10', videoCodec: 'hevc',
        audio: { codec: 'truehd', channels: '7.1' }, sizeBytes: 60_000_000_000, availability: 'instant' },
      { id: '52', label: '1080p H.264 · Optimized · AAC 2.0', recommended: false, resolution: '1080p', dynamicRange: 'sdr', videoCodec: 'h264',
        audio: { codec: 'aac', channels: '2.0' }, sizeBytes: 4_000_000_000, availability: 'instant' },
    ] });
    expect(await adapter.clearVersionChoice('5', { idempotencyKey: 'c' })).toEqual({ ...(await adapter.titleVersions('5')), cleared: false });
  });

  test('a DTS-HD MA file is labelled as such, while its audio codec is the decoder name', () => {
    const ma = plexVersion({ ...remux, audioCodec: 'dca-ma' }, 0);
    expect(ma.label).toBe('4K HDR10 HEVC · DTS-HD MA 7.1');
    expect(ma.audio).toEqual({ codec: 'dts', channels: '7.1' });
    expect(plexVersion({ ...remux, audioCodec: 'dca' }, 0).label).toBe('4K HDR10 HEVC · DTS 7.1');
  });

  test('a start without a version plays the first file and says so', async () => {
    route();
    const plan = await plex().startPlayback({ titleId: '5', client, idempotencyKey: 'a' } as never);
    expect(plan.paths.map(p => p.id)).toEqual(['plex-hls']);
    expect(hls(plan).get('mediaIndex')).toBe('0');
    expect(plan.selectedVersionId).toBe('51');
    expect(plan.versions?.map(v => v.id)).toEqual(['51', '52']);
  });

  test('a start with the second version plays that file, and its stream asks for that media', async () => {
    route();
    const plan = await plex().startPlayback({ titleId: '5', client, idempotencyKey: 'b', versionId: '52' } as never);
    expect(plan.selectedPathId).toBe('original');
    expect(original(plan)).toBe('/library/parts/521/1/file.mp4');
    expect(hls(plan).get('mediaIndex')).toBe('1');
    expect(plan.audioTracks.map(t => t.id)).toEqual(['5212']);
    expect(plan.selectedVersionId).toBe('52');
  });

  test('an unknown version fails clearly', async () => {
    route();
    await expect(plex().startPlayback({ titleId: '5', client, idempotencyKey: 'x', versionId: '99' } as never)).rejects.toThrow('Unknown Plex version');
  });

  test('switching version stops the running stream and plays the other file at the position, in the same session', async () => {
    const seen = route();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '5', client, idempotencyKey: 's', positionSeconds: 10 } as never);
    expect(plan.selectedPathId).toBe('plex-hls');
    const next = await adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '52', positionSeconds: 42, idempotencyKey: 'v', sourceGeneration: 0, seekGeneration: 0 });
    const stops = seen.filter(r => r.url.pathname === '/video/:/transcode/universal/stop');
    expect(stops.map(r => r.url.searchParams.get('session'))).toEqual([plan.sessionId]);
    // The new stream's decision is asked for that file in the new transcode session, before the old one stops.
    const decision = seen[at(seen, 'decision', `${plan.sessionId}-1`)]!;
    expect(decision.url.searchParams.get('mediaIndex')).toBe('1');
    expect(at(seen, 'decision', `${plan.sessionId}-1`)).toBeLessThan(at(seen, 'stop'));
    expect([next.sessionId, next.sourceGeneration, next.positionSeconds, next.selectedVersionId]).toEqual([plan.sessionId, 1, 42, '52']);
    expect(next.selectedPathId).toBe('original');
    expect(original(next)).toBe('/library/parts/521/1/file.mp4');
    expect([hls(next).get('mediaIndex'), hls(next).get('session')]).toEqual(['1', `${plan.sessionId}-1`]);
    expect(next.audioTracks.map(t => t.id)).toEqual(['5212']);
    expect(next.selectedAudioTrackId).toBe('5212');
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(next);

    // Back to the remux from the file: no stream was running, and the position defaults to the session's.
    const back = await adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '51', idempotencyKey: 'w', sourceGeneration: 1, seekGeneration: 0 });
    expect(seen.filter(r => r.url.pathname === '/video/:/transcode/universal/stop')).toHaveLength(1);
    expect([back.sourceGeneration, back.positionSeconds, back.selectedVersionId, back.selectedPathId]).toEqual([2, 42, '51', 'plex-hls']);
    expect([hls(back).get('mediaIndex'), hls(back).get('session')]).toEqual(['0', `${plan.sessionId}-2`]);
    expect(back.audioTracks.map(t => t.id)).toEqual(['5112']);
  });

  test('a switch from the file after watching the server\'s stream still stops that stream', async () => {
    const seen = route();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '5', client, idempotencyKey: 'p', versionId: '52' } as never);
    expect(plan.paths.map(p => p.id)).toEqual(['original', 'plex-hls']);
    await adapter.switchPath(plan.sessionId, { kind: 'switch', pathId: 'plex-hls', atSeconds: 5, idempotencyKey: 'p1', sourceGeneration: 0, seekGeneration: 0 });
    await adapter.switchPath(plan.sessionId, { kind: 'switch', pathId: 'original', atSeconds: 8, idempotencyKey: 'p2', sourceGeneration: 1, seekGeneration: 0 });
    const next = await adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '51', idempotencyKey: 'p3', sourceGeneration: 2, seekGeneration: 0 });
    expect(seen.filter(r => r.url.pathname === '/video/:/transcode/universal/stop').map(r => r.url.searchParams.get('session'))).toEqual([plan.sessionId]);
    expect(at(seen, 'decision', `${plan.sessionId}-3`)).toBeLessThan(at(seen, 'stop'));
    // The remux's stream (now playing) is the one a further switch stops.
    await adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '52', idempotencyKey: 'p4', sourceGeneration: next.sourceGeneration, seekGeneration: 0 });
    expect(seen.filter(r => r.url.pathname === '/video/:/transcode/universal/stop').map(r => r.url.searchParams.get('session'))).toEqual([plan.sessionId, `${plan.sessionId}-3`]);
  });

  test('a refused decision for the new file leaves the running stream and the session as they were', async () => {
    let refusing = false;
    const seen = route(u => refusing && u.searchParams.get('mediaIndex') === '0');
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '5', client, idempotencyKey: 'r', versionId: '52' } as never);
    const streaming = await adapter.switchPath(plan.sessionId, { kind: 'switch', pathId: 'plex-hls', atSeconds: 5, idempotencyKey: 'r1', sourceGeneration: 0, seekGeneration: 0 });
    refusing = true;
    // The remux plays only through the server's stream here, so its refused decision fails the switch.
    await expect(adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '51', idempotencyKey: 'r2', sourceGeneration: 1, seekGeneration: 0 })).rejects.toBeInstanceOf(VelaError);
    expect(at(seen, 'decision', `${plan.sessionId}-2`)).toBeGreaterThan(-1);
    expect(at(seen, 'stop')).toBe(-1);
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(streaming);
  });

  test('a shorter file has its own duration, and a start or switch past its end begins at its end', async () => {
    route();
    const adapter = plex();
    const long = await adapter.startPlayback({ titleId: '7', client, idempotencyKey: 'l' } as never);
    expect([long.positionSeconds, long.durationSeconds]).toEqual([45, 60]);
    const started = await plex().startPlayback({ titleId: '7', client, idempotencyKey: 'm', versionId: '54' } as never);
    expect([started.positionSeconds, started.durationSeconds, started.selectedVersionId]).toEqual([30, 30, '54']);
    const switched = await adapter.switchVersion(long.sessionId, { kind: 'version', versionId: '54', idempotencyKey: 'n', sourceGeneration: 0, seekGeneration: 0 });
    expect([switched.positionSeconds, switched.durationSeconds]).toEqual([30, 30]);
    const back = await adapter.switchVersion(long.sessionId, { kind: 'version', versionId: '52', positionSeconds: 50, idempotencyKey: 'q', sourceGeneration: 1, seekGeneration: 0 });
    expect([back.positionSeconds, back.durationSeconds]).toEqual([50, 60]);
  });

  test('a file without a part is listed as unavailable, fails cleanly, and does not shift the others', async () => {
    const seen = route();
    const adapter = plex();
    const listed = (await adapter.titleVersions('8')).versions;
    expect(listed.map(v => [v.id, v.availability])).toEqual([['51', 'instant'], ['53', 'unavailable'], ['52', 'instant']]);
    expect(listed[1]).toEqual({ id: '53', label: '720p H.264 · Dolby Digital 5.1', recommended: false, resolution: '720p', videoCodec: 'h264',
      audio: { codec: 'ac3', channels: '5.1' }, availability: 'unavailable', note: 'Plex lists no file for this version' });
    const refused = adapter.startPlayback({ titleId: '8', client, idempotencyKey: 'g', versionId: '53' } as never);
    await expect(refused).rejects.toBeInstanceOf(VelaError);
    await expect(refused).rejects.toThrow('Plex title has no playable media');
    const plan = await adapter.startPlayback({ titleId: '8', client, idempotencyKey: 'h' } as never);
    const switching = adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '53', idempotencyKey: 'i', sourceGeneration: 0, seekGeneration: 0 });
    await expect(switching).rejects.toBeInstanceOf(VelaError);
    await expect(switching).rejects.toThrow('Plex title has no playable media');
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(plan);
    const next = await adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '52', idempotencyKey: 'j', sourceGeneration: 0, seekGeneration: 0 });
    expect(original(next)).toBe('/library/parts/521/1/file.mp4');
    expect([hls(next).get('mediaIndex'), seen[at(seen, 'decision', `${plan.sessionId}-1`)]!.url.searchParams.get('mediaIndex')]).toEqual(['2', '2']);
  });

  test('switching to an unknown version fails and leaves the session as it was', async () => {
    route();
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '5', client, idempotencyKey: 'u' } as never);
    await expect(adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '99', idempotencyKey: 'z', sourceGeneration: 0, seekGeneration: 0 })).rejects.toThrow('Unknown Plex version');
    expect((await adapter.sessionSnapshot(plan.sessionId)).plan).toEqual(plan);
  });

  test('a title with one file offers no choice: an empty list, and a plan without versions', async () => {
    route();
    const adapter = plex();
    expect(await adapter.titleVersions('6')).toEqual({ titleId: '6', selectedVersionId: null, versions: [] });
    const plan = await adapter.startPlayback({ titleId: '6', client, idempotencyKey: 'o' } as never);
    expect(original(plan)).toBe('/library/parts/521/1/file.mp4');
    expect([plan.versions, plan.selectedVersionId]).toEqual([undefined, undefined]);
  });
});

describe('Plex versions with markers, thumbnails and sidecars', () => {
  // Each file has its own ASS sidecar and its own thumbnail index; the markers are the title's.
  const sidecar = (id: number) => ({ id, index: 3, streamType: 3, codec: 'ass', key: `/library/streams/${id}`, languageCode: 'jpn' });
  const withSidecar = (media: typeof remux, id: number) => ({ ...media, Part: [{ ...media.Part[0]!, Stream: [...media.Part[0]!.Stream, sidecar(id)] }] });
  const titled = { ...movie, ratingKey: '9', Marker: [{ type: 'intro', startTimeOffset: 5000, endTimeOffset: 20000 }], Media: [withSidecar(remux, 5113), withSidecar(optimized, 5213)] };
  const assClient = { ...(client as object), subtitleFormats: ['webvtt', 'ass'] } as never;
  /** A one-frame BIF whose image is `width` wide, served by range. */
  const bif = (width: number) => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x5a, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
    const out = new Uint8Array(64 + 16 + image.length), view = new DataView(out.buffer);
    out.set([0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    view.setUint32(12, 1, true); view.setUint32(16, 1000, true);
    view.setUint32(64, 0, true); view.setUint32(68, 80, true); view.setUint32(72, 0xffffffff, true); view.setUint32(76, 80 + image.length, true);
    out.set(image, 80);
    return out;
  };
  const ranged = (bytes: Uint8Array) => (r: Seen) => {
    const m = /bytes=(\d+)-(\d+)/.exec(r.headers.get('range') ?? '')!;
    return new Response(new Blob([bytes.slice(Number(m[1]), Number(m[2]) + 1)]), { status: 206 });
  };

  test('a switch keeps the title\'s markers, reads the new file\'s thumbnails, and delivers its ASS sidecar as ASS', async () => {
    const seen = routeFetch({
      'GET /library/metadata/9': { MediaContainer: { Metadata: [titled] } },
      'GET /video/:/transcode/universal/decision': { MediaContainer: {} },
      'GET /video/:/transcode/universal/stop': {},
      'GET /library/parts/511/indexes/sd': ranged(bif(320)),
      'GET /library/parts/521/indexes/sd': ranged(bif(240)),
    });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '9', client: assClient, idempotencyKey: 's' } as never);
    expect(plan.markers).toEqual([{ kind: 'intro', startSeconds: 5, endSeconds: 20 }]);
    expect(plan.subtitleTracks[0]?.delivery).toEqual({ kind: 'external', format: 'ass', url: `${ORIGIN}/library/streams/5113.ass?encoding=utf-8` });
    expect((await adapter.trickplayOffer(plan.sessionId))?.width).toBe(320);
    const next = await adapter.switchVersion(plan.sessionId, { kind: 'version', versionId: '52', idempotencyKey: 'v', sourceGeneration: 0, seekGeneration: 0 });
    expect(next.markers).toEqual(plan.markers);
    expect(next.subtitleTracks[0]?.delivery).toEqual({ kind: 'external', format: 'ass', url: `${ORIGIN}/library/streams/5213.ass?encoding=utf-8` });
    // The other file's index, measured afresh.
    expect((await adapter.trickplayOffer(plan.sessionId))?.width).toBe(240);
    expect(seen.some(r => r.url.pathname === '/library/parts/521/indexes/sd')).toBe(true);
  });
});
