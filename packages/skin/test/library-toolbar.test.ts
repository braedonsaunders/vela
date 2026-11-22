import { describe, expect, test } from 'bun:test';
import type { LibraryModel } from '@vela/core';
import { activeFilters, clearFiltersArg, hasFilterControls, lockedFacet, toolbarTabs, tabSearchEnabled } from '../src/widgets/library/toolbar-model';
import type { LibraryPage } from '../src/widgets/library/model';

test('toolbar preserves declared order and labels and does not invent explicitly absent tabs', () => {
  const page = { model: { tabs: [{ id: 'studio', label: 'Our Studios', kind: 'collections' }, { id: 'cast', label: 'Performers', kind: 'people' }] } } as LibraryPage;
  expect(toolbarTabs(page).map(tab => [tab.id, tab.label])).toEqual([['studio', 'Our Studios'], ['cast', 'Performers']]);
  expect(toolbarTabs({ model: { tabs: [] } } as unknown as LibraryPage)).toEqual([]);
});
test('legacy genres require choices and collection tabs require server support', () => {
  expect(toolbarTabs(undefined).map(tab => tab.id)).toEqual(['library']);
  const page = { canRecommend: true, extras: { collectionsAvailable: true, genres: [{ id: 'drama', label: 'Drama' }] } } as LibraryPage;
  expect(toolbarTabs(page).map(tab => tab.id)).toEqual(['recommended', 'library', 'collections', 'genres']);
});
test('collection and people search defaults can be overridden by the server', () => {
  for (const kind of ['collections', 'people']) {
    expect(tabSearchEnabled({ kind })).toBe(true);
    expect(tabSearchEnabled({ kind, search: false })).toBe(false);
  }
  for (const kind of ['recommended', 'library']) expect(tabSearchEnabled({ kind })).toBe(false);
  expect(tabSearchEnabled(undefined)).toBe(false);
});

test('toolbar dimensions come from validated skin look tokens', async () => {
  const { resolveUi, withUi } = await import('../src/resolve/ui');
  const ui = resolveUi({ controlHeight: 44, controlFontSize: 16, radiusControl: 12 });
  expect(withUi('$ui.controlHeight $ui.controlFontSize $ui.radiusControl', ui)).toBe('44px 16px 12px');
  for (const controlHeight of [0, -1, 161, NaN]) expect(() => resolveUi({ controlHeight })).toThrow();
});

describe('filters in force', () => {
  const model = (over: Partial<LibraryModel> = {}) => ({
    id: 'books', canSearch: true, facets: [{ id: 'authors', label: 'Authors', multi: true }, { id: 'series', label: 'Series' }],
    facetFilters: {}, kinds: [{ id: 'movie', label: 'Films' }, { id: 'show', label: 'Series' }], kindFilter: '', playedFilter: '', favoriteFilter: false,
    genres: [{ id: 'drama', label: 'Drama' }], genreFilter: '', yearFilter: 0, canYear: true, canPlayed: true, canFavorite: true, sorts: [],
    ...over,
  }) as unknown as LibraryModel;

  test('none in force: no chips, nothing to clear', () => {
    expect(activeFilters(model())).toEqual([]);
  });

  test('each filter is a chip whose arg removes only it', () => {
    const chips = activeFilters(model({ facetFilters: { authors: ['a1', 'a2'] }, kindFilter: 'show', playedFilter: 'false', favoriteFilter: true, genreFilter: 'drama', yearFilter: 1999 }), { authors: { a1: 'Ann' } });
    expect(chips.map(chip => [chip.label, chip.arg])).toEqual([
      ['Ann', 'facets|{"authors":["a2"]}'],
      ['a2', 'facets|{"authors":["a1"]}'],
      ['Series', 'kind|'],
      ['Unwatched', 'played|'],
      ['Favourites', 'favorite|'],
      ['Drama', 'genre|'],
      ['1999', 'year|'],
    ]);
  });

  test('removing a facet\'s last value drops the facet', () => {
    expect(activeFilters(model({ facetFilters: { series: ['s1'] } }))[0]!.arg).toBe('facets|{}');
  });

  test('an opened facet collection\'s own facet is neither a chip nor cleared', () => {
    const page = { facetTitle: 'Ann · 12 titles', tabId: 'authors-tab', model: model({ tabs: [{ id: 'authors-tab', kind: 'collections', label: 'Authors', facet: 'authors' }], facetFilters: { authors: ['a1'], series: ['s1'] } } as Partial<LibraryModel>) } as unknown as LibraryPage;
    const locked = lockedFacet(page);
    expect(locked).toBe('authors');
    expect(activeFilters(page.model, {}, locked).map(chip => chip.key)).toEqual(['facet:series:s1']);
    expect(clearFiltersArg(page.model, locked)).toBe('clear|{"authors":["a1"]}');
    expect(clearFiltersArg(page.model)).toBe('clear|{}');
    expect(lockedFacet({ ...page, facetTitle: undefined } as LibraryPage)).toBeUndefined();
  });

  test('the Filters button shows only when there is something to filter by', () => {
    expect(hasFilterControls(model())).toBe(true);
    const bare = model({ facets: [], kinds: [], genres: [], canYear: false, canPlayed: false, canFavorite: false });
    expect(hasFilterControls(bare)).toBe(false);
    expect(hasFilterControls({ ...bare, facets: [{ id: 'authors', label: 'Authors' }] } as LibraryModel, 'authors')).toBe(false);
  });
});
