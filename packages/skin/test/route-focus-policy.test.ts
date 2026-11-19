import { expect, test } from 'bun:test';
import { restoreRouteFocus } from '../src/route-focus-policy';

test('native touch navigation does not restore TV focus over the keyboard', () => {
  expect(restoreRouteFocus('android', false)).toBe(false);
  expect(restoreRouteFocus('ios', false)).toBe(false);
});

test('TV and web keep route opener focus restoration', () => {
  expect(restoreRouteFocus('android', true)).toBe(true);
  expect(restoreRouteFocus('ios', true)).toBe(true);
  expect(restoreRouteFocus('web', false)).toBe(true);
});
