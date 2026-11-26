// A series: its reading (or listening) order, the words it is described in, and whether its
// Start button can lead anywhere. A series of books reads, a series of audiobooks listens, and
// a series that mixes them is described neutrally as titles.
import { msg, number, type Card } from '@vela/core';

/**
 * Numbered entries first in their order, unnumbered ones after them; ties (and every unnumbered
 * entry) keep the server's order. A missing number is 0 on the card, never "Book 0".
 */
export function seriesOrder(books: readonly Card[]): Card[] {
  const at = (book: Card) => book.media?.index || Number.POSITIVE_INFINITY;
  return books
    .map((book, i) => ({ book, i, index: at(book) }))
    .sort((a, b) => (a.index === b.index ? 0 : a.index < b.index ? -1 : 1) || a.i - b.i)
    .map(entry => entry.book);
}

export type SeriesKind = 'book' | 'audiobook' | 'mixed';

/** What the series holds, from its entries (or the series' own class before they load). */
export function seriesKind(entries: readonly Card[], series?: Card): SeriesKind {
  const classes = new Set(entries.map(entry => (entry.media?.class === 'audiobook' ? 'audiobook' : 'book')));
  if (classes.size > 1) return 'mixed';
  if (classes.size === 1) return classes.has('audiobook') ? 'audiobook' : 'book';
  return series?.media?.class === 'audiobook' ? 'audiobook' : 'book';
}

export interface SeriesCopy {
  /** "6 books", "6 audiobooks", "6 titles" ('' for none). */
  count: string;
  /** The grid's heading. */
  heading: string;
}

export function seriesCopy(kind: SeriesKind, count: number): SeriesCopy {
  const noun = kind === 'audiobook' ? 'audiobooks' : kind === 'mixed' ? 'titles' : 'books';
  return {
    count: count > 0 ? msg(`media.count.${noun}.${count === 1 ? 'one' : 'other'}`, { count: number(count) }) : '',
    heading: msg(`media.ui.${noun}`),
  };
}

/** The Start button for the series' next entry: listening for an audiobook, reading otherwise. */
export function seriesStart(next: Card): { label: string; icon: 'book' | 'headphones'; unavailable: string } {
  if (next.media?.class === 'audiobook') {
    const begun = next.progressSeconds > 0 && !next.played;
    return { label: msg(begun ? 'media.ui.continueListening' : 'media.ui.startListening'), icon: 'headphones', unavailable: msg('media.ui.cannotListen') };
  }
  const begun = (next.media?.readingFraction ?? 0) > 0;
  return { label: msg(begun ? 'media.ui.continueReading' : 'media.ui.startReading'), icon: 'book', unavailable: msg('media.ui.cannotRead') };
}

/**
 * The series' next entry can be started: a book only where this server reads its format (the
 * same feature that enables a book page's Read), an audiobook only where it plays audio.
 */
export function seriesCanStart(next: Card | undefined, features: { reading: readonly string[]; audio: boolean }): boolean {
  if (!next) return false;
  const media = next.media;
  if (media?.class === 'audiobook') return features.audio;
  if (media?.class !== 'book') return true;
  return !!media.readingFormat && features.reading.includes(media.readingFormat);
}

export const READ_SERIES_PRIMARY = 'read-series-primary';

/** A TV can open book details, and reading progress identifies the book to return to. */
export function tvSeriesBook(ordered: readonly Card[]): Card | undefined {
  return ordered.find(book => {
    const progress = book.media?.readingFraction ?? 0;
    return book.media?.class === 'book' && !book.played && progress > 0 && progress < 0.98;
  }) ?? ordered[0];
}
