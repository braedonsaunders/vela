import { expect, test } from 'bun:test';
import { launchReady, launchSession, type LaunchState } from '../../../apps/vela/src/launch-state';

test('launch waits for the first rendered answer, including failures and signed-out routing', () => {
  expect(launchReady('starting', 'idle', true, false, false)).toBe(false);
  expect(launchReady('signed-in', 'loading', true, false, false)).toBe(false);
  expect(launchReady('signed-in', 'ready', false, false, false)).toBe(false);
  expect(launchReady('signed-in', 'ready', true, false, false)).toBe(true);
  expect(launchReady('signed-in', 'failed', true, false, false)).toBe(true);
  expect(launchReady('signed-out', 'idle', true, false, false)).toBe(false);
  expect(launchReady('signed-out', 'idle', true, true, false)).toBe(true);
  expect(launchReady('starting', 'idle', true, false, true)).toBe(true);
});
test('launch survives session restoration and never replays for navigation or refresh', () => {
  const boot: LaunchState = { signedIn: false, stage: 'intro', run: 0 };
  const restored = launchSession(boot, true);
  expect(restored).toEqual({ signedIn: true, stage: 'intro', run: 0 });
  const done: LaunchState = { ...restored, stage: 'done' };
  expect(launchSession(done, true)).toBe(done);
  const signedOut = launchSession(done, false);
  expect(signedOut.stage).toBe('done');
  expect(launchSession(signedOut, true)).toEqual({ signedIn: true, stage: 'intro', run: 1 });
});
