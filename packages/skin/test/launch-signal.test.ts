import { expect, test } from 'bun:test';
import { holdLaunch, launchSettled, settleLaunch } from '../src/launch-signal';

test('without an ident nothing waits; a held launch waits until it settles, once', () => {
  expect(launchSettled()).toBe(true);
  holdLaunch();
  expect(launchSettled()).toBe(false);
  holdLaunch();
  settleLaunch();
  expect(launchSettled()).toBe(true);
  settleLaunch();
  expect(launchSettled()).toBe(true);
});
