import { expect, test } from 'bun:test';
import type { PlaybackPlan, Snapshot } from '@vela/player-api';
import { labelResolution, present, qualityReached } from '../src/widgets/player/present';

function plan(): PlaybackPlan {
  const base = { sourceId: 'file', timelineId: 'timeline', edition: '1080p release', transport: 'hls', kind: 'transcode', qualities: [], boundaries: [] };
  return { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, selectedPathId: 'hls', paths: [
    { ...base, id: 'primary', kind: 'direct', transport: 'file', readiness: 'ready', original: true, originalVideo: { codec: 'hevc', width: 1920, height: 1080 } },
    { ...base, id: 'hls', readiness: 'ready', qualities: [1080, 720, 480, 360].map(height => ({ id: `hls-${height}`, width: height * 16 / 9, height, bitrate: height * 4000, videoCodec: height === 1080 ? 'avc1.640028' : '', codecStatus: height === 1080 ? 'verified' : 'pending' })) },
    ...[1080, 720, 480, 360].map(height => ({ ...base, id: `convert-${height}`, readiness: 'on-demand', quality: { width: height * 16 / 9, height, codec: 'h264', bitrate: height * 4000 } })),
  ], audioTracks: [], subtitleTracks: [] } as unknown as PlaybackPlan;
}

test('one descending resolution list merges HLS renditions with server paths, without treating codec verification as a pending command', () => {
  const view = present(plan(), null);
  expect(view.qualities.map(q => q.resolution)).toEqual(['Original', '1080p', '720p', '480p', '360p']);
  expect(view.qualities[0]!.traits).toContain('1080p');
  expect(view.qualities[0]!.traits).toContain('HEVC');
  expect(view.qualities[1]!.id).toBe('hls-1080');
  expect(view.qualities[2]!.id).toBe('path:convert-720');
  expect(view.qualities[2]!.aliases).toContain('hls-720');
  expect(view.qualities.every(q => !q.disabledReason)).toBe(true);
  expect(JSON.stringify(view.qualities)).not.toContain('release');
  const current = present(plan(), { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId: 'hls', renditionId: 'hls-720', lockedQuality: 'hls-720', throughputHistory: [], capabilities: {pip:false,fullscreen:false,audioSwitch:false} } as unknown as Snapshot);
  expect(current.qualities.find(q => q.resolution === '720p')!.aliases).toContain(current.lockedQuality);
});

test('a server limitation is disabled with its reason; it cannot override an available choice', () => {
  const source = plan(); source.qualityLimitations = [{ height: 2160, reason: 'This server cannot encode 4K' }, { height: 720, reason: 'Stale limitation' }];
  const view = present(source, null);
  expect(view.qualities.find(q => q.resolution === '4K')!.disabledReason).toBe('This server cannot encode 4K');
  expect(view.qualities.filter(q => q.resolution === '720p')).toHaveLength(1);
  expect(view.qualities.find(q => q.resolution === '720p')!.disabledReason).toBe('');
});

test('an unnamed Plex stream can be selected separately from numbered qualities', () => {
  const source = plan();source.paths = source.paths.slice(0, 1);source.selectedPathId = 'primary';
  expect(present(source, null).qualities).toHaveLength(1);
  expect(present(source, null).serverStream).toBeUndefined();
  // Plex gives both paths the part's id as their source and timeline.
  source.paths.push({ id: 'plex-hls', kind: 'transcode', transport: 'hls', readiness: 'ready', url: '', mimeType: 'application/vnd.apple.mpegurl', sourceId: 'file', timelineId: 'timeline', edition: '1080p release', qualities: [], boundaries: [] });
  expect(present(source, null).qualities).toHaveLength(1);
  expect(present(source, null).serverStream).toEqual({ choice: 'path:plex-hls', selected: false });
  source.selectedPathId = 'plex-hls';
  expect(present(source, null).serverStream?.selected).toBe(true);
  source.selectedPathId = 'primary';
  source.paths[1]!.timelineId = 'other';
  expect(present(source, null).serverStream).toBeUndefined();
  source.paths[1]!.timelineId = 'timeline';
  source.paths[1]!.readiness = 'unavailable';
  expect(present(source, null).serverStream).toBeUndefined();
});

