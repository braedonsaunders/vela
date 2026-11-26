import { describe, expect, test } from 'bun:test';
import { photoStageHeight } from '../src/blocks/gallery/photo-layout';

describe('Gallery photo stage layout', () => {
  test('leaves the full wrapped caption visible in a short title scroll area', () => {
    expect(photoStageHeight(630, 28, 700, 88)).toBe(572);
    expect(photoStageHeight(630, 28, 700, 126)).toBe(534);
    expect(photoStageHeight(504, 28, 544, 88)).toBe(416);
  });

  test('keeps the preferred size when the stage and caption already fit', () => {
    expect(photoStageHeight(490, 20, 700, 82)).toBe(490);
  });

  test('keeps an initial height during measurement and never asks for a negative height', () => {
    expect(photoStageHeight(490, 20, undefined, 82)).toBe(490);
    expect(photoStageHeight(490, 20, 700)).toBe(490);
    expect(photoStageHeight(490, 20, 80, 82)).toBe(0);
  });
});
