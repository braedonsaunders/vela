import { expect, test } from 'bun:test';
import { searchResultAnnouncement } from '../src/widgets/search/vocabulary';
import type { SearchView } from '../src/widgets/search/model';

const view = (state: SearchView['titles']['state'], items = 0): SearchView => ({
  query: 'rainy day',
  titles: { state, items: Array.from({ length: items }, (_, i) => ({ id: String(i) } as never)), channels: [], programmes: [] },
  descriptive: { state: 'off', items: [], canRetry: false },
  ai: { state: 'off', items: [] },
});

test('search result announcements describe progress and the settled count', () => {
  expect(searchResultAnnouncement(view('loading'))).toBe('Searching for rainy day');
  expect(searchResultAnnouncement(view('ready', 1))).toBe('1 result for rainy day');
  expect(searchResultAnnouncement(view('ready', 3))).toBe('3 results for rainy day');
});
