import { expect, test } from 'bun:test';
import { tvPixelScale } from '../src/tv-pixel-scale';

test('Android TV fixed lengths occupy the same screen fraction across logical densities', () => {
  for (const [width, height] of [[960, 540], [1280, 720], [1920, 1080], [3840, 2160]]) {
    expect(100 * tvPixelScale(width, height) / width).toBeCloseTo(125 / 1920);
  }
});
test('TV scale fits both axes and tolerates an unavailable initial measurement', () => {
  expect(tvPixelScale(1920, 540)).toBe(0.625);
  expect(tvPixelScale(0, 0)).toBe(1.25);
  expect(tvPixelScale(Number.NaN, 1080)).toBe(1.25);
});
