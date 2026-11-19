import { describe, expect, test } from 'bun:test';
import type { VelaPlayerProps } from '@vela/player-api';
import { windowsSnapshot } from '../src/windows/snapshot';

type Plan = NonNullable<VelaPlayerProps['plan']>;
const plan: Plan = {
  sessionId: 's1', revision: 4, sourceGeneration: 2, seekGeneration: 3, state: 'playing', positionSeconds: 42, durationSeconds: 3600,
  paths: [
    { id: 'direct', kind: 'direct', transport: 'file', mimeType: 'video/x-matroska', readiness: 'ready', url: 'https://ether.example/a.mkv', qualities: [], boundaries: [] },
    { id: 'hls', kind: 'transcode', transport: 'hls', mimeType: 'application/vnd.apple.mpegurl', readiness: 'on-demand', qualities: [], boundaries: [] },
  ],
  selectedPathId: 'hls',
  audioTracks: [
    { id: 'a1', kind: 'audio', language: 'en', name: 'English 5.1', codec: 'eac3' },
    { id: 'a2', kind: 'audio', language: 'fr', name: 'Français', codec: 'aac' },
  ],
  subtitleTracks: [{ id: 's-en', kind: 'subtitle', language: 'en', name: 'English', codec: 'subrip' }],
  selectedAudioTrackId: 'a2', selectedSubtitleTrackId: 's-en',
  chapters: [{ id: 'c1', name: 'Opening', startSeconds: 0, endSeconds: 60 }],
  fallback: { state: 'unsupported' },
} as Plan;

describe('windowsSnapshot', () => {
  test('identity, tracks and chapters come from the plan, not native telemetry', () => {
    const snapshot = windowsSnapshot({ sessionId: 'spoofed', state: 'playing', position: 50 }, { plan });
    expect(snapshot).toMatchObject({
      sessionId: 's1', sourceGeneration: 2, seekGeneration: 3, sourceId: 'hls', strategy: 'transcode', backend: 'file',
      state: 'playing', position: 50, duration: 3600, audioTrackId: 'a2', subtitleTrackId: 's-en',
      capabilities: { pip: false, fullscreen: true, audioSwitch: true }, chapters: plan.chapters,
    });
    expect(snapshot.audioTracks.map(t => [t.id, t.label])).toEqual([['a1', 'English 5.1'], ['a2', 'Français']]);
    expect(snapshot.audioTrackIds).toEqual(['a1', 'a2']);
    expect(snapshot.subtitleTracks.map(t => t.label)).toEqual(['English']);
  });

  test('without native values the plan supplies position and duration', () => {
    const snapshot = windowsSnapshot(undefined, { plan });
    expect(snapshot).toMatchObject({ state: 'loading', preparation: 'media-metadata', position: 42, duration: 3600, speed: 1, volume: 1, muted: false, waiting: false });
    expect(snapshot.playable).toEqual([]);
    expect(snapshot.bufferAheadSeconds).toBeNull();
  });

  test('sanitises malformed telemetry', () => {
    const snapshot = windowsSnapshot({ state: 'exploded', position: -5, speed: Number.NaN, volume: 7, muted: 'yes', duration: Infinity, droppedFrames: '3' }, { plan });
    expect(snapshot).toMatchObject({ state: 'loading', position: 0, speed: 1, volume: 1, muted: false, duration: 3600, droppedFrames: null });
    expect(windowsSnapshot({ volume: -1 }, { plan }).volume).toBe(0);
    expect(windowsSnapshot('not an object', { plan }).state).toBe('loading');
  });

  test('buffering waits, and buffered time ahead is playable from the position', () => {
    const snapshot = windowsSnapshot({ state: 'buffering', position: 10, bufferAheadSeconds: 5.5, droppedFrames: 2, totalFrames: 900 }, { plan });
    expect(snapshot).toMatchObject({ waiting: true, preparation: null, bufferAheadSeconds: 5.5, droppedFrames: 2, totalFrames: 900 });
    expect(snapshot.playable).toEqual([{ start: 10, end: 15.5 }]);
    expect(windowsSnapshot({ state: 'playing', bufferAheadSeconds: 0 }, { plan }).playable).toEqual([]);
  });

  test('an explicit null track turns the track off; an absent one keeps the plan choice', () => {
    expect(windowsSnapshot({ subtitleTrackId: null, audioTrackId: 'a1' }, { plan })).toMatchObject({ subtitleTrackId: null, audioTrackId: 'a1' });
    expect(windowsSnapshot({}, { plan })).toMatchObject({ subtitleTrackId: 's-en', audioTrackId: 'a2' });
  });

  test('a server error wins over a native failure', () => {
    const native = { code: 'decoder', message: 'native' };
    const server = { code: 'source', message: 'server' };
    expect(windowsSnapshot({ failure: native }, { plan }).failure).toEqual(native as never);
    expect(windowsSnapshot({ failure: native }, { plan, serverError: server as never }).failure).toEqual(server as never);
  });

  test('without a plan it reports an empty, loading player', () => {
    const snapshot = windowsSnapshot({}, {});
    expect(snapshot).toMatchObject({ sessionId: null, sourceGeneration: 0, seekGeneration: 0, sourceId: null, strategy: null, position: 0, duration: null, audioTrackId: null, subtitleTrackId: null });
    expect(snapshot.capabilities.audioSwitch).toBe(false);
    expect(snapshot.audioTracks).toEqual([]);
  });

  test('every snapshot gets its own subtitle style copy', () => {
    const a = windowsSnapshot({}, { plan }), b = windowsSnapshot({}, { plan });
    expect(a.subtitleStyle).toEqual(b.subtitleStyle);
    expect(a.subtitleStyle).not.toBe(b.subtitleStyle);
  });
});

test('Apple native telemetry retains route diagnostics, client tracks and speed policy', () => {
  const snapshot = windowsSnapshot({ backend: 'aether-original', speeds: [1], audioClientOnly: true,
    subtitleTracks: [{ id: 'mpv-sub-7', label: 'Embedded English', language: 'en', codec: 'srt' }],
    diagnostics: { implementation: 'vela-aether', metadataDiscrepancies: [] }, throughputBps: 1000,
  }, { plan });
  expect(snapshot.backend).toBe('aether-original');
  expect(snapshot.speeds).toEqual([1]);
  expect(snapshot.subtitleTracks[0]?.id).toBe('mpv-sub-7');
  expect(snapshot.diagnostics?.implementation).toBe('vela-aether');
  expect(snapshot.audioClientOnly).toBe(true);
  expect(snapshot.throughputBps).toBe(1000);
  expect(snapshot.sessionId).toBe('s1');
});
