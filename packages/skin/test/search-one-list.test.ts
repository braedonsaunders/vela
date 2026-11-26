import { expect, test } from 'bun:test';
import { searchCollection, SEARCH_VOCABULARY } from '../src/widgets/search/vocabulary';
import { searchView } from '../src/widgets/search/view';
import { initialSearch, type SearchState } from '../../core/src/store/search';
import type { Card } from '../../core/src/models';
import type { Ctx, Env } from '../src/vocabulary';

const card = (id: string, name = id) => ({ id, name }) as Card;
const c = { index: 0 } as Ctx;
const read = (env: Env, key: string) => SEARCH_VOCABULARY[key]!(c, env);
const env = (query: string, fast: Partial<SearchState['fast']>, descriptive: Partial<SearchState['descriptive']>): Env =>
  ({ search: searchView({
    ...initialSearch,
    query,
    fast: { ...initialSearch.fast, ...fast },
    descriptive: { ...initialSearch.descriptive, ...descriptive },
  }) }) as Env;

test('titles found: one list of them, and the description lane draws nothing', () => {
  const e = env('James Bond', { status: 'ready', items: [card('dn', 'Dr. No')] }, { status: 'ready', items: [card('x')] });
  expect(read(e, 'env.search')).toBe('ready');
  expect(searchCollection('search.titles', c, e, 50)!.map(x => x.card?.id)).toEqual(['dn']);
  expect(read(e, 'search.descriptiveCount')).toBe('0');
  expect(read(e, 'search.descriptiveState')).toBe('off');
  expect(read(e, 'search.describing')).toBe('false');
});

test('the description fallback fills the same list, saying so, and pages from its own lane', () => {
  const waiting = env('rififi heist', { status: 'ready' }, { status: 'loading' });
  expect(read(waiting, 'env.search')).toBe('loading');
  expect(read(waiting, 'search.titleCount')).toBe('0');
  const e = env('rififi heist', { status: 'ready' }, { status: 'ready', items: [card('r')], nextCursor: 'p2' });
  expect(read(e, 'env.search')).toBe('ready');
  expect(searchCollection('search.titles', c, e, 50)!.map(x => x.card?.id)).toEqual(['r']);
  expect(searchCollection('search.descriptive', c, e, 50)).toEqual([]);
  expect(read(e, 'search.describing')).toBe('true');
  expect(read(e, 'search.moreFast')).toBe('true');
  expect(read(e, 'search.moreDescriptive')).toBe('false');
  expect(read(e, 'search.announcement')).toBe('1 result for rififi heist');
});

test('a failed fallback offers a retry once the server allows it', () => {
  const e = env('films about grief', { status: 'ready' }, { status: 'failed', canRetry: true });
  expect(read(e, 'env.search')).toBe('ready');
  expect(read(e, 'search.descriptiveState')).toBe('failed');
  expect(read(e, 'search.canRetry')).toBe('true');
  expect(read(e, 'search.describing')).toBe('true');
});

test('phone search groups fill a two-result row and use three columns for longer lists', () => {
  const e = env('observatory', {}, {});
  const results = ['one', 'two', 'three'].map(id => ({ ref: id, card: card(id), viewer: 'v', policy: 'p' }));
  const columns = (count: number) => SEARCH_VOCABULARY['search.phoneColumns']!({
    ...c,
    searchSection: { id: 'server', name: 'Server', status: 'ready', results: results.slice(0, count) },
  }, e);
  expect(columns(2)).toBe('2');
  expect(columns(3)).toBe('3');
});
