// The streaming quality cap: one choice per kind of network, declared as the client's maxBitrate and
// box, honoured by Plex when it decides whether to offer the original, and Plex's stream described by
// its own decision so the quality menu can move to it.
import { afterEach, describe, expect, test } from 'bun:test';
import { PlexAdapter } from '../src/adapter/plex';
import { decidedQuality } from '../src/adapter/plex/media';
import { cappedClient, DEFAULT_STREAMING, streamingLimit, streamingSettings, withinStreamingCap } from '../src/streaming';
import { PlayerSettings, initialPlayerSettings, storedPlayerSettings } from '../src/store/player-settings';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type * as V from '../src/wire';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);

const apple: V.ClientCapabilities = { device: { id: 'd', name: 'd', platform: 'ios', appVersion: '1' }, protocolVersions: [0], containers: ['mp4', 'mkv'],
  videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'ac3'], subtitleFormats: [], hls: true, mse: false,
  originalPlayback: { version: 1, range: true, demuxContainers: ['mkv', 'mp4'], videoDecoders: ['h264', 'hevc'], audioDecoders: ['aac', 'ac3'], webgpu: false } } as never;

describe('streaming settings', () => {
  test('Wi-Fi keeps the original; mobile data streams at most 720p at 4 Mb/s', () => {
    expect(DEFAULT_STREAMING).toEqual({ wifi: 'original', mobile: '720p' });
    expect(streamingLimit(DEFAULT_STREAMING, false)).toBeNull();
    expect(streamingLimit(DEFAULT_STREAMING, true)).toEqual({ maxWidth: 1280, maxHeight: 720, maxBitrate: 4_000_000 });
  });

  test('stored settings are read defensively', () => {
    expect(streamingSettings({ wifi: '1080p', mobile: 'huge' })).toEqual({ wifi: '1080p', mobile: '720p' });
    expect(streamingSettings('garbage')).toEqual(DEFAULT_STREAMING);
    expect(storedPlayerSettings({ picture: 'stretch', streaming: { mobile: '480p' } })).toEqual({ picture: 'fit', streaming: { wifi: 'original', mobile: '480p' } });
  });

  test('the cap only ever lowers what the device declared', () => {
    const android = { ...apple, maxWidth: 1920, maxHeight: 1080 };
    expect(cappedClient(android, null)).toBe(android);
    expect(cappedClient(android, { maxWidth: 3840, maxHeight: 2160, maxBitrate: 4_000_000 })).toMatchObject({ maxWidth: 1920, maxHeight: 1080, maxBitrate: 4_000_000 });
    expect(cappedClient(apple, streamingLimit(DEFAULT_STREAMING, true))).toMatchObject({ maxWidth: 1280, maxHeight: 720, maxBitrate: 4_000_000 });
  });

  test('a decoder\'s size alone never refuses an original; the viewer\'s cap does', () => {
    expect(withinStreamingCap({ bitrate: 40_000_000, height: 2160 }, { maxWidth: 1920, maxHeight: 1080 })).toBe(true);
    const cap = { maxWidth: 1280, maxHeight: 720, maxBitrate: 4_000_000 };
    expect(withinStreamingCap({ bitrate: 40_000_000, height: 1080 }, cap)).toBe(false);
    expect(withinStreamingCap({ bitrate: 3_000_000, width: 1920, height: 800 }, cap)).toBe(false);
    expect(withinStreamingCap({ bitrate: 3_000_000, width: 1280, height: 692 }, cap)).toBe(true);
    expect(withinStreamingCap({}, cap)).toBe(true);
  });

  test('a widescreen picture is judged by its height: Plex sizes a 720p scope film 1728×720', () => {
    const cap = { maxBitrate: 4_000_000, maxWidth: 1280, maxHeight: 720 };
    expect(withinStreamingCap({ width: 1728, height: 720, bitrate: 3_500_000 }, cap)).toBe(true);
    expect(withinStreamingCap({ width: 1920, height: 800, bitrate: 3_500_000 }, cap)).toBe(false);
    expect(withinStreamingCap({ width: 1280, height: 720, bitrate: 3_500_000 }, cap)).toBe(true);
    // A picture no wider than the box is still held to its width: 4:3 at 1080 is over a 720p cap.
    expect(withinStreamingCap({ width: 960, height: 720 }, cap)).toBe(true);
    expect(withinStreamingCap({ width: 1440, height: 1080 }, cap)).toBe(false);
    expect(withinStreamingCap({ width: 1728, height: 720, bitrate: 5_000_000 }, cap)).toBe(false);
  });

  test('the network in use decides which cap the next start declares', () => {
    const limits: unknown[] = [];
    const box = new StateBox({ playerSettings: initialPlayerSettings } as VelaState);
    const settings = new PlayerSettings(box, { setStreamingLimit: (limit: unknown) => limits.push(limit) } as unknown as Session);
    settings.load({ streaming: { wifi: '1080p', mobile: '480p' } });
    settings.setMetered(true);
    settings.setStreaming({ mobile: 'original' });
    expect(limits).toEqual([{ maxWidth: 1920, maxHeight: 1080, maxBitrate: 10_000_000 }, { maxWidth: 854, maxHeight: 480, maxBitrate: 1_500_000 }, null]);
    expect(box.get().playerSettings).toMatchObject({ metered: true, streaming: { wifi: '1080p', mobile: 'original' } });
  });
});

