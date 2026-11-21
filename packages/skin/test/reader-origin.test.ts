// The reader grows out of the book's cover and shrinks back into it (widgets/media/reader-origin.ts).
import { expect, test } from 'bun:test';
import { bookFrom, bookRect, COVER_ASPECT, noteReaderOrigin, pageFill, takeReaderOrigin } from '../src/widgets/media/reader-origin';

test('the opening book stands centred in the cover\'s shape, large on a desktop and within a phone\'s width', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1024, height: 1366 }, { width: 2560, height: 1080 }]) {
    const book = bookRect(viewport);
    expect(Math.abs(book.width / book.height - COVER_ASPECT)).toBeLessThan(0.01);
    expect(book.width).toBeLessThanOrEqual(viewport.width * 0.75);
    expect(book.height).toBeLessThanOrEqual(viewport.height * 0.8);
    expect(Math.abs(book.x + book.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
  }
  expect(bookRect({ width: 1440, height: 900 }).height).toBe(720);
});

test('the book grows out of the cover with one scale: centred on it, as tall as it', () => {
  const book = bookRect({ width: 1440, height: 900 });
  const from = bookFrom({ x: 106, y: 164, width: 280, height: 420 }, book);
  expect(from).toEqual({ x: 106 + 140 - 720, y: 164 + 210 - 450, scale: Number((420 / book.height).toFixed(4)) });
});

test('the page under the cover fills the window from the book\'s place', () => {
  const viewport = { width: 1440, height: 900 };
  const book = bookRect(viewport);
  const fill = pageFill(book, viewport);
  expect(book.width * fill.scaleX).toBeCloseTo(1440, 0);
  expect(book.height * fill.scaleY).toBeCloseTo(900, 0);
  expect(Math.abs(fill.x)).toBeLessThanOrEqual(1);
});

test('the origin is used once: a reader opened another way opens in place', () => {
  noteReaderOrigin({ x: 1, y: 2, width: 3, height: 4 });
  expect(takeReaderOrigin()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  expect(takeReaderOrigin()).toBeNull();
  noteReaderOrigin({ x: 1, y: 2, width: 0, height: 4 });
  expect(takeReaderOrigin()).toBeNull();
});
