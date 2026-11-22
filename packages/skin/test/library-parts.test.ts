import { expect, test } from 'bun:test';
import { libraryExtras, type Part } from '../../../apps/vela/src/browse/library-parts';
import type { Choice, CollectionPage, Row } from '@vela/core';

const rows: Part<Row[]> = { key: 'movies', load: 'ready', attempt: 0, value: [{ id: 'r', name: 'Recently added', items: [] } as unknown as Row] };
const loadingCollections: Part<CollectionPage> = { key: 'movies', load: 'loading', attempt: 0 };
const failedCollections: Part<CollectionPage> = { key: 'movies', load: 'failed', attempt: 0 };
const genres: Part<Choice[]> = { key: 'movies', load: 'ready', attempt: 0, value: [{ id: 'g', label: 'Drama' }] };

test('Recommended shows its rows while collections are still loading or have failed', () => {
  for (const collections of [undefined, loadingCollections, failedCollections]) {
    const extras = libraryExtras('recommended', rows, collections);
    expect(extras.rowsLoad).toBe('ready');
    expect(extras.rows.map(row => row.name)).toEqual(['Recently added']);
    expect(extras.failed).toBe(false);
  }
});

test('only the part a view shows can fail it', () => {
  expect(libraryExtras('collections', rows, failedCollections).failed).toBe(true);
  expect(libraryExtras('people', rows, failedCollections).failed).toBe(true);
  expect(libraryExtras('recommended', { ...rows, load: 'failed', value: undefined }, loadingCollections).failed).toBe(true);
  expect(libraryExtras('genres', rows, failedCollections, genres).failed).toBe(false);
  expect(libraryExtras('library', { ...rows, load: 'failed' }, failedCollections).failed).toBe(false);
});

test('a part not read yet is idle, not empty-and-ready', () => {
  const extras = libraryExtras('collections', rows);
  expect(extras.collectionsLoad).toBe('idle');
  expect(extras.genresLoad).toBe('idle');
  expect(extras.collections).toEqual([]);
  expect(extras.collectionsAvailable).toBe(true);
  const page = libraryExtras('collections', rows, { key: 'movies', load: 'ready', attempt: 0, value: { items: [{ id: 'c' } as never], cursor: 'next' } });
  expect(page.collectionsLoad).toBe('ready');
  expect(page.collectionCursor).toBe('next');
});
