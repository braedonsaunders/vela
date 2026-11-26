import { expect, test } from 'bun:test';
import { saturateBlurhash, saturateLinearColor } from '../src/blocks/media/blurhash-color';

test('boosts contrast between color channels at the same luminance', () => {
  const [red, green, blue] = saturateLinearColor([0.55, 0.30, 0.12], 1.75);
  expect(red).toBeGreaterThan(0.55);
  expect(green).toBeGreaterThan(blue);
  expect(blue).toBeLessThan(0.12);
  expect(0.2126 * red + 0.7152 * green + 0.0722 * blue).toBeCloseTo(0.2126 * 0.55 + 0.7152 * 0.30 + 0.0722 * 0.12, 8);
  for (const channel of saturateLinearColor([0.25, 0.25, 0.25], 1.75)) expect(channel).toBeCloseTo(0.25, 8);
});

test('keeps the cover hash at the same detail level', () => {
  const original = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';
  const vivid = saturateBlurhash(original, 1.75);
  expect(vivid).not.toBe(original);
  expect(vivid[0]).toBe(original[0]);
  expect(vivid).toHaveLength(original.length);
  expect(saturateBlurhash(original, 1)).toBe(original);
  expect(saturateBlurhash('000000', 1.75)).toBe('000000');
  expect(saturateBlurhash('invalid', 1.75)).toBe('invalid');
});
