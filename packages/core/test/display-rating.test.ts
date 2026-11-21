import { expect, test } from 'bun:test';
import { displayRating } from '../src/discovery/models';

test("a certificate from another country than the viewer's names it", () => {
  expect(displayRating('gb/15', undefined, 'US')).toBe('UK 15');
  expect(displayRating('de/6', undefined, 'US')).toBe('DE 6');
  expect(displayRating('12A', 'GB', 'CA')).toBe('UK 12A');
  expect(displayRating('R', undefined, 'GB')).toBe('R');
});

test("the viewer's own country's certificate, or one of unknown origin, stands alone", () => {
  expect(displayRating('gb/15', undefined, 'GB')).toBe('15');
  expect(displayRating('PG-13', 'US', 'US')).toBe('PG-13');
  expect(displayRating('PG', undefined, '')).toBe('PG');
  expect(displayRating('usa/PG', undefined, 'US')).toBe('PG');
  expect(displayRating(' ', 'GB', 'US')).toBe('');
});

test('card facts wrap between facts, never inside the certificate or running time', async () => {
  const { factsLine } = await import('../src/discovery/models');
  expect(factsLine(['Feb 3, 2025', 'UK 15', '90 min'])).toBe('Feb 3, 2025 · UK\u00a015 · 90\u00a0min');
  expect(factsLine(['2012', '', '90 min'])).toBe('2012 · 90\u00a0min');
});
