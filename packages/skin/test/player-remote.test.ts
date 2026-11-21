import { expect, test } from 'bun:test';
import { onPicture, PICTURE_TEST_ID, remotePress } from '../src/widgets/player/remote-actions';
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


test('dedicated channel keys reach live tuning while directions remain navigation', () => {
  const calls: string[] = [];
  const actions = { liveKey: (key: string) => { calls.push(key); return true; }, wake: () => calls.push('wake') } as unknown as Shortcuts;
  remotePress('channelUp', actions);
  remotePress('channelDown', actions);
  expect(calls).toEqual(['ChannelUp', 'wake', 'ChannelDown', 'wake']);
  expect(() => remotePress('channelUp', { wake() {} } as unknown as Shortcuts)).not.toThrow();
});

function recorder(visible: boolean, live = false) {
  const calls: (string | number)[] = [];
  const actions = {
    visible,
    wake: (focus?: string) => calls.push(focus ? `wake:${focus}` : 'wake'),
    seekBy: (n: number) => calls.push(n),
    togglePlay: () => calls.push('toggle'),
    ...(live ? { liveKey: () => true } : {}),
  } as unknown as Shortcuts;
  return { calls, actions };
}

test('a press on the focused picture plays, pauses and steps, bringing the chrome up', () => {
  const { calls, actions } = recorder(false);
  for (const key of ['select', 'right', 'left', 'up']) remotePress(key, actions, PICTURE_TEST_ID);
  expect(calls).toEqual(['toggle', 'wake:toggle', 10, 'wake:timeline', -10, 'wake:timeline', 'wake']);
});

test('the picture is trusted over a visibility flag a render behind', () => {
  // Native focus is on the picture although the last render still showed the chrome.
  const { calls, actions } = recorder(true);
  remotePress('select', actions, PICTURE_TEST_ID);
  expect(calls).toEqual(['toggle', 'wake:toggle']);
});

test('a focused control keeps select and the side presses, whatever the flag says', () => {
  for (const visible of [false, true]) {
    for (const focus of ['player-toggle', 'player-scrub', '']) {
      const { calls, actions } = recorder(visible);
      for (const key of ['select', 'right', 'left']) remotePress(key, actions, focus);
      expect(calls).toEqual(['wake', 'wake']);
    }
  }
});

test('with nothing focused, presses act only while the chrome is hidden', () => {
  const hidden = recorder(false);
  remotePress('select', hidden.actions, 'none');
  remotePress('right', hidden.actions, 'none');
  expect(hidden.calls).toEqual(['toggle', 'wake:toggle', 10, 'wake:timeline']);
  const shown = recorder(true);
  remotePress('select', shown.actions, 'none');
  remotePress('right', shown.actions, 'none');
  expect(shown.calls).toEqual(['wake']);
});

test('a live channel has nothing to step through from the picture', () => {
  const { calls, actions } = recorder(false, true);
  remotePress('right', actions, PICTURE_TEST_ID);
  remotePress('select', actions, PICTURE_TEST_ID);
  expect(calls).toEqual(['wake', 'toggle', 'wake:toggle']);
});

test('only the picture and nothing at all count as the picture', () => {
  expect(onPicture(PICTURE_TEST_ID, true)).toBe(true);
  expect(onPicture('none', false)).toBe(true);
  expect(onPicture('none', true)).toBe(false);
  expect(onPicture('player-toggle', false)).toBe(false);
  expect(onPicture(undefined, false)).toBe(false);
});
