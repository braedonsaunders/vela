import { expect, test } from 'bun:test';
import { matchesLibrarySearch } from '../library-search';

test('tab search matches word prefixes, case and diacritics without substring matches', () => {
  expect(matchesLibrarySearch('Jo Example', 'jo')).toBe(true);
  expect(matchesLibrarySearch('Mary Jones', 'jo')).toBe(true);
  expect(matchesLibrarySearch('José Álvarez', ' JO al ')).toBe(true);
  expect(matchesLibrarySearch('Banjo Studio', 'jo')).toBe(false);
  expect(matchesLibrarySearch('Any Studio', '')).toBe(true);
});
