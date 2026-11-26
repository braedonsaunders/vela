import { expect, test } from 'bun:test';
import { readingChapterLabel, readTitleBackdrop } from '../src/blocks/read/book-layout';

test('the book hero drops a stored percentage while keeping its chapter or page label', () => {
  expect(readingChapterLabel('Chapter 3 · 34%')).toBe('Chapter 3');
  expect(readingChapterLabel('Page 3 of 20 · 15.5 %')).toBe('Page 3 of 20');
  expect(readingChapterLabel('34%')).toBe('');
  expect(readingChapterLabel('')).toBe('');
  expect(readingChapterLabel('Chapter 1 · The 50% Rule')).toBe('Chapter 1 · The 50% Rule');
  expect(readingChapterLabel('Someone Said 50%')).toBe('Someone Said 50%');
});

test('TV book pages keep the cover in the hero and omit the enlarged backdrop', () => {
  expect(readTitleBackdrop('book', true, 'cover')).toBe('');
  expect(readTitleBackdrop('book', false, 'cover')).toBe('cover');
  expect(readTitleBackdrop('series', true, 'series')).toBe('series');
  expect(readTitleBackdrop('book', false)).toBe('');
});