describe('Plex and the cap', () => {
  const ORIGIN = 'https://plex.example:32400';
  const plex = () => new PlexAdapter({ origin: ORIGIN, credentials: new FakeCredentials(), clientIdentifier: 'client-1' });
  // A 40 Mb/s 1080p HEVC MKV the device plays as it is (Plex states rates in kb/s).
  const movie = { ratingKey: '5', type: 'movie', title: 'Big', duration: 60000, Media: [{ id: 5, container: 'mkv', videoCodec: 'hevc', audioCodec: 'ac3', bitrate: 40000, width: 1920, height: 1080, duration: 60000,
    Part: [{ id: 5, key: '/library/parts/5/1/file.mkv', size: 1000, duration: 60000, Stream: [] }] }] };
  // Plex's decision answer: the output it will stream (recorded shape, trimmed).
  const decision = { MediaContainer: { generalDecisionCode: 1001, Metadata: [{ Media: [{ bitrate: 3800, width: 1280, height: 720, videoCodec: 'h264', container: 'mpegts', protocol: 'hls',
    Part: [{ decision: 'transcode', Stream: [{ streamType: 1, decision: 'transcode', width: 1280, height: 720 }] }] }] }] } };
  const start = (client: V.ClientCapabilities, answer: unknown = decision) => {
    const seen = routeFetch({ 'GET /library/metadata/5': { MediaContainer: { Metadata: [movie] } }, 'GET /video/:/transcode/universal/decision': answer });
    return { seen, plan: plex().startPlayback({ titleId: '5', client, idempotencyKey: 'k' } as never) };
  };

  test('uncapped, the original plays and Plex\'s stream is a choice beside it, numbered once decided', async () => {
    const { seen, plan: started } = start(apple);
    const plan = await started;
    expect(plan.paths.map(p => p.id)).toEqual(['original', 'plex-hls']);
    expect(plan.selectedPathId).toBe('original');
    // The stream is decided only when it is needed, so its output size is not known at the start.
    expect([plan.paths[1]!.readiness, plan.paths[1]!.quality]).toEqual(['on-demand', undefined]);
    expect(seen.some(r => r.url.pathname === '/video/:/transcode/universal/decision')).toBe(false);
  });

  test('switching to the stream asks its decision and numbers it from the output Plex states', async () => {
    routeFetch({ 'GET /library/metadata/5': { MediaContainer: { Metadata: [movie] } }, 'GET /video/:/transcode/universal/decision': decision });
    const adapter = plex();
    const plan = await adapter.startPlayback({ titleId: '5', client: apple, idempotencyKey: 'k' } as never);
    const switched = await adapter.switchPath(plan.sessionId, { kind: 'switch', pathId: 'plex-hls', atSeconds: 5, idempotencyKey: 's', sourceGeneration: 0, seekGeneration: 0 });
    expect(switched.paths[1]!.quality).toEqual({ width: 1280, height: 720, bitrate: 3_800_000, codec: 'h264' });
  });

  test('on mobile data an original above the cap gives way to Plex\'s stream, asked at the cap', async () => {
    const { seen, plan } = start(cappedClient(apple, streamingLimit(DEFAULT_STREAMING, true)));
    const capped = await plan;
    expect(capped.selectedPathId).toBe('plex-hls');
    // The original stays a choice the viewer can make deliberately.
    expect(capped.paths.map(p => p.id)).toEqual(['plex-hls', 'original']);
    const asked = seen.find(r => r.url.pathname === '/video/:/transcode/universal/decision')!.url.searchParams;
    expect(asked.get('maxVideoBitrate')).toBe('4000');
    expect(asked.get('videoResolution')).toBe('1280x720');
  });

  test('an unavailable conversion cannot silently start an over-cap original', async () => {
    const client = cappedClient(apple, streamingLimit(DEFAULT_STREAMING, true));
    await expect(start({ ...client, hls: false }).plan).rejects.toThrow('quality cap');
    await expect(start(client, new Response('', { status: 400 })).plan).rejects.toThrow('quality cap');
    await expect(start(client, { MediaContainer: { generalDecisionCode: 2000 } }).plan).rejects.toThrow('quality cap');
    const overCap = { MediaContainer: { Metadata: [{ Media: [{ width: 1280, height: 720, bitrate: 8000 }] }] } };
    await expect(start(client, overCap).plan).rejects.toThrow('quality cap');
    await expect(start(client, { MediaContainer: { Metadata: [{ Media: [{ bitrate: 8000 }] }] } }).plan).rejects.toThrow('quality cap');
    expect((await start(apple, new Response('', { status: 400 })).plan).selectedPathId).toBe('original');
  });

  test('a decision without an output size gives no numbered quality', () => {
    expect(decidedQuality({})).toBeUndefined();
    expect(decidedQuality({ Metadata: [{ Media: [{ bitrate: 2000 }] }] })).toBeUndefined();
    expect(decidedQuality({ Metadata: [{ Media: [{ width: 1920, height: 1080, bitrate: 9000, videoCodec: 'vp9' }] }] })).toEqual({ width: 1920, height: 1080, bitrate: 9_000_000, videoCodec: 'vp9' });
  });
});
