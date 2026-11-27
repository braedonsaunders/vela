import { expect, test } from 'bun:test';
import { sectionBack, sectionRoute, sectionPathVisible, sectionIsActive } from '../../../apps/vela/src/section-route';

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
  for (const path of ['/', '/live', '/library/movies', '/library/a%20b', '/screen/sports', '/screen/news/']) expect(sectionPathVisible(path)).toBe(true);
  for (const path of ['/watch/channel', '/title/movie', '/person', '/connect', '/sign-in', '/screen/sports/game', '/screen/news/front']) expect(sectionPathVisible(path)).toBe(false);
});

test('direct touch sections follow their path while TV retains native focus gating', () => {
  expect(sectionIsActive('/', false, false)).toBe(true);
  expect(sectionIsActive('/live', false, false)).toBe(true);
  expect(sectionIsActive('/watch/channel', true, false)).toBe(false);
  expect(sectionIsActive('/', false, true)).toBe(false);
  expect(sectionIsActive('/', true, true)).toBe(true);
  expect(sectionIsActive('/watch/channel', true, true)).toBe(false);
});

test("tvOS Menu from a section goes back inside it, then Home, and Home leaves the app", () => {
  const home = { name: 'index' };
  const movies = { name: 'library/[id]', params: { id: 'movies' } };
  const music = { name: 'library/[id]', params: { id: 'music' } };
  const album = { name: 'library/[id]', params: { id: 'music', m: 'album:1' } };
  expect(sectionBack([home], 0)).toBeNull();
  expect(sectionBack([home, movies], 1)).toBe('home');
  expect(sectionBack([home, music, album], 2)).toBe('back');
  expect(sectionBack([home, music, album], 1)).toBe('home');
  // Reached through other sections (Live, then Music): Menu on Music's root is Home, not Live.
  expect(sectionBack([home, { name: 'live' }, music], 2)).toBe('home');
  expect(sectionBack([home, { name: 'live' }], 1)).toBe('home');
  // Opened without Home under it (a deep link): Home too.
  expect(sectionBack([movies], 0)).toBe('home');
  expect(sectionBack([{ name: 'screen/[id]', params: { id: 'sports' } }], 0)).toBe('home');
  // A navigator that reports no usable route takes no part.
  expect(sectionBack([], 0)).toBeNull();
});
