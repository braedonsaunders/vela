import { expect, test } from 'bun:test';
import type { Snapshot } from '@vela/player-api';
import { presentedAfter, restartAt } from '../src/widgets/player/present';

test('Try again and a return to the foreground start again at a zero the player presented', () => {
  // A Start Over to 0 s, confirmed and reported paused, on a title opened with a 1800 s resume point.
  expect(restartAt(0, true)).toBe(0);
  // A zero reported while loading is a reset clock: the title's own start point stands.
  expect(restartAt(0, false)).toBeUndefined();
  expect(restartAt(1815, false)).toBe(1815);
});

const report = (state: string, position: number, generation = 2) =>
  ({ sessionId: 's1', sourceGeneration: generation, seekGeneration: generation, state, position }) as unknown as Snapshot;

test('Try again starts again at a presented zero after the player reports the failure there', () => {
  const paused = report('paused', 0);
  const failed = report('failed', 0);
  const presented = presentedAfter(presentedAfter(false, null, paused), paused, failed);
  expect(restartAt(0, presented)).toBe(0);
  expect(presentedAfter(presented, failed, report('ended', 0))).toBe(true);
});

test('a running player reporting zero without presenting it, or a new generation, forgets a presented zero', () => {
  const paused = report('paused', 0);
  expect(presentedAfter(true, paused, report('loading', 0))).toBe(false);
  expect(presentedAfter(true, paused, report('buffering', 0))).toBe(false);
  expect(presentedAfter(true, paused, report('failed', 0, 3))).toBe(false);
  // A failure reported somewhere else is not the place the player presented.
  expect(presentedAfter(true, paused, report('failed', 0.5))).toBe(false);
  expect(presentedAfter(false, null, report('failed', 0))).toBe(false);
});
