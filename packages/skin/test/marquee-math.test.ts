import { expect, test } from 'bun:test';
import { marqueeScrolls, marqueeStep } from '../src/blocks/marquee-math';

test('the run moves at its speed and wraps at one copy, keeping its place when the copy changes width', () => {
  expect(marqueeStep(0, 1000, 64, 500)).toBe(64);
  expect(marqueeStep(480, 500, 64, 500)).toBe(12);
  expect(marqueeStep(300, 0, 64, 250)).toBe(50);
  expect(marqueeStep(10, -5, 64, 500)).toBe(10);
  expect(marqueeStep(10, 16, 64, 0)).toBe(0);
  expect(marqueeStep(Number.NaN, 16, 64, 500)).toBe(0);
});

test('only a run wider than its band scrolls', () => {
  expect(marqueeScrolls(1200, 800)).toBe(true);
  expect(marqueeScrolls(600, 800)).toBe(false);
  expect(marqueeScrolls(0, 800)).toBe(false);
});
