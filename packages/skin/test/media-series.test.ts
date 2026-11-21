import { expect, test } from 'bun:test';
import type { Card } from '@vela/core';
import { seriesCanStart, seriesCopy, seriesKind, seriesOrder, seriesStart } from '../src/widgets/media/series';

const book = (id: string, index: number, extra: Partial<NonNullable<Card['media']>> = {}) =>
  ({ id, media: { class: 'book', role: 'book', index, readingFormat: 'epub', ...extra } }) as unknown as Card;
const ids = (cards: Card[]) => cards.map(card => card.id);

test('numbered books come first in order, unnumbered after them in the server\'s order', () => {
  const books = [book('extra-a', 0), book('three', 3), book('one', 1), book('extra-b', 0), book('two', 2)];
  expect(ids(seriesOrder(books))).toEqual(['one', 'two', 'three', 'extra-a', 'extra-b']);
});

test('books sharing a number keep the server\'s order, and the input is not reordered in place', () => {
  const books = [book('b', 2), book('a', 1), book('c', 2), { id: 'bare' } as Card];
  expect(ids(seriesOrder(books))).toEqual(['a', 'b', 'c', 'bare']);
  expect(ids(books)).toEqual(['b', 'a', 'c', 'bare']);
});

const listen = (id: string, index: number, progressSeconds = 0) =>
  ({ ...book(id, index, { class: 'audiobook', role: 'audiobook', readingFormat: '' }), progressSeconds, played: false }) as unknown as Card;

test('Start reading needs the same reading feature as a book page\'s Read', () => {
  const reads = (reading: string[]) => ({ reading, audio: false });
  expect(seriesCanStart(book('one', 1), reads(['epub', 'pdf']))).toBe(true);
  expect(seriesCanStart(book('one', 1), reads([]))).toBe(false);
  expect(seriesCanStart(book('one', 1, { readingFormat: 'cbz' }), reads(['epub']))).toBe(false);
  expect(seriesCanStart(book('one', 1, { readingFormat: '' }), reads(['epub']))).toBe(false);
  expect(seriesCanStart(undefined, reads(['epub']))).toBe(false);
});

test('Start listening needs audio playback, whatever reading this server offers', () => {
  expect(seriesCanStart(listen('a', 1), { reading: [], audio: true })).toBe(true);
  expect(seriesCanStart(listen('a', 1), { reading: ['epub'], audio: false })).toBe(false);
});

test('a series is described by what it holds: books, audiobooks, or neutrally as titles', () => {
  expect(seriesKind([book('a', 1), book('b', 2)])).toBe('book');
  expect(seriesKind([listen('a', 1), listen('b', 2)])).toBe('audiobook');
  expect(seriesKind([book('a', 1), listen('b', 2)])).toBe('mixed');
  // Before its entries load, the series' own class decides.
  expect(seriesKind([], listen('s', 0))).toBe('audiobook');
  expect(seriesKind([])).toBe('book');
  expect(seriesCopy('book', 6)).toEqual({ count: '6 books', heading: 'Books' });
  expect(seriesCopy('audiobook', 6)).toEqual({ count: '6 audiobooks', heading: 'Audiobooks' });
  expect(seriesCopy('audiobook', 1).count).toBe('1 audiobook');
  expect(seriesCopy('mixed', 3)).toEqual({ count: '3 titles', heading: 'Titles' });
  expect(seriesCopy('book', 0).count).toBe('');
});

test('the Start button reads a book and listens to an audiobook, continuing where begun', () => {
  expect(seriesStart(book('a', 1))).toMatchObject({ label: 'Start reading', icon: 'book' });
  expect(seriesStart(book('a', 1, { readingFraction: 0.4 })).label).toBe('Continue reading');
  expect(seriesStart(listen('a', 1))).toMatchObject({ label: 'Start listening', icon: 'headphones' });
  expect(seriesStart(listen('a', 1, 600)).label).toBe('Continue listening');
  expect(seriesStart(listen('a', 1)).unavailable).toContain('Audiobooks');
});
