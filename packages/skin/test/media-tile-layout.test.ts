import { expect, test } from 'bun:test';
import { tilesPerRow } from '../src/blocks/media/tile-layout';

test('two album tiles fit the measured phone modal content width', () => {
  for (const [width, inner] of [[390, 349], [375, 334]]) {
    const { size, gap } = tilesPerRow({ small: true, width, gutter: 20 }, 140, inner);
    expect(size * 2 + gap).toBeLessThanOrEqual(inner);
    expect(inner - (size * 2 + gap)).toBeLessThan(2);
  }
});
