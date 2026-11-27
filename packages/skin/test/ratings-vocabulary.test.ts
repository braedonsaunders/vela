import { expect, test } from 'bun:test';
import { detailModel } from '@vela/core';
import { detail as fixtureDetail } from '../../protocol/fixtures/catalogue';
import { accessor, collection, type Env } from '../src/vocabulary';

test('title ratings expose provider values, normalized scores and known states to a repeat', () => {
  const data = fixtureDetail('title-1-1')!;
  const detail = detailModel({ ...data, title: { ...data.title, ratings: [
    { source: 'tomatoes', kind: 'critic', value: 92, scale: 100, state: 'fresh' },
    { source: 'popcorn', kind: 'audience', value: 80, scale: 100 },
    { source: 'letterboxd', kind: 'audience', value: 4.5, scale: 5 },
    { source: 'tomatoes', kind: 'critic', value: 0, scale: 100, state: 'rotten' },
    { source: 'imdb', kind: 'audience', value: 11, scale: 10 },
  ] } });
  const env = { detail } as Env;
  const context = { index: 0 };
  const keys = ['source', 'label', 'value', 'score', 'state', 'icon', 'display', 'accessibleLabel', 'hasNext'];
  const items = collection('detail.ratings', context, env, 10);
  expect(items.map(item => keys.map(key => accessor(`rating.${key}`)!(item, env)))).toEqual([
    ['rt-critics', 'Tomatometer', '92%', '92', 'fresh', 'rating-tomato', '92%', 'Rotten Tomatoes 92 percent, fresh', 'true'],
    ['rt-audience', 'Audience', '80%', '80', '', 'rating-popcorn', '80%', 'Rotten Tomatoes audience 80 percent', 'true'],
    ['letterboxd', 'Letterboxd', '4.5', '90', '', '', 'Letterboxd 4.5', 'Letterboxd 4.5', 'true'],
    ['rt-critics', 'Tomatometer', '0%', '0', 'rotten', 'rating-splat', '0%', 'Rotten Tomatoes 0 percent, rotten', 'false'],
  ]);
  expect(accessor('detail.hasRatings')!(context, env)).toBe('true');
  const empty = { detail: detailModel(data) } as Env;
  expect(accessor('detail.hasRatings')!(context, empty)).toBe('false');
  expect(accessor('detail.hasRatings')!(context, {} as Env)).toBe('false');
  expect(collection('detail.ratings', context, empty, 10)).toEqual([]);
});
