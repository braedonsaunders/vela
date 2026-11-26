import { afterEach, expect, test } from 'bun:test';
import type { PlaybackPlan } from '../../packages/protocol/types';
import { applyCommand, answerTracks, sidecarFixture, withSidecar, type Session } from '../sessions';

const plan = () => ({
  sessionId: 's', revision: 1, sourceGeneration: 1, seekGeneration: 1, selectedPathId: 'direct', selectedSubtitleTrackId: null,
  subtitleTracks: [], audioTracks: [{ id: 'audio-en', kind: 'audio' }, { id: 'audio-es', kind: 'audio' }], paths: [{ id: 'direct', transport: 'file' }, { id: 'remux', transport: 'hls' }],
}) as unknown as PlaybackPlan;
const initial = { ...sidecarFixture };
afterEach(() => Object.assign(sidecarFixture, initial));

test('the sidecar title delivers its subtitle as an external WebVTT file, selected from the start on the chosen path', () => {
  Object.assign(sidecarFixture, { enabled: true, selected: true, pathId: 'remux' });
  const p = plan();
  withSidecar(p, '/sessions/media/s/t');
  expect(p.subtitleTracks).toEqual([
    expect.objectContaining({ id: 'sub-en', delivery: { kind: 'external', format: 'webvtt', url: '/sessions/media/s/t/subtitles.vtt' } }),
    expect.objectContaining({ id: 'sub-fr', streamIndex: 3, delivery: { kind: 'embedded' } }),
  ]);
  expect(p.selectedSubtitleTrackId).toBe('sub-en');
  expect(p.audioTracks.map(track => [track.id, track.streamIndex])).toEqual([['audio-en', 1], ['audio-es', 2], ['audio-commentary', 3]]);
  expect(p.selectedPathId).toBe('remux');
  expect(p.paths[0]).toMatchObject({ original: true, range: true });
  expect(p.paths[1]).toMatchObject({ id: 'remux', quality: { width: 1280, height: 720 } });
  Object.assign(sidecarFixture, { selected: false, pathId: 'absent' });
  const unselected = plan();
  withSidecar(unselected, '/m');
  expect([unselected.selectedSubtitleTrackId, unselected.selectedPathId]).toEqual([null, 'direct']);
});

test('a track choice is a new source off the original file, as Ether answers it', () => {
  sidecarFixture.enabled = true;
  const p = plan();
  withSidecar(p, '/m');
  answerTracks(p, { subtitleTrackId: null });
  expect([p.selectedSubtitleTrackId, p.sourceGeneration]).toEqual([null, 1]);
  p.selectedPathId = 'remux';
  answerTracks(p, { subtitleTrackId: 'sub-en' });
  expect([p.selectedSubtitleTrackId, p.sourceGeneration]).toEqual(['sub-en', 2]);
});

test('switching editions negotiates the same sidecar and transport as a fresh start', () => {
  Object.assign(sidecarFixture, { enabled: true, versionSwitch: true });
  const versions = [
    { id: 'auto', label: 'Auto', availability: 'instant', recommended: false },
    { id: 'original', label: 'Original', availability: 'instant', recommended: true },
    { id: 'cached', label: 'Cached', availability: 'cached', recommended: false },
  ] satisfies NonNullable<PlaybackPlan['versions']>;
  const previous = { ...plan(), versions, selectedVersionId: 'original', playingVersionId: 'original' };
  withSidecar(previous, '/sessions/media/s/t');
  const session = { plan: previous, mediaToken: 't', history: [], sequence: 0, listeners: new Map() } as unknown as Session;
  applyCommand(session, { kind: 'version', versionId: 'cached', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'switch' });
  const fresh = { ...plan(), versions, selectedVersionId: 'cached', playingVersionId: 'cached' };
  withSidecar(fresh, '/sessions/media/s/t');
  expect(session.plan.selectedSubtitleTrackId).toBe('sub-en-cached');
  expect(session.plan.subtitleTracks).toEqual(fresh.subtitleTracks);
  expect(session.plan.selectedPathId).toBe('remux');
  expect(session.plan.paths.find(path => path.id === session.plan.selectedPathId)?.transport).toBe('hls');
  expect(session.plan.selectedPathId).toBe(fresh.selectedPathId);
});
