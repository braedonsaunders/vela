import { expect, test } from 'bun:test';
import { shouldRotateHero } from '../src/hero-rotation';

const base = { onHome: true, heroCount: 3, still: false, query: '', heroPreviewing: false, flags: [] as string[] };

test('hero rotation pauses for the explicit control and interaction', () => {
  expect(shouldRotateHero(base)).toBe(true);
  expect(shouldRotateHero({ ...base, flags: ['hero-paused'] })).toBe(false);
  expect(shouldRotateHero({ ...base, flags: ['hero-interacting'] })).toBe(false);
  expect(shouldRotateHero({ ...base, still: true })).toBe(false);
});
