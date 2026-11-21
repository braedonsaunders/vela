// A book's bytes crossing into the reader's web view on phones and tablets (widgets/media/reader-bytes.ts).
import { expect, test } from 'bun:test';
import { readerChunk, toBase64 } from '../src/widgets/media/reader-bytes';

const bytes = (text: string) => new TextEncoder().encode(text);

test('base64 matches the standard encoding, padding included', () => {
  for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) expect(toBase64(bytes(text))).toBe(Buffer.from(text).toString('base64'));
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  expect(toBase64(all)).toBe(Buffer.from(all).toString('base64'));
});

test('a large slice encodes in one string without overflowing the call stack', () => {
  const large = Uint8Array.from({ length: 300_001 }, (_, i) => (i * 31) & 255);
  expect(toBase64(large)).toBe(Buffer.from(large).toString('base64'));
});

test('slices cover the book end to end and decode back to it', () => {
  const book = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) & 255);
  const parts: Buffer[] = [];
  for (let offset = 0; ;) {
    const chunk = readerChunk(book, offset, 300);
    if (!chunk) break;
    const decoded = Buffer.from(chunk, 'base64');
    parts.push(decoded);
    offset += decoded.length;
  }
  expect(parts.map(part => part.length)).toEqual([300, 300, 300, 100]);
  expect(Buffer.concat(parts).equals(Buffer.from(book))).toBe(true);
});

test('an offset at or past the end, negative or fractional, reads nothing', () => {
  const book = bytes('abc');
  expect(readerChunk(book, 3)).toBe('');
  expect(readerChunk(book, 9)).toBe('');
  expect(readerChunk(book, -1)).toBe('');
  expect(readerChunk(book, 0.5)).toBe('');
  expect(readerChunk(book, 1)).toBe(Buffer.from('bc').toString('base64'));
});
