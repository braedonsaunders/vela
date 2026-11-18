import { expect, test } from 'bun:test';
import { remotePress } from '../src/widgets/player/remote-actions';
import type { Shortcuts } from '../src/widgets/player/keys';

test('directions only wake controls, even if visibility is stale during native focus transfer', () => {
  for (const visible of [false, true]) {
    const calls: string[] = [];
    const actions = { visible, wake: () => calls.push('wake'), seekBy: () => calls.push('seek'), liveKey: () => { calls.push('channel'); return true; } } as unknown as Shortcuts;
    for (const key of ['up', 'right', 'right', 'down', 'left']) remotePress(key, actions);
    expect(calls).toEqual(['wake', 'wake', 'wake', 'wake', 'wake']);
  }
});

test('dedicated transport presses retain their meaning', () => {
  const calls: (string | number)[] = [];
  const actions = { seekBy: (n: number) => calls.push(n), togglePlay: () => calls.push('toggle'), play: () => calls.push('play'), pause: () => calls.push('pause'), wake: () => calls.push('wake') } as unknown as Shortcuts;
  for (const key of ['rewind', 'fastForward', 'playPause', 'play', 'pause']) remotePress(key, actions);
  expect(calls).toEqual([-10, 10, 'toggle', 'play', 'pause']);
});
