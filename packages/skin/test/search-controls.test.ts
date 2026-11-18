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
