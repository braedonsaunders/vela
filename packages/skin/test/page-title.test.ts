import { expect, test } from 'bun:test';
import { pageTitle } from '../../../apps/vela/src/page-title';

const state = {
  libraries: { load: 'ready', value: [{ id: 'movies', name: 'Movies' }] },
  titles: { 'film-1': { load: 'ready', value: { title: [{ name: 'The Last Observatory' }] } } },
  collections: { picks: { load: 'ready', value: { name: 'Staff picks' } } },
  rows: { 'row-1': { load: 'ready', value: { name: 'Beyond the horizon' } } },
} as never;

test('each route names what is on show, then the server', () => {
  expect(pageTitle('/', '', state, 'Vela Studio')).toBe('Vela Studio');
  expect(pageTitle('/library/movies', '', state, 'Vela Studio')).toBe('Movies – Vela Studio');
  expect(pageTitle('/title/film-1', '?library=movies', state, 'Vela Studio')).toBe('The Last Observatory – Vela Studio');
  expect(pageTitle('/collection/picks', '', state, 'Vela Studio')).toBe('Staff picks – Vela Studio');
  expect(pageTitle('/row/row-1', '', state, 'Vela Studio')).toBe('Beyond the horizon – Vela Studio');
  expect(pageTitle('/search', '?q=orbit', state, 'Vela Studio')).toBe('Search: orbit – Vela Studio');
  expect(pageTitle('/live', '', state, 'Vela Studio')).toBe('Live TV – Vela Studio');
  expect(pageTitle('/', '', { ...(state as object), search: { query: 'comet' } } as never, 'Vela Studio')).toBe('Search: comet – Vela Studio');
  expect(pageTitle('/multiview', '', state, 'Vela Studio')).toBe('Multiview – Vela Studio');
  expect(pageTitle('/read/film-1', '', state, 'Vela Studio')).toBe('The Last Observatory – Vela Studio');
  expect(pageTitle('/game/nhl-1', '', state, 'Vela Studio')).toBe('Vela Studio');
  expect(pageTitle('/nowhere', '', state, 'Vela Studio')).toBe('Page not found – Vela Studio');
});

test('a page still loading shows the server name alone', () => {
  expect(pageTitle('/title/unknown', '', state, 'Vela Studio')).toBe('Vela Studio');
});
