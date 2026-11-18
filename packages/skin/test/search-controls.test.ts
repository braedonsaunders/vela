import { expect, test } from 'bun:test';
import { searchCollection, SEARCH_VOCABULARY } from '../src/widgets/search/vocabulary';
import { searchView } from '../src/widgets/search/view';
import { initialSearch } from '../../core/src/store/search';
import type { Env, Ctx } from '../src/vocabulary';

test('server kinds and sorts preserve labels, order and unknown plugin IDs', () => {
  const env = { search: searchView({ ...initialSearch, query: 'portal', kind: 'game', searchKinds: [{ id: 'game', label: 'Video games' }, { id: 'custom_kind' }], searchSorts: [{ id: 'play_time', label: 'Play time', directions: ['desc'] }] }) } as Env;
  const c = { index: 0 } as Ctx;
  const kinds = searchCollection('search.kinds', c, env, 50)!;
  expect(kinds.map(c => c.opt?.label)).toEqual(['All', 'Video games', 'Custom Kind']);
  expect(SEARCH_VOCABULARY['search.kindOn'](kinds[1], env)).toBe('true');
  expect(searchCollection('search.sorts', c, env, 50)!.map(c => c.opt?.id)).toEqual(['play_time']);
  env.search!.controls = undefined;
  expect(SEARCH_VOCABULARY['search.kindCount'](c, env)).toBe('0');
  expect(SEARCH_VOCABULARY['search.sortCount'](c, env)).toBe('0');
});


test('library control gates on capability and count and preserves server order', () => {
  const env = { libraries: [{ id: 'z', name: 'Z movies' }, { id: 'a', name: 'A shows' }], search: searchView({ ...initialSearch, query: 'heat', searchLibraries: true, library: 'a' }) } as Env;
  const c = { index: 0 } as Ctx;
  expect(SEARCH_VOCABULARY['search.libraryCount'](c, env)).toBe('2');
  expect(SEARCH_VOCABULARY['search.library'](c, env)).toBe('a');
  expect(searchCollection('search.libraries', c, env, 50)!.map(c => c.opt)).toEqual([
    { id: '', label: 'All libraries', of: 'kind' }, { id: 'z', label: 'Z movies', of: 'kind' }, { id: 'a', label: 'A shows', of: 'kind' },
  ]);
  env.libraries = env.libraries!.slice(0, 1);
  expect(SEARCH_VOCABULARY['search.libraryCount'](c, env)).toBe('1');
  env.search!.controls!.searchLibraries = false;
  expect(SEARCH_VOCABULARY['search.libraryCount'](c, env)).toBe('0');
  expect(searchCollection('search.libraries', c, env, 50)).toEqual([]);
});

test('an empty answer under a kind or library restriction is about the filters, not the words', () => {
  const c = { index: 0 } as Ctx;
  const kinds = [{ id: 'movie', label: 'Movies' }, { id: 'adult/scene', label: 'Adult' }];
  const env = { search: searchView({ ...initialSearch, query: 'late night drive', searchKinds: kinds, kind: 'adult/scene' }) } as Env;
  expect(SEARCH_VOCABULARY['search.filtered'](c, env)).toBe('true');
  env.search = searchView({ ...initialSearch, query: 'late night drive', searchKinds: kinds });
  expect(SEARCH_VOCABULARY['search.filtered'](c, env)).toBe('false');
  env.search = searchView({ ...initialSearch, query: 'heat', searchLibraries: true, library: 'z' });
  expect(SEARCH_VOCABULARY['search.filtered'](c, env)).toBe('true');
});
