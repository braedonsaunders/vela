import { afterEach, describe, expect, test } from 'bun:test';
import {
  createVela,
  matchSeriesTracks,
  matchTrack,
  pruneSeriesTracks,
  removeServerSeriesTracks,
  seriesTrackKey,
  storedSeriesTracks,
  trackChoiceOf,
  type SeriesTrackMap,
} from '../src';
import type { ClientCapabilities, PlaybackPlan, Track } from '../src/wire';
import { MemoryStore, restoreFetch, routeFetch, tokens } from './helpers';

afterEach(restoreFetch);

const basePlan = (overrides: Partial<PlaybackPlan> = {}): PlaybackPlan => ({
  sessionId: 'sess-1',
  revision: 1,
  state: 'playing',
  positionSeconds: 0,
  sourceGeneration: 1,
  seekGeneration: 1,
  paths: [{
    id: 'direct',
    kind: 'direct',
    original: true,
    transport: 'file',
    mimeType: 'video/x-matroska',
    readiness: 'ready',
    url: 'http://media.test/video.mkv',
    qualities: [],
    boundaries: [],
  }],
  selectedPathId: 'direct',
  audioTracks: [
    { id: 'a-en', kind: 'audio', language: 'eng', name: 'English', codec: 'aac', channels: 2, default: true },
    { id: 'a-ja', kind: 'audio', language: 'jpn', name: 'Japanese', codec: 'eac3', channels: 6 },
  ],
  subtitleTracks: [
    { id: 's-en', kind: 'subtitle', language: 'eng', name: 'English', codec: 'srt', delivery: { kind: 'embedded' } },
    { id: 's-en-forced', kind: 'subtitle', language: 'eng', name: 'English (Forced)', codec: 'srt', forced: true, delivery: { kind: 'embedded' } },
    { id: 's-en-sdh', kind: 'subtitle', language: 'eng', name: 'English (SDH)', codec: 'srt', hearingImpaired: true, delivery: { kind: 'embedded' } },
  ],
  selectedAudioTrackId: 'a-en',
  selectedSubtitleTrackId: null,
  chapters: [],
  fallback: { state: 'unsupported' },
  ...overrides,
});

const capableClient: ClientCapabilities = {
  device: { id: 'dev-1', name: 'Web', platform: 'web', appVersion: '0.1.0' },
  protocolVersions: [0],
  containers: ['mkv', 'mp4'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'eac3', 'ac3', 'opus'],
  subtitleFormats: ['webvtt', 'srt', 'ass'],
  hls: true,
  mse: true,
  originalPlayback: {
    version: 1,
    range: true,
    demuxContainers: ['mkv', 'mp4'],
    videoDecoders: ['h264', 'hevc'],
    audioDecoders: ['aac', 'eac3', 'ac3', 'opus'],
    webgpu: false,
  },
};

