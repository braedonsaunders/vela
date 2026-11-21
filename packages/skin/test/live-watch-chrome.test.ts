import { expect, test } from 'bun:test';
import type { Snapshot } from '@vela/player-api';
import { liveBehind, liveNeedsAttention, liveNotices } from '../src/widgets/guide/live-notices';
import { holdsChrome } from '../src/widgets/player/hold';

type Live = NonNullable<Snapshot['live']>;
const healthy: Live = {
  edgeSeconds: 120, windowStartSeconds: 60, driftSeconds: 0, edgeSource: 'playlist',
  reconnecting: false, delivery: 'available', canCatchUp: false,
};

test('a healthy channel at its usual distance from the edge asks for nothing', () => {
  expect(liveNotices(null)).toEqual([]);
  expect(liveNeedsAttention(null)).toBe(false);
  expect(liveNeedsAttention(healthy)).toBe(false);
  // Raw edge distance without the engine's say-so that playback can catch up is not a lag.
  expect(liveNeedsAttention({ ...healthy, driftSeconds: 18 })).toBe(false);
  expect(liveBehind({ ...healthy, driftSeconds: 18 })).toBe(0);
  expect(liveBehind({ ...healthy, driftSeconds: null, canCatchUp: true })).toBe(0);
  expect(liveBehind({ ...healthy, driftSeconds: Number.NaN, canCatchUp: true })).toBe(0);
});

test('reconnecting, a delivery gap and a real lag are each told, most pressing first', () => {
  expect(liveNotices({ ...healthy, reconnecting: true })).toHaveLength(1);
  for (const delivery of ['upstream-gap', 'segment-delayed', 'waiting-for-publication'] as const)
    expect(liveNeedsAttention({ ...healthy, delivery })).toBe(true);
  const behind = { ...healthy, driftSeconds: 14.4, canCatchUp: true };
  expect(liveBehind(behind)).toBe(14);
  const all = liveNotices({ ...behind, reconnecting: true, delivery: 'segment-delayed' });
  expect(all).toHaveLength(3);
  expect(all[2]).toContain('14');
});

test('the chrome rests on a playing channel whatever its delivery says, and a stall does not hold it', () => {
  const resting = { state: 'playing', started: true, menuOpen: false, active: false, failed: false } as const;
  expect(holdsChrome(resting)).toBe(false);
  for (const state of ['buffering', 'recovering', 'loading', 'idle'] as const) expect(holdsChrome({ ...resting, state })).toBe(false);
  for (const state of ['paused', 'ended', 'failed'] as const) expect(holdsChrome({ ...resting, state })).toBe(true);
  expect(holdsChrome({ ...resting, menuOpen: true })).toBe(true);
  expect(holdsChrome({ ...resting, active: true })).toBe(true);
  expect(holdsChrome({ ...resting, failed: true })).toBe(true);
});

test('a session that has yet to play keeps the chrome up until it does', () => {
  const starting = { started: false, menuOpen: false, active: false, failed: false };
  for (const state of ['idle', 'loading', 'buffering', 'recovering'] as const) expect(holdsChrome({ ...starting, state })).toBe(true);
  expect(holdsChrome({ ...starting, state: 'playing' })).toBe(false);
});