test('a Plex stream that copies the video is still the unnamed stream', () => {
  const source = plan(); source.paths = source.paths.slice(0, 1); source.selectedPathId = 'primary';
  source.paths.push({ id: 'plex-hls', kind: 'remux', transport: 'hls', readiness: 'ready', url: '', mimeType: 'application/vnd.apple.mpegurl', sourceId: 'file', timelineId: 'timeline', edition: '1080p release', qualities: [], boundaries: [] });
  expect(present(source, null).serverStream).toEqual({ choice: 'path:plex-hls', selected: false });
});

test('a probed Plex/Jellyfin HLS ladder can supply choices missing from the plan', () => {
  const source = plan(); source.paths = source.paths.slice(0, 2); source.paths[1]!.qualities = [];
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId: 'hls', backend: 'mse', renditionId: 'probe-720', lockedQuality: 'probe-720', throughputHistory: [], capabilities: {},
    renditions: [{ id: 'probe-720', width: 1280, height: 720, codec: 'avc1.64001f', bitrateBps: 2000000, bandwidth: 2000000 }] } as unknown as Snapshot;
  const view = present(source, snapshot);
  expect(view.qualities.map(q => q.resolution)).toEqual(['Original', '720p']);
  expect(view.qualities[1]!.traits).toBe('H.264');
  expect(view.qualities[1]!.aliases).toContain(view.qualityId);
});

test('a quality spinner waits for the engine, not just server acceptance', () => {
  const source = plan(); source.selectedPathId = 'convert-720';
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId: 'hls', renditionId: 'hls-1080', lockedQuality: null, state: 'playing', waiting: false } as unknown as Snapshot;
  expect(qualityReached('path:convert-720', snapshot, source)).toBe(false);
  snapshot.sourceId = 'convert-720'; snapshot.waiting = true;
  expect(qualityReached('path:convert-720', snapshot, source)).toBe(false);
  snapshot.waiting = false;
  expect(qualityReached('path:convert-720', snapshot, source)).toBe(true);
  expect(qualityReached('hls-720', snapshot, source)).toBe(false);
  expect(qualityReached('auto', snapshot, source)).toBe(true);
  snapshot.sourceGeneration++;
  expect(qualityReached('path:convert-720', snapshot, source)).toBe(false);
});

test('plan subtitles survive an empty engine snapshot; discovered embedded tracks supplement them', () => {
  const source = plan();
  source.subtitleTracks = [{ id: 'server-sub', kind: 'subtitle', language: 'en', name: 'English', codec: 'srt', delivery: { kind: 'embedded' } }];
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, subtitleTracks: [], throughputHistory: [], capabilities: {} } as unknown as Snapshot;
  expect(present(source, snapshot).subtitles.map(t => t.id)).toEqual(['server-sub']);
  snapshot.subtitleTracks = [{ id: 'mpv-sub-2', label: 'French', language: 'fr' }, { id: 'server-sub', label: 'English SDH', language: 'en' }];
  const choices = present(source, snapshot).subtitles;
  expect(choices.map(t => t.id)).toEqual(['server-sub', 'mpv-sub-2']);
  expect(choices[0]?.name).toBe('English SDH');
});

test('an early snapshot without an audio choice retains the server-selected track', () => {
  const source = plan();
  source.selectedAudioTrackId = 'en';
  source.audioTracks = [{ id: 'en', kind: 'audio', name: 'English', language: 'en', codec: 'aac' }];
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, audioTrackId: null, throughputHistory: [], capabilities: {} } as unknown as Snapshot;
  expect(present(source, snapshot).audioId).toBe('en');
});

test('a session-wide limitation (height 0) is one explained row, never "0p" or a raw code', () => {
  const source = plan(); source.qualityLimitations = [{ height: 0, reason: 'output_profile_unavailable' }, { height: 0, reason: 'transcoding_disabled' }];
  const view = present(source, null);
  expect(view.qualities.some(q => q.resolution === '0p')).toBe(false);
  const session = view.qualities.filter(q => q.id === 'unavailable:session');
  expect(session).toHaveLength(1);
  expect(session[0]!.disabledReason).toBe('Not available for this title');
  expect(JSON.stringify(view.qualities)).not.toContain('output_profile_unavailable');
});