describe('series track matching', () => {
  test('matches reordered stream IDs across ISO 639-1 and ISO 639-2 codes', () => {
    const picked = trackChoiceOf({ kind: 'audio', language: 'jpn', codec: 'eac3' });
    expect(picked).toEqual({ language: 'ja', codecFamily: 'dolby' });

    const nextEpisodeTracks: Track[] = [
      { id: 'stream-99', kind: 'audio', language: 'ja', name: 'Japanese', codec: 'ac3' },
      { id: 'stream-42', kind: 'audio', language: 'en', name: 'English', codec: 'aac' },
    ];
    expect(matchTrack(nextEpisodeTracks, picked!, 'audio')?.id).toBe('stream-99');
  });

  test('distinguishes forced, full, and SDH subtitle tracks strictly', () => {
    const plan = basePlan();
    const full = trackChoiceOf(plan.subtitleTracks[0]!);
    const forced = trackChoiceOf(plan.subtitleTracks[1]!);
    const sdh = trackChoiceOf(plan.subtitleTracks[2]!);

    expect(matchTrack(plan.subtitleTracks, full!, 'subtitle')?.id).toBe('s-en');
    expect(matchTrack(plan.subtitleTracks, forced!, 'subtitle')?.id).toBe('s-en-forced');
    expect(matchTrack(plan.subtitleTracks, sdh!, 'subtitle')?.id).toBe('s-en-sdh');

    // Missing forced track on next episode does not silently fall back to full or SDH.
    const withoutForced = plan.subtitleTracks.filter(t => !t.forced);
    expect(matchTrack(withoutForced, forced!, 'subtitle')).toBeUndefined();
  });

  test('uses codec family as tiebreaker and leaves ambiguous tracks (e.g. commentary) alone', () => {
    const tracksWithDifferentCodecs: Track[] = [
      { id: 'main', kind: 'audio', language: 'en', name: 'English 5.1', codec: 'dts' },
      { id: 'commentary', kind: 'audio', language: 'en', name: 'Commentary', codec: 'aac' },
    ];
    expect(matchTrack(tracksWithDifferentCodecs, { language: 'en', codecFamily: 'dts' }, 'audio')?.id).toBe('main');

    const ambiguousTracks: Track[] = [
      { id: 'main', kind: 'audio', language: 'en', name: 'English Main', codec: 'aac' },
      { id: 'commentary', kind: 'audio', language: 'en', name: 'Director Commentary', codec: 'aac' },
    ];
    expect(matchTrack(ambiguousTracks, { language: 'en', codecFamily: 'aac' }, 'audio')).toBeUndefined();
  });

  test('never learns or matches undetermined language tracks', () => {
    expect(trackChoiceOf({ kind: 'audio', language: 'und', codec: 'aac' })).toBeNull();
    expect(trackChoiceOf({ kind: 'subtitle', language: '', codec: 'srt' })).toBeNull();
  });

  test('respects explicit Off vs unset subtitles and skips burned-in or unplayable tracks', () => {
    // Unset subtitle leaves server choice alone; explicit null turns it off.
    const withServerSub = basePlan({ selectedSubtitleTrackId: 's-en' });
    expect(matchSeriesTracks(withServerSub, { updatedAt: 1 })).toEqual({});
    expect(matchSeriesTracks(withServerSub, { subtitle: null, updatedAt: 1 })).toEqual({ subtitleTrackId: null });

    // Burn-in subtitle on transcode: neither selecting a burn-in track nor turning off an already-burned track applies locally.
    const transcodeBurned = basePlan({
      paths: [{
        id: 'tx', kind: 'transcode', transport: 'hls', mimeType: 'application/vnd.apple.mpegurl',
        readiness: 'ready', url: 'http://media.test/tx.m3u8', qualities: [], boundaries: [],
      }],
      selectedPathId: 'tx',
      subtitleTracks: [
        { id: 's-pgs', kind: 'subtitle', language: 'en', name: 'English PGS', codec: 'pgs', delivery: { kind: 'burn-in' } },
        { id: 's-ext', kind: 'subtitle', language: 'fr', name: 'French', codec: 'webvtt', url: 'http://media.test/fr.vtt', delivery: { kind: 'external', format: 'webvtt', url: 'http://media.test/fr.vtt' } },
      ],
      selectedSubtitleTrackId: 's-pgs',
    });
    expect(matchSeriesTracks(transcodeBurned, { subtitle: { language: 'en' }, updatedAt: 1 })).toEqual({});
    expect(matchSeriesTracks(transcodeBurned, { subtitle: null, updatedAt: 1 })).toEqual({});
    // External subtitle is not overlaid on top of an already-burned subtitle stream.
    expect(matchSeriesTracks(transcodeBurned, { subtitle: { language: 'fr' }, updatedAt: 1 })).toEqual({});

    // External subtitle DOES apply on a clean transcode (no burned-in subtitle).
    const transcodeClean = { ...transcodeBurned, selectedSubtitleTrackId: null };
    expect(matchSeriesTracks(transcodeClean, { subtitle: { language: 'fr' }, updatedAt: 1 })).toEqual({ subtitleTrackId: 's-ext' });

    // Audio codec not decodable by client is skipped for this episode.
    const dtsPlan = basePlan({
      audioTracks: [
        { id: 'a-en', kind: 'audio', language: 'en', name: 'English', codec: 'aac' },
        { id: 'a-ja-dts', kind: 'audio', language: 'ja', name: 'Japanese DTS', codec: 'dts' },
      ],
    });
    expect(matchSeriesTracks(dtsPlan, { audio: { language: 'ja' }, updatedAt: 1 }, { client: capableClient })).toEqual({});

    // Explicit audioTrackId at start overrides remembered audio while still applying remembered subtitle.
    expect(matchSeriesTracks(
      basePlan(),
      { audio: { language: 'ja' }, subtitle: { language: 'en', forced: true }, updatedAt: 1 },
      { explicitAudio: true, client: capableClient },
    )).toEqual({ subtitleTrackId: 's-en-forced' });
  });

  test('bounds stored map size, drops malformed entries, and prunes removed servers', () => {
    const raw: Record<string, unknown> = {
      'bad-key': { audio: { language: 'ja' }, updatedAt: 10 },
      [seriesTrackKey('srv-1', 'v1', 'show-1')]: { audio: { language: 'jpn' }, subtitle: null, updatedAt: 10 },
      [seriesTrackKey('srv-1', 'v1', 'show-2')]: { audio: { language: 'und' }, updatedAt: 20 },
      [seriesTrackKey('srv-2', 'v1', 'show-1')]: { subtitle: { language: 'eng', forced: true }, updatedAt: 30 },
    };
    const loaded = storedSeriesTracks(raw);
    expect(Object.keys(loaded)).toHaveLength(2);
    expect(loaded[seriesTrackKey('srv-1', 'v1', 'show-1')]).toEqual({ audio: { language: 'ja' }, subtitle: null, updatedAt: 10 });

    const pruned = pruneSeriesTracks(loaded, 1);
    expect(Object.keys(pruned)).toEqual([seriesTrackKey('srv-2', 'v1', 'show-1')]);

    const afterRemove = removeServerSeriesTracks(loaded, 'srv-1');
    expect(Object.keys(afterRemove)).toEqual([seriesTrackKey('srv-2', 'v1', 'show-1')]);
  });
});

