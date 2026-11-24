// The home hero's carousel holds while the viewer uses the hero: on the web while pointer or focus
// is in it; on TV only for a while after a move, because Home opens with focus on the hero.
import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { TV_HERO_HOLD_MS, holdHero } from '../src/hero-hold';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function flags() {
  const set = new Set<string>();
  return { set, setFlag: (flag: string, on: boolean) => { if (on) set.add(flag); else set.delete(flag); } };
}

test('on TV, focus resting in the hero holds the carousel only for a while', () => {
  const { set, setFlag } = flags();
  holdHero(setFlag, true, true);
  expect(set.has('hero-interacting')).toBe(true);
  jest.advanceTimersByTime(TV_HERO_HOLD_MS - 1);
  expect(set.has('hero-interacting')).toBe(true);
  jest.advanceTimersByTime(1);
  expect(set.has('hero-interacting')).toBe(false);
});

test('on TV, each move within the hero renews the hold', () => {
  const { set, setFlag } = flags();
  holdHero(setFlag, true, true);
  jest.advanceTimersByTime(TV_HERO_HOLD_MS - 1000);
  holdHero(setFlag, false, true);
  holdHero(setFlag, true, true);
  jest.advanceTimersByTime(TV_HERO_HOLD_MS - 1000);
  expect(set.has('hero-interacting')).toBe(true);
  jest.advanceTimersByTime(1000);
  expect(set.has('hero-interacting')).toBe(false);
});

test('on the web, focus in the hero holds until it leaves', () => {
  const { set, setFlag } = flags();
  holdHero(setFlag, true, false);
  jest.advanceTimersByTime(10 * TV_HERO_HOLD_MS);
  expect(set.has('hero-interacting')).toBe(true);
  holdHero(setFlag, false, false);
  jest.advanceTimersByTime(0);
  expect(set.has('hero-interacting')).toBe(false);
});
