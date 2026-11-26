import { expect, jest, mock, test } from 'bun:test';
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

function harness(next: PlaybackPlan, readPlan = async (_id: string) => next) {
  let current = plan(1);
  const adapter = {
    startPlayback: mock(async () => current),
    sessionSnapshot: async (id: string) => ({ plan: await readPlan(id) }),
    reportObservation: async () => ({ accepted: true }),
    command: async () => current,
  };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (value: PlaybackPlan) => value }),
    negotiate: async () => {}, key: () => 'key', client: {} };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  return { box, playback, adapter, start: async () => { await playback.start({ kind: 'title', id: 'film' }); current = next; } };
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

test('an original-loss read cannot reopen a session while its replacement is preparing', async () => {
  const reading = Promise.withResolvers<void>();
  const stale = Promise.withResolvers<PlaybackPlan>();
  const replacement = plan(1, { sessionId: 'replacement' });
  let reads = 0;
  const h = harness(replacement, async id => {
    if (id === 'replacement') return replacement;
    if (++reads === 1) return plan(1);
    reading.resolve();
    return stale.promise;
  });
  jest.useFakeTimers();
  try {
    await h.start();
    const lost = h.playback.originalLost('watch', 46.5, 1);
    await reading.promise;
    h.playback.recover('watch');
    expect(h.box.get().playback.phase).toBe('preparing');

    stale.resolve(plan(2));
    const result = await lost;
    expect(h.box.get().playback).toMatchObject({ phase: 'preparing', sessionId: 'watch', plan: null });
    expect(result).toBe('superseded');

    h.playback.recover('watch');
    const playing = Promise.withResolvers<void>();
    const unsubscribe = h.box.subscribe(() => {
      if (h.box.get().playback.sessionId === 'replacement') playing.resolve();
    });
    jest.advanceTimersByTime(10_000);
    await playing.promise;
    unsubscribe();
    expect(h.box.get().playback).toMatchObject({ phase: 'playing', sessionId: 'replacement' });
    expect(h.adapter.startPlayback).toHaveBeenCalledTimes(2);
  } finally {
    await h.playback.stop();
    jest.useRealTimers();
  }
});