describe('series tracks store and Plex zero-write integration', () => {
  const plexMetadata = (ratingKey: string, showKey: string, streams: unknown[]) => ({
    MediaContainer: {
      Metadata: [{
        ratingKey,
        key: `/library/metadata/${ratingKey}`,
        type: 'episode',
        title: `Episode ${ratingKey}`,
        grandparentRatingKey: showKey,
        grandparentTitle: 'Test Show',
        parentRatingKey: 'season-1',
        parentIndex: 1,
        index: Number(ratingKey.replace(/\D/g, '')) || 1,
        duration: 1800_000,
        Media: [{
          id: `media-${ratingKey}`,
          container: 'mkv',
          videoCodec: 'h264',
          audioCodec: 'aac',
          Part: [{
            id: `part-${ratingKey}`,
            key: `/library/parts/part-${ratingKey}/file.mkv`,
            container: 'mkv',
            Stream: streams,
          }],
        }],
      }],
    },
  });

  const PLEX_1 = '11111111-1111-1111-1111-111111111111';
  const PLEX_2 = '22222222-2222-2222-2222-222222222222';
  function setupPlexVela(secrets: MemoryStore, serverId: string, viewerId: string) {
    const registry = {
      selectedId: serverId,
      servers: [{ id: serverId, kind: 'plex', name: 'Home Plex', origin: 'http://plex.test', basePath: '/' }],
    };
    secrets.set('vela.servers', JSON.stringify(registry));
    secrets.set('vela.server-sessions', JSON.stringify({ [serverId]: tokens('plex-tok', viewerId) }));
    return createVela({
      secrets,
      device: { name: 'Web', platform: 'web' },
      appVersion: '0.1.0',
      artWidth: 640,
      rendererVersion: 1,
      media: Promise.resolve({
        containers: capableClient.containers,
        videoCodecs: capableClient.videoCodecs,
        audioCodecs: capableClient.audioCodecs,
        subtitleFormats: capableClient.subtitleFormats,
        hls: true,
        mse: true,
        originalPlayback: capableClient.originalPlayback,
      }),
    });
  }

  test('remembers deliberate pick on episode 1, applies locally to episode 2 and recovery with zero Plex PUTs, isolated per viewer and server', async () => {
    const seen = routeFetch({
      'GET /library/metadata/ep1': plexMetadata('ep1', 'show-42', [
        { id: 101, streamType: 1, codec: 'h264', selected: true },
        { id: 102, streamType: 2, codec: 'aac', languageCode: 'eng', displayTitle: 'English', selected: true },
        { id: 103, streamType: 2, codec: 'eac3', languageCode: 'jpn', displayTitle: 'Japanese' },
        { id: 104, streamType: 3, codec: 'srt', languageCode: 'eng', displayTitle: 'English (Forced)', forced: 1 },
      ]),
      'GET /library/metadata/ep2': plexMetadata('ep2', 'show-42', [
        { id: 201, streamType: 1, codec: 'h264', selected: true },
        // Stream IDs completely different and reordered on episode 2!
        { id: 209, streamType: 2, codec: 'eac3', languageCode: 'jpn', displayTitle: 'Japanese' },
        { id: 202, streamType: 2, codec: 'aac', languageCode: 'eng', displayTitle: 'English', selected: true },
        { id: 210, streamType: 3, codec: 'srt', languageCode: 'eng', displayTitle: 'English', selected: true },
        { id: 211, streamType: 3, codec: 'srt', languageCode: 'eng', displayTitle: 'English (Forced)', forced: 1 },
      ]),
      'GET /:/timeline': new Response('', { status: 200 }),
      'PUT /library/parts/part-ep1': new Response('', { status: 200 }),
      'PUT /library/parts/part-ep2': new Response('', { status: 200 }),
    });

    const secrets = new MemoryStore();
    const vela = setupPlexVela(secrets, PLEX_1, 'viewer-a');
    await vela.client();

    // Start episode 1: startup snapshot alone must NOT teach any series preference.
    await vela.playback.start({ kind: 'title', id: 'ep1', showId: 'show-42' });
    const sess1 = vela.getState().playback.sessionId;
    expect(vela.getState().playback.plan?.selectedAudioTrackId).toBe('102');
    vela.playback.snapshot({ sessionId: sess1, live: null, position: 5, state: 'playing', audioTrackId: '102', subtitleTrackId: null });
    expect(Object.keys(vela.getState().seriesTracks)).toHaveLength(0);

    // Viewer deliberately switches to Japanese audio + English Forced subtitle.
    vela.playback.rememberTrack(sess1, 'audio', '103');
    vela.playback.rememberTrack(sess1, 'subtitle', '104');
    expect(vela.seriesTracks.get(PLEX_1, 'viewer-a', 'show-42')).toMatchObject({
      audio: { language: 'ja', codecFamily: 'dolby' },
      subtitle: { language: 'en', forced: true, codecFamily: 'text' },
    });

    // Start episode 2 (different stream IDs): matches Japanese (209) and English Forced (211) locally.
    await vela.playback.start({ kind: 'title', id: 'ep2', showId: 'show-42' });
    const plan2 = vela.getState().playback.plan!;
    expect(plan2.selectedAudioTrackId).toBe('209');
    expect(plan2.selectedSubtitleTrackId).toBe('211');

    // A transient startup snapshot reporting subtitleTrackId: null (e.g. while the subtitle
    // overlay is still discovering tracks) must not clobber the locally applied series subtitle.
    vela.playback.snapshot({ sessionId: plan2.sessionId, live: null, position: 1, state: 'playing', audioTrackId: '209', subtitleTrackId: null });

    // Refreshing the session keeps locally applied tracks without reverting to Plex defaults.
    await vela.playback.refresh(plan2.sessionId);
    expect(vela.getState().playback.plan?.selectedAudioTrackId).toBe('209');
    expect(vela.getState().playback.plan?.selectedSubtitleTrackId).toBe('211');

    // Non-tracks command (pause/seek) also preserves locally applied tracks.
    await vela.playback.command(plan2.sessionId, {
      kind: 'pause',
      sourceGeneration: plan2.sourceGeneration,
      seekGeneration: plan2.seekGeneration,
      idempotencyKey: 'k-pause',
    });
    expect(vela.getState().playback.plan?.selectedAudioTrackId).toBe('209');
    expect(vela.getState().playback.plan?.selectedSubtitleTrackId).toBe('211');

    // Recovery keeps locally applied series tracks WITHOUT sending kind: tracks / Plex PUT.
    const origSet = globalThis.setTimeout, origClear = globalThis.clearTimeout;
    const timers: Array<{ fire: () => unknown; ms: number }> = [];
    globalThis.setTimeout = ((fire: () => unknown, ms: number) => { timers.push({ fire, ms }); return timers.length; }) as never;
    globalThis.clearTimeout = (() => {}) as never;
    try {
      vela.playback.recover(plan2.sessionId);
      const recoveryTimer = timers.find(t => t.ms === 1000);
      expect(recoveryTimer).toBeDefined();
      await recoveryTimer!.fire();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(vela.getState().playback.plan?.selectedAudioTrackId).toBe('209');
      expect(vela.getState().playback.plan?.selectedSubtitleTrackId).toBe('211');
    } finally {
      globalThis.setTimeout = origSet;
      globalThis.clearTimeout = origClear;
    }

    // Zero PUT /library/parts/* requests were sent to Plex across start, refresh, command, AND recovery!
    expect(seen.filter(r => r.method === 'PUT' && r.url.pathname.startsWith('/library/parts/'))).toHaveLength(0);
    await vela.playback.stop();

    // Viewer B on the SAME server and SAME series gets Plex defaults, not Viewer A's picks.
    const savedMap = vela.getState().seriesTracks;
    const secretsB = new MemoryStore();
    const velaB = setupPlexVela(secretsB, PLEX_1, 'viewer-b');
    velaB.seriesTracks.load(savedMap);
    await velaB.client();
    await velaB.playback.start({ kind: 'title', id: 'ep2', showId: 'show-42' });
    expect(velaB.getState().playback.plan?.selectedAudioTrackId).toBe('202');
    expect(velaB.getState().playback.plan?.selectedSubtitleTrackId).toBe('210');
    await velaB.playback.stop();

    // Viewer A on a SECOND server with the same showId gets that server's defaults, not plex-1's picks.
    const secrets2 = new MemoryStore();
    const vela2 = setupPlexVela(secrets2, PLEX_2, 'viewer-a');
    vela2.seriesTracks.load(savedMap);
    await vela2.client();
    await vela2.playback.start({ kind: 'title', id: 'ep2', showId: 'show-42' });
    expect(vela2.getState().playback.plan?.selectedAudioTrackId).toBe('202');
    expect(vela2.getState().playback.plan?.selectedSubtitleTrackId).toBe('210');
    await vela2.playback.stop();

    // Removing a server prunes its remembered series tracks.
    vela.seriesTracks.rememberAudio(PLEX_2, 'viewer-a', 'show-42', { id: 'a', kind: 'audio', language: 'fr', name: 'French', codec: 'aac' });
    await vela.servers.remove(PLEX_1);
    expect(vela.seriesTracks.get(PLEX_1, 'viewer-a', 'show-42')).toBeUndefined();
    expect(vela.seriesTracks.get(PLEX_2, 'viewer-a', 'show-42')?.audio?.language).toBe('fr');
  });

  test('resolves showId via detail() on direct watch when viewer has remembered series, and ignores movies', async () => {
    const seen = routeFetch({
      'GET /library/metadata/ep2': plexMetadata('ep2', 'show-42', [
        { id: 201, streamType: 1, codec: 'h264', selected: true },
        { id: 209, streamType: 2, codec: 'eac3', languageCode: 'jpn', displayTitle: 'Japanese' },
        { id: 202, streamType: 2, codec: 'aac', languageCode: 'eng', displayTitle: 'English', selected: true },
      ]),
      'GET /library/metadata/movie-1': {
        MediaContainer: {
          Metadata: [{
            ratingKey: 'movie-1',
            key: '/library/metadata/movie-1',
            type: 'movie',
            title: 'Standalone Movie',
            duration: 5400_000,
            Media: [{
              id: 'media-m1', container: 'mkv', videoCodec: 'h264', audioCodec: 'aac',
              Part: [{
                id: 'part-m1', key: '/library/parts/part-m1/file.mkv', container: 'mkv',
                Stream: [
                  { id: 301, streamType: 1, codec: 'h264', selected: true },
                  { id: 302, streamType: 2, codec: 'aac', languageCode: 'eng', displayTitle: 'English', selected: true },
                  { id: 303, streamType: 2, codec: 'eac3', languageCode: 'jpn', displayTitle: 'Japanese' },
                ],
              }],
            }],
          }],
        },
      },
      'GET /:/timeline': new Response('', { status: 200 }),
    });

    const secrets = new MemoryStore();
    const vela = setupPlexVela(secrets, PLEX_1, 'viewer-a');
    await vela.client();
    vela.seriesTracks.rememberAudio(PLEX_1, 'viewer-a', 'show-42', { id: 'x', kind: 'audio', language: 'jpn', name: 'Japanese', codec: 'eac3' });

    // Start ep2 WITHOUT passing showId and WITHOUT pre-loading titles cache.
    await vela.playback.start({ kind: 'title', id: 'ep2' });
    expect(vela.getState().playback.plan?.selectedAudioTrackId).toBe('209');
    expect(seen.filter(r => r.method === 'PUT')).toHaveLength(0);
    await vela.playback.stop();

    // A partial tracks command (audio only) must keep the locally applied subtitle intact.
    vela.seriesTracks.rememberSubtitle(PLEX_1, 'viewer-a', 'show-42', { id: 's', kind: 'subtitle', language: 'en', name: 'English', codec: 'webvtt' });
    await vela.playback.start({ kind: 'title', id: 'ep2', showId: 'show-42' });
    expect(vela.getState().playback.plan?.selectedAudioTrackId).toBe('209');
    await vela.playback.stop();

    // Movie pick must never store a series track preference.
    const beforeKeys = Object.keys(vela.getState().seriesTracks);
    await vela.playback.start({ kind: 'title', id: 'movie-1' });
    vela.playback.rememberTrack(vela.getState().playback.sessionId, 'audio', '303');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(Object.keys(vela.getState().seriesTracks)).toEqual(beforeKeys);
    await vela.playback.stop();
  });
});
