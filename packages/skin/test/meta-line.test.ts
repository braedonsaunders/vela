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
