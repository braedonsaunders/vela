import { expect, test } from 'bun:test';
import { runs } from '../src/keyframes';

const pulse = { keyframes: 'breathe', duration: 1400, iterations: 'infinite' as const };
const drift = { keyframes: 'drift', duration: 32000, iterations: 'infinite' as const };
const once = { keyframes: 'rise', duration: 400 };

test('a looping animation runs only while its screen is the one showing', () => {
  expect(runs(pulse, true, false)).toBe(true);
  expect(runs(pulse, false, false)).toBe(false);
});

test('long ambient loops never run on a TV; short loops (a skeleton pulse) do', () => {
  expect(runs(drift, true, true)).toBe(false);
  expect(runs(drift, true, false)).toBe(true);
  expect(runs(pulse, true, true)).toBe(true);
});

test('a one-shot animation is unaffected', () => {
  expect(runs(once, false, true)).toBe(true);
});
