import { expect, test } from 'bun:test';
import { HERO_OFFSCREEN, shouldRotateHero } from '../src/hero-rotation';

const base = { onHome: true, heroCount: 3, still: false, query: '', heroPreviewing: false, flags: [] as string[] };

test('hero rotation pauses for the explicit control and interaction', () => {
  expect(shouldRotateHero(base)).toBe(true);
  expect(shouldRotateHero({ ...base, flags: ['hero-paused'] })).toBe(false);
  expect(shouldRotateHero({ ...base, flags: ['hero-interacting'] })).toBe(false);
  expect(shouldRotateHero({ ...base, still: true })).toBe(false);
});

test('a hero scrolled off the screen holds its title until it is back', () => {
  expect(shouldRotateHero({ ...base, flags: [HERO_OFFSCREEN] })).toBe(false);
  expect(shouldRotateHero({ ...base, flags: ['keep-page-scrolled'] })).toBe(true);
});