test('limitation codes become viewer text; unknown codes are hidden, readable text is kept', async () => {
  const { qualityLimitReason } = await import('../src/widgets/player/present');
  expect(qualityLimitReason('transcoding_disabled')).toBe('The server owner has turned off conversion');
  expect(qualityLimitReason('some_new_code')).toBe('Not available');
  expect(qualityLimitReason('This server cannot encode 4K')).toBe('This server cannot encode 4K');
});

test('Plex\'s stream with a decided output is a numbered choice while the original plays', () => {
  const source = plan(); source.paths = source.paths.slice(0, 1); source.selectedPathId = 'primary';
  // Plex gives both paths the part's id as their source and timeline.
  source.paths.push({ id: 'plex-hls', kind: 'transcode', transport: 'hls', readiness: 'ready', url: '', mimeType: 'application/vnd.apple.mpegurl', sourceId: 'file', timelineId: 'timeline', edition: '1080p release',
    quality: { width: 1280, height: 720, bitrate: 3_800_000, codec: 'h264' }, qualities: [], boundaries: [] } as never);
  const view = present(source, null);
  expect(view.serverStream).toBeUndefined();
  expect(view.qualities.map(q => [q.id, q.resolution])).toEqual([['path:primary', 'Original'], ['path:plex-hls', '720p']]);
});

test('an original this page cannot play is shown unavailable with why; a converted choice stays open', () => {
  const source = plan();
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId: 'hls', throughputHistory: [], capabilities: {},
    unplayablePaths: [{ id: 'primary', reason: 'insecure-page' }] } as unknown as Snapshot;
  const view = present(source, snapshot);
  const original = view.qualities.find(q => q.original)!;
  expect(original.id).toBe('path:primary');
  expect(original.disabledReason).toContain('https');
  expect(view.qualities.filter(q => !q.original).every(q => !q.disabledReason)).toBe(true);
  const browser = present(source, { ...snapshot, unplayablePaths: [{ id: 'primary', reason: 'browser' }] } as Snapshot);
  expect(browser.qualities.find(q => q.original)!.disabledReason).toContain('browser');
  // An engine that says nothing (native players) leaves every row open.
  expect(present(source, { ...snapshot, unplayablePaths: undefined } as Snapshot).qualities.every(q => !q.disabledReason)).toBe(true);
});

test('a playable original file is offered before one the page cannot play', () => {
  const source = plan();
  source.paths.splice(1, 0, { ...source.paths[0]!, id: 'mp4', mimeType: 'video/mp4', original: false } as never);
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId: 'hls', throughputHistory: [], capabilities: {},
    unplayablePaths: [{ id: 'primary', reason: 'browser' }] } as unknown as Snapshot;
  const original = present(source, snapshot).qualities.find(q => q.original)!;
  expect(original.id).toBe('path:mp4');
  expect(original.disabledReason).toBe('');
});

test('a converted path the page cannot play gives way to an HLS rendition of the same height', () => {
  const source = plan();
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId: 'hls', throughputHistory: [], capabilities: {},
    unplayablePaths: [{ id: 'convert-720', reason: 'browser' }] } as unknown as Snapshot;
  const row = present(source, snapshot).qualities.find(q => q.resolution === '720p')!;
  expect(row.id).toBe('hls-720');
  expect(row.disabledReason).toBe('');
});

test('playing a release as it is, the badge names the resolution its label does', () => {
  const source = plan(); source.selectedPathId = 'primary';
  source.playingVersionId = 'v1080'; source.playingLabel = '1080p WEB-DL · DD+ 5.1 · 4.2 GB';
  // A 1920×800 scope picture: decoded height alone would say 800p.
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId: 'primary', throughputHistory: [], capabilities: {},
    video: { width: 1920, height: 800, codec: 'hevc' } } as unknown as Snapshot;
  const view = present(source, snapshot);
  expect(view.quality.split(' · ')[0]).toBe('1080p');
  expect(view.playingLabel).toBe('1080p WEB-DL · DD+ 5.1 · 4.2 GB');
  expect(view.playingVersionId).toBe('v1080');
  // A conversion shows its own size; a server that does not say leaves the badge as it was.
  const converted = present({ ...source, selectedPathId: 'hls' }, { ...snapshot, sourceId: 'hls', video: { width: 1280, height: 720, codec: 'h264' } } as Snapshot);
  expect(converted.quality.split(' · ')[0]).toBe('720p');
  // The 818p rung of a 4K release's ladder is not called 4K.
  const rung = present({ ...source, playingLabel: '4K Blu-ray · DTS 7.1 · 54.7 GB' }, { ...snapshot, video: { width: 1920, height: 818, codec: 'h264' } } as Snapshot);
  expect(rung.quality.split(' · ')[0]).toBe('818p');
  const quiet = present(plan(), { ...snapshot, sourceId: 'primary' } as Snapshot);
  expect(quiet.quality.split(' · ')[0]).toBe('800p');
  expect(quiet.playingVersionId).toBeUndefined();
});

