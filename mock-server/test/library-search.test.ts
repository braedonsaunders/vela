import { expect, test } from 'bun:test';
import { librarySortTitle, matchesLibrarySearch } from '../library-search';

test('tab search matches word prefixes, case and diacritics without substring matches', () => {
  expect(matchesLibrarySearch('Jo Example', 'jo')).toBe(true);
  expect(matchesLibrarySearch('Mary Jones', 'jo')).toBe(true);
  expect(matchesLibrarySearch('José Álvarez', ' JO al ')).toBe(true);
  expect(matchesLibrarySearch('Banjo Studio', 'jo')).toBe(false);
  expect(matchesLibrarySearch('Any Studio', '')).toBe(true);
});

test('title sort ignores leading punctuation and articles', () => {
  const names = ['"Pimpernel" Smith', '#Alive', 'The Matrix', 'A Bug\'s Life', 'Alien', '"Sr."', 'Zodiac', '#1 Cheerleader Camp', 'Theatre'];
  const sorted = [...names].sort((a, b) => librarySortTitle(a).localeCompare(librarySortTitle(b), 'en', { numeric: true }));
  expect(sorted).toEqual(['#1 Cheerleader Camp', 'Alien', '#Alive', 'A Bug\'s Life', 'The Matrix', '"Pimpernel" Smith', '"Sr."', 'Theatre', 'Zodiac']);
  expect(librarySortTitle('...')).toBe('...');
});
