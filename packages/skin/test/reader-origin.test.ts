// The reader grows out of the book's cover and shrinks back into it (widgets/media/reader-origin.ts).
import { expect, test } from 'bun:test';
import { noteReaderOrigin, takeReaderOrigin, zoomOnto } from '../src/widgets/media/reader-origin';

test('the reader shrinks onto the cover: centred on it, as tall as it, never stretched', () => {
  const zoom = zoomOnto({ x: 106, y: 164, width: 280, height: 420 }, { width: 1440, height: 900 });
  expect(zoom).toEqual({ x: 106 + 140 - 720, y: 164 + 210 - 450, scale: Number((420 / 900).toFixed(4)) });
  // A cover taller than the screen never grows the reader past full size.
  expect(zoomOnto({ x: 0, y: 0, width: 800, height: 1200 }, { width: 800, height: 600 }).scale).toBe(1);
});

test('the origin is used once: a reader opened another way opens in place', () => {
  noteReaderOrigin({ x: 1, y: 2, width: 3, height: 4 });
  expect(takeReaderOrigin()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  expect(takeReaderOrigin()).toBeNull();
  noteReaderOrigin({ x: 1, y: 2, width: 0, height: 4 });
  expect(takeReaderOrigin()).toBeNull();
});
