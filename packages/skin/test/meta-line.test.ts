import { expect, test } from 'bun:test';
import { joinMeta } from '../src/meta-line';

test('keeps the separator with the adjacent words and lets other spaces wrap', () => {
  expect(joinMeta(['Scrubs', 'Season 1', 'Episode 2']))
    .toBe('Scrubs\u00a0·\u00a0Season 1\u00a0·\u00a0Episode 2');
});

test('omits missing parts and keeps separators in prejoined facts together', () => {
  expect(joinMeta(['', null, undefined])).toBe('');
  expect(joinMeta(['Scrubs', '', undefined])).toBe('Scrubs');
  expect(joinMeta(['2026 · TV-14 · 21\u00a0min', '', 'Comedy']))
    .toBe('2026\u00a0·\u00a0TV-14\u00a0·\u00a021\u00a0min\u00a0·\u00a0Comedy');
});

test('phone card facts break after a separator, never inside a running time or the certificate', async () => {
  const { VOCABULARY } = await import('../src/vocabulary');
  const { SEARCH_VOCABULARY } = await import('../src/widgets/search/vocabulary');
  const { factsLine } = await import('../../core/src/discovery/models');
  const card = { facts: factsLine(['2026', 'TV-14', '90 min']), rating: 'TV-14', yearLabel: '2026', durationLabel: '90 min' };
  const ctx = (results: number) => ({ index: 0, card, searchSection: { results: Array.from({ length: results }) } }) as never;
  const phone = { small: true, tv: false } as never;
  // Ordinary spaces are the break opportunities: one after each dot; a word joiner holds "TV-14".
  const lines = (text: string) => text.split(' ');
  expect(lines(VOCABULARY['card.facts']!(ctx(0), phone))).toEqual(['2026 ·', 'TV-⁠14 ·', '90 min']);
  expect(lines(SEARCH_VOCABULARY['search.cardFacts']!(ctx(1), phone))).toEqual(['2026 ·', 'TV-⁠14 ·', '90 min']);
  expect(lines(SEARCH_VOCABULARY['search.cardFacts']!(ctx(3), phone))).toEqual(['2026 ·', '90 min']);
});

test('wider and TV card facts stay one joined line', async () => {
  const { VOCABULARY } = await import('../src/vocabulary');
  const { SEARCH_VOCABULARY } = await import('../src/widgets/search/vocabulary');
  const { factsLine } = await import('../../core/src/discovery/models');
  const card = { facts: factsLine(['2026', 'TV-14', '90 min']), rating: 'TV-14', yearLabel: '2026', durationLabel: '90 min' };
  const ctx = (results: number) => ({ index: 0, card, searchSection: { results: Array.from({ length: results }) } }) as never;
  for (const env of [{ small: false, tv: false }, { small: false, tv: true }, { small: true, tv: true }] as never[]) {
    expect(VOCABULARY['card.facts']!(ctx(0), env)).toBe(joinMeta([card.facts]));
    expect(SEARCH_VOCABULARY['search.cardFacts']!(ctx(1), env)).toBe(joinMeta([card.facts]));
  }
  expect(SEARCH_VOCABULARY['search.cardFacts']!(ctx(3), { small: true, tv: true } as never)).toBe(joinMeta(['2026', '90 min']));
  expect(SEARCH_VOCABULARY['search.cardFacts']!(ctx(3), { small: false, tv: false } as never)).toBe(joinMeta([card.facts]));
});

test('card facts keep only running times and the certificate whole', async () => {
  const { cardFacts } = await import('../src/meta-line');
  // A track names its album, a part its book: those words still wrap, and so do counts.
  expect(cardFacts(['Kind of Blue · 9:22'])).toBe('Kind of Blue · 9:22');
  expect(cardFacts(['24 Hours · 9:22'])).toBe('24 Hours · 9:22');
  expect(cardFacts(['1989 Deluxe · 3:51'])).toBe('1989 Deluxe · 3:51');
  expect(cardFacts(['2012 · 12 tracks'])).toBe('2012 · 12 tracks');
  // Running times as the core writes them, in any digits, stay whole.
  expect(cardFacts(['2012 · 90 min'])).toBe('2012 · 90 min');
  expect(cardFacts(['2012 · 1 h 29 min'])).toBe('2012 · 1 h 29 min');
  expect(cardFacts(['2012 · 2 h'])).toBe('2012 · 2 h');
  expect(cardFacts(['٢٠١٢ · ٩٠ min'])).toBe('٢٠١٢ · ٩٠ min');
  expect(cardFacts(['The Long Way Home · Part 3 · 9 h 41 min'])).toBe('The Long Way Home · Part 3 · 9 h 41 min');
  expect(cardFacts(['Jan 2, 2025 · TV-14 · 3 min'], 'TV-14')).toBe('Jan 2, 2025 · TV-⁠14 · 3 min');
  // Only the certificate's hyphen is held: an ISO date keeps its break opportunities.
  expect(cardFacts(['2025-01-02 · PG-13 · 90 min'], 'PG-13')).toBe('2025-01-02 · PG-⁠13 · 90 min');
  expect(cardFacts(['2025-01-02 · 90 min'])).toBe('2025-01-02 · 90 min');
});
