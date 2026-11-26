import { expect, test } from 'bun:test';
import { readBackdropComponents, readingChapterLabel } from '../src/blocks/read/book-layout';

test('the book hero drops a stored percentage while keeping its chapter or page label', () => {
  expect(readingChapterLabel('Chapter 3 · 34%')).toBe('Chapter 3');
  expect(readingChapterLabel('Page 3 of 20 · 15.5 %')).toBe('Page 3 of 20');
  expect(readingChapterLabel('34%')).toBe('');
  expect(readingChapterLabel('')).toBe('');
  expect(readingChapterLabel('Chapter 1 · The 50% Rule')).toBe('Chapter 1 · The 50% Rule');
  expect(readingChapterLabel('Someone Said 50%')).toBe('Someone Said 50%');
});

test('TV and iOS book pages use only low-frequency cover colors as their backdrop', () => {
  expect(readBackdropComponents('book', 'ios', true)).toEqual([3, 4]);
  expect(readBackdropComponents('book', 'android', true)).toEqual([3, 4]);
  expect(readBackdropComponents('book', 'ios', false)).toEqual([3, 4]);
  expect(readBackdropComponents('book', 'web', false)).toBeUndefined();
  expect(readBackdropComponents('book', 'android', false)).toBeUndefined();
  expect(readBackdropComponents('series', 'ios', true)).toBeUndefined();
});
