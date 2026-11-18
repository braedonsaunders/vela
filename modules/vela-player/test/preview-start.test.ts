import { expect, test } from 'bun:test';
import { previewStart } from '../web/preview-start';

test('trailer preamble skip leaves short clips playable and rejects invalid offsets', () => {
  expect(previewStart(10, 150)).toBe(10);
  expect(previewStart(10, 12)).toBe(3);
  expect(previewStart(10, Infinity)).toBe(10);
  expect(previewStart(undefined, 150)).toBe(0);
  expect(previewStart(-10, 150)).toBe(0);
  expect(previewStart(NaN, 150)).toBe(0);
});
