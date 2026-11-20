import { expect, test } from 'bun:test';
import { sectionDirection } from '../../../apps/vela/src/section-motion';

test('section motion follows the destination order in either direction', () => {
  expect(sectionDirection(3, 1)).toBe(1);
  expect(sectionDirection(1, 3)).toBe(-1);
});

test('section motion treats a stable or unknown order as forward', () => {
  expect(sectionDirection(2, 2)).toBe(1);
  expect(sectionDirection(-1, -1)).toBe(1);
});
