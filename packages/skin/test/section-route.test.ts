import { expect, test } from 'bun:test';
import { sectionRoute, sectionPathVisible, sectionIsActive } from '../../../apps/vela/src/section-route';

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

test('a modal releases retained section activity on touch devices and TV', () => {
  for (const path of ['/', '/live', '/library/movies', '/library/a%20b']) expect(sectionPathVisible(path)).toBe(true);
  for (const path of ['/watch/channel', '/title/movie', '/person', '/connect', '/sign-in']) expect(sectionPathVisible(path)).toBe(false);
});

test('direct touch sections follow their path while TV retains native focus gating', () => {
  expect(sectionIsActive('/', false, false)).toBe(true);
  expect(sectionIsActive('/live', false, false)).toBe(true);
  expect(sectionIsActive('/watch/channel', true, false)).toBe(false);
  expect(sectionIsActive('/', false, true)).toBe(false);
  expect(sectionIsActive('/', true, true)).toBe(true);
  expect(sectionIsActive('/watch/channel', true, true)).toBe(false);
});
