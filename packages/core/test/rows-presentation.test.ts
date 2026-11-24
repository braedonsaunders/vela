// Ether's Recommendations wire as core reads it: a row's layout, card, role, personal, library and
// experience; unknown values as a standard shelf; plugin surface rows kept in page order, read by
// their plugin, surface and library (never their id); the retired style ignored.
import { expect, test } from 'bun:test';
import type * as V from '../src/wire';
import { feedRow, homeModel, isSurfaceRow } from '../src/discovery/models';

const title = (id: string): V.RowEntry => ({ id: `e-${id}`, kind: 'title', receiptToken: '', title: { id, kind: 'movie', name: id, artwork: [], genres: [] } as unknown as V.Title });
const row = (id: string, more: Partial<V.Row> & Record<string, unknown> = {}): V.Row =>
  ({ id, name: id, purpose: 'recommendation', receiptToken: id, continuation: 'exhausted', items: [title(`${id}-a`)], ...more }) as V.Row;

test('the presentation fields are read; only the ones sent are set', () => {
  const tracks = feedRow(row('quick', { layout: 'tracks', card: 'square', role: 'track', personal: true, library: 'music', experience: 'listen', presentation: 'ranked' }));
  expect(tracks).toMatchObject({ layout: 'tracks', card: 'square', role: 'track', personal: true, library: 'music', experience: 'listen', presentation: 'ranked' });
  const plain = feedRow(row('plain'));
  expect(plain).toMatchObject({ layout: 'standard', personal: false, presentation: '' });
  expect('card' in plain || 'role' in plain || 'library' in plain || 'experience' in plain).toBe(false);
  for (const layout of ['standard', 'hero', 'wide', 'tiles', 'tracks'] as const) expect(feedRow(row('r', { layout })).layout).toBe(layout);
  for (const card of ['poster', 'landscape', 'square', 'round'] as const) expect(feedRow(row('r', { card })).card).toBe(card);
});

test('unknown values draw as a standard shelf; the retired style is not read', () => {
  const odd = feedRow(row('odd', { layout: 'carousel', card: 'hexagon', experience: 'smell', role: 'hologram', purpose: 'mystery', presentation: 'stacked', style: 'landscape' } as never));
  expect(odd.layout).toBe('standard');
  expect(odd.card).toBeUndefined();
  expect(odd.experience).toBeUndefined();
  expect(odd.presentation).toBe('');
  // An unknown role is only information: kept, drawn as a standard shelf.
  expect(odd.role).toBe('hologram');
  expect(odd.purpose as string).toBe('mystery');
  expect('cardStyle' in odd).toBe(false);
});

test('surface rows keep their page order and are read by plugin, surface and library, never by their id', () => {
  const surface: V.SurfaceRow = { kind: 'surface', id: 'surface:sports:sports.tonight@movies', name: 'Sports Tonight', plugin: 'sports', surface: 'sports.tonight', library: 'movies' };
  expect(isSurfaceRow(surface)).toBe(true);
  expect(isSurfaceRow(row('x'))).toBe(false);
  expect(feedRow(surface)).toMatchObject({ id: 'surface:sports:sports.tonight@movies', name: 'Sports Tonight', plugin: 'sports', surface: 'sports.tonight', library: 'movies', items: [], layout: 'standard' });
  // An id that says something else is never taken over the fields.
  expect(feedRow({ ...surface, id: 'surface:other:other.row', library: undefined })).toMatchObject({ plugin: 'sports', surface: 'sports.tonight' });
  expect('library' in feedRow({ ...surface, library: undefined })).toBe(false);
  const home = homeModel({
    viewer: { id: 'v', name: 'V', policyRevision: '1' }, defaultSkinId: 'x',
    capabilities: { skins: [], features: { liveTV: { available: false }, aiSearch: { available: false }, descriptiveSearch: { available: false } } } as unknown as V.ServerCapabilities,
    rows: [row('continue', { purpose: 'continue' }), row('top10', { presentation: 'ranked' }), surface, row('empty', { items: [] }), row('drama')],
  });
  // In place, where the page put it; an empty feed row is still left out, the surface row is not.
  expect(home.rows.map(r => r.id)).toEqual(['continue', 'top10', 'surface:sports:sports.tonight@movies', 'drama']);
});
