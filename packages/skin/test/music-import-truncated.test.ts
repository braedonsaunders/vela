// A partly read playlist says how much was shared, with the real size when the source gives it.
import { expect, test } from 'bun:test';
import { importTruncatedNote } from '../src/blocks/import-note';

test('Spotify (no size): only the shared count', () => {
  expect(importTruncatedNote({ total: 100 })).toContain('first 100 tracks');
});

test('Deezer or the 500 cap (size known): shared of total', () => {
  expect(importTruncatedNote({ total: 500, sourceTotal: 812 })).toContain('first 500 of 812');
});