test('release labels lead with their resolution', () => {
  expect(labelResolution('4K Dolby Vision Remux · TrueHD Atmos 7.1')).toBe('4K');
  expect(labelResolution('2160p WEB-DL')).toBe('4K');
  expect(labelResolution('1080p WEB-DL · DD+ 5.1')).toBe('1080p');
  expect(labelResolution('Auto · now 1080p WEB-DL')).toBe('');
  expect(labelResolution('Director’s Cut · 1080p')).toBe('');
});

test('subtitle labels translate languages and source formats and merge matching identities', () => {
  const source = plan();
  source.subtitleTracks = [{ id: 'english', kind: 'subtitle', language: 'en', name: 'en', codec: 'subrip' }];
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, subtitleTracks: [
    { id: 'english', label: 'en · APPLICATION/X-MEDIA3-CUES', language: 'en', codec: 'application/x-media3-cues' },
    { id: 'commentary', label: 'Commentary', language: 'en', codec: 'text/x-ssa' },
    { id: 'french', language: 'fr', codec: 'application/pgs' },
    { id: 'spanish', language: 'es', codec: 'text/vtt' },
    { id: 'german', language: 'de', codec: 'application/x-media3-cues' },
  ], throughputHistory: [], capabilities: {} } as unknown as Snapshot;
  expect(present(source, snapshot).subtitles).toEqual([
    { id: 'english', name: 'English', detail: 'SRT' },
    { id: 'commentary', name: 'Commentary', detail: 'English · ASS' },
    { id: 'french', name: 'French', detail: 'PGS' },
    { id: 'spanish', name: 'Spanish', detail: 'WebVTT' },
    { id: 'german', name: 'German', detail: '' },
  ]);
});

test('a Plex subtitle titled with its language code and format is named by its language', () => {
  const source = plan();
  source.subtitleTracks = [
    { id: 'en-pgs', kind: 'subtitle', language: 'en', name: 'en PGS', codec: 'pgs' },
    { id: 'fr-pgs', kind: 'subtitle', language: 'fr', name: 'fr PGS', codec: 'pgs' },
    { id: 'en-sdh', kind: 'subtitle', language: 'en', name: 'English SDH SRT', codec: 'srt' },
  ] as never;
  const snapshot = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, subtitleTracks: [], throughputHistory: [], capabilities: {} } as unknown as Snapshot;
  expect(present(source, snapshot).subtitles).toEqual([
    { id: 'en-pgs', name: 'English', detail: 'PGS' },
    { id: 'fr-pgs', name: 'French', detail: 'PGS' },
    { id: 'en-sdh', name: 'English SDH SRT', detail: '' },
  ]);
});

/** Ether 0.3.25 for an adaptive-HLS client: direct play of the original, an adaptive master beside it (its ladder
 * H.264 rungs; no source id, as Ether sends it) and fixed HEVC rungs. */
