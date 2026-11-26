import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan } from '../src/wire';

const plan = (generation: number, extra: Partial<PlaybackPlan> = {}) => ({
  sessionId: 'watch', revision: generation, sourceGeneration: generation, seekGeneration: 1,
  state: 'playing', positionSeconds: generation === 1 ? 42 : 47, durationSeconds: 180,
  titleId: 'film', selectedPathId: 'original',
  paths: [{ id: 'original', kind: 'direct', transport: 'file', readiness: 'ready', url: `/media/g${generation}` }],
  audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null, chapters: [],
  fallback: { state: 'unsupported' },
  ...extra,
} as unknown as PlaybackPlan);

function harness(next: PlaybackPlan) {
  let current = plan(1);
  const adapter = {
    startPlayback: async () => current,
    sessionSnapshot: async () => ({ plan: next }),
    reportObservation: async () => ({ accepted: true }),
    command: async () => current,
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (value: PlaybackPlan) => value }),
    negotiate: async () => {}, key: () => 'key', client: {} };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  return { box, playback, start: async () => { await playback.start({ kind: 'title', id: 'film' }); current = next; } };
}

test('original loss reopens the newer source generation at the plan position', async () => {
  const replacement = plan(2, { playingVersionId: 'web', playingLabel: '1080p WEB-DL' });
  const h = harness(replacement);
  await h.start();
  expect(await h.playback.originalLost('watch', 46.5, 1)).toBe('reopened');
  expect(h.box.get().playback.plan).toMatchObject({ sourceGeneration: 2, positionSeconds: 47,
    playingVersionId: 'web', playingLabel: '1080p WEB-DL' });
  expect(h.box.get().playback.phase).toBe('playing');
  await h.playback.stop();
});

test('a pinned lost original holds position and offers versions without ending', async () => {
  const unavailable = plan(1, { revision: 2, positionSeconds: 46.5, sourceFailure: 'version_unavailable' });
  const h = harness(unavailable);
  await h.start();
  expect(await h.playback.originalLost('watch', 46.5)).toBe('version_unavailable');
  expect(h.box.get().playback.plan?.sourceFailure).toBe('version_unavailable');
  expect(h.box.get().playback.phase).toBe('playing');
  await h.playback.stop();
});
