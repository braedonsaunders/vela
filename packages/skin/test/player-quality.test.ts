import { expect, test } from 'bun:test';
import type { PlaybackPlan, Snapshot } from '@vela/player-api';
import { present, qualityReached } from '../src/widgets/player/present';

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

test('Plex/Jellyfin original-only and direct-with-fixed-HLS plans stay honest when they have no quality ladder', () => {
  const source = plan();source.paths = source.paths.slice(0, 1);source.selectedPathId = 'primary';
  expect(present(source, null).qualities).toHaveLength(1);
  source.paths.push({ id: 'plex-hls', kind: 'transcode', transport: 'hls', readiness: 'ready', url: '', mimeType: 'application/vnd.apple.mpegurl', qualities: [], boundaries: [] });
  expect(present(source, null).qualities).toHaveLength(1);
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