function adaptivePlan(selected = 'adaptive-hls'): PlaybackPlan {
  const base = { sourceId: 'src', timelineId: 'src', transport: 'hls', kind: 'transcode', qualities: [], boundaries: [] };
  const fixed = (height: number, average: number) => ({ ...base, id: `quality-${height}p${average}`, readiness: 'on-demand',
    quality: { width: height * 16 / 9, height, codec: 'hevc', codecStatus: 'pending', bitrate: average * 1200, averageBitrate: average * 1000 } });
  return { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, selectedPathId: selected, paths: [
    { ...base, id: 'primary', kind: 'direct', transport: 'file', readiness: 'ready', original: true, originalVideo: { codec: 'h264', width: 1920, height: 1080 } },
    { kind: 'transcode', transport: 'hls', id: 'adaptive-hls', adaptive: true, readiness: 'ready', boundaries: [],
      qualities: [[720, 4_200_000], [480, 1_700_000], [360, 1_000_000]].map(([height, bitrate]) => ({ id: `rung-${height}`, width: height! * 16 / 9, height, bitrate, videoCodec: 'avc1.64001f' })) },
    fixed(1080, 8640), fixed(720, 6640), fixed(720, 4640), fixed(480, 2140),
  ], audioTracks: [], subtitleTracks: [] } as unknown as PlaybackPlan;
}
const aether = (sourceId: string, extra: Partial<Snapshot> = {}) => ({ sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId, state: 'playing',
  renditions: [], renditionId: null, lockedQuality: null, backend: 'aether-hls', throughputHistory: [], capabilities: {}, ...extra }) as unknown as Snapshot;

test('while the adaptive path plays on a native player, Automatic is offered and checked, with the rung playing as detail', () => {
  const view = present(adaptivePlan(), aether('adaptive-hls', { video: { width: 852, height: 480, codec: 'h264' } } as Partial<Snapshot>));
  expect(view.qualityAuto).toBe(true);
  expect(view.qualityAutoId).toBe('path:adaptive-hls');
  expect(view.lockedQuality).toBe('');
  expect(view.quality).toContain('480p');
  // Before the first report too.
  expect(present(adaptivePlan(), null).qualityAuto).toBe(true);
});

test('a rung of the adaptive ladder is the server path of its height on a native player, the nearest rate', () => {
  const view = present(adaptivePlan(), aether('adaptive-hls'));
  const rung720 = view.qualities.find(q => q.resolution === '720p')!;
  // The 4.2 Mbit/s rung: the 4.6 Mbit/s fixed rung, not the 6.6.
  expect(rung720.id).toBe('path:quality-720p4640');
  expect(rung720.aliases).toContain('rung-720');
  expect(rung720.disabledReason).toBe('');
  // No fixed path of 360p: shown, but it cannot be held.
  expect(view.qualities.find(q => q.resolution === '360p')!.disabledReason).toBe('Plays only within Automatic quality');
});

test('on a fixed rung or the original, Automatic is offered unchecked and returns to the adaptive path', () => {
  const rung = present(adaptivePlan('quality-720p4640'), aether('quality-720p4640'));
  expect(rung.qualityAuto).toBe(true);
  expect(rung.qualityAutoId).toBe('path:adaptive-hls');
  expect(rung.lockedQuality).toBe('path:quality-720p4640');
  const original = present(adaptivePlan('primary'), aether('primary'));
  expect(original.qualityAuto).toBe(true);
  expect(original.lockedQuality).toBe('path:primary');
  // A direct path not marked original (the mock's `direct`) is held too: Automatic is not checked over it.
  const direct = adaptivePlan('direct'); direct.paths[0] = { ...direct.paths[0]!, id: 'direct', original: undefined } as typeof direct.paths[0];
  expect(present(direct, aether('direct')).lockedQuality).toBe('path:direct');
  expect(qualityReached('path:adaptive-hls', aether('adaptive-hls', { waiting: false } as Partial<Snapshot>), adaptivePlan())).toBe(true);
});

test('without an adaptive path a native player has no Automatic row; the web keeps its own rendition choice', () => {
  const none = adaptivePlan('primary'); none.paths = none.paths.filter(path => !path.adaptive);
  expect(present(none, aether('primary')).qualityAuto).toBe(false);
  // The web engine picks HLS renditions itself: its Automatic is its own (null), and a rung stays a rung.
  const web = present(plan(), { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, sourceId: 'hls', backend: 'mse', renditions: [], throughputHistory: [], capabilities: {} } as unknown as Snapshot);
  expect(web.qualityAuto).toBe(true);
  expect(web.qualityAutoId).toBeNull();
  expect(web.qualities.find(q => q.resolution === '1080p')!.id).toBe('hls-1080');
  const webAdaptive = present(adaptivePlan(), aether('adaptive-hls', { backend: 'mse' } as Partial<Snapshot>));
  expect(webAdaptive.qualityAutoId).toBeNull();
  expect(webAdaptive.qualities.find(q => q.resolution === '720p')!.id).toBe('rung-720');
});
