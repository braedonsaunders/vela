import { describe, expect, test } from 'bun:test';
import { photoStageHeight } from '../src/blocks/gallery/photo-layout';

describe('Gallery photo stage layout', () => {
  test('fits the caption including the gap after it has been measured, even when the title wraps', () => {
    expect(photoStageHeight(630, 28, 700, 88)).toBe(583);
    expect(photoStageHeight(630, 28, 700, 126)).toBe(545);
    expect(photoStageHeight(504, 28, 544, 88)).toBe(427);
  });

  test('keeps a preferred height that already fits', () => {
    expect(photoStageHeight(490, 20, 700, 82)).toBe(490);
    expect(photoStageHeight(490, 20, 593, 82)).toBe(490);
  });

  test('waits for both measurements and never allocates a negative height', () => {
    expect(photoStageHeight(490, 20, undefined, 82)).toBe(490);
    expect(photoStageHeight(490, 20, 700)).toBe(490);
    expect(photoStageHeight(490, 20, 80, 82)).toBe(0);
  });
});
