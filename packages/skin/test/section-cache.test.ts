import { expect, test } from 'bun:test';
import { trimSectionCache } from '../../../apps/vela/src/section-cache';

test('Home remains mounted for immediate search while old libraries are released', () => {
  const home = {};
  const cache = new Map([['home:home', home], ['library:movies', {}], ['live:live', {}]]);
  trimSectionCache(cache, 'live:live');
  expect([...cache.keys()]).toEqual(['home:home', 'live:live']);
  expect(cache.get('home:home')).toBe(home);
});

test('releases previously visited scenes while preserving both transition participants', () => {
  const cache = new Map([['home', {}], ['movies', {}], ['shows', {}], ['live', {}]]);
  const live = cache.get('live');
  trimSectionCache(cache, 'live', 'shows');
  expect([...cache.keys()]).toEqual(['shows', 'live']);
  expect(cache.get('live')).toBe(live);
  trimSectionCache(cache, 'live');
  expect([...cache.keys()]).toEqual(['live']);
});

test('does not retain a scene solely because it was the previous outgoing scene', () => {
  const cache = new Map([['home', 1], ['movies', 2], ['live', 3]]);
  trimSectionCache(cache, 'home', 'movies');
  cache.set('live', 4);
  trimSectionCache(cache, 'live', 'home');
  expect([...cache.keys()]).toEqual(['home', 'live']);
});
