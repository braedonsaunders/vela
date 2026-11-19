import { expect, test } from 'bun:test';
import { sectionRoute } from '../../../apps/vela/src/section-route';

test('section selection follows the active navigator route when returning to Home', () => {
  expect(sectionRoute('library/[id]', 'movies')).toEqual({ route: 'library', entry: 'movies' });
  expect(sectionRoute('index', 'movies')).toEqual({ route: 'home', entry: 'home' });
  expect(sectionRoute('live', undefined)).toEqual({ route: 'live', entry: 'live' });
});

test('incomplete or unrelated routes cannot select a bogus library section', () => {
  expect(sectionRoute('library/[id]', undefined)).toBeNull();
  expect(sectionRoute('library/[id]', ['movies'])).toBeNull();
  expect(sectionRoute('library/[id]', '')).toBeNull();
  expect(sectionRoute('title/[id]', 'movie')).toBeNull();
  expect(sectionRoute(undefined, undefined)).toBeNull();
});
