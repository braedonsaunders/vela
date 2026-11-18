import { expect, test } from 'bun:test';
import { libraryCardArtwork, libraryCard, libraryCardRatio, libraryTabs } from '../src/library-presentation';
import { libraryKey } from '../src/store/catalogue';
import { libraryBrowseQuery } from '../src/adapter/ether';

test('library facets repeat within a field and retain independent fields and search', () => {
  const q = new URLSearchParams(libraryBrowseQuery({ query: 'game & art', facets: { topic: ['a/b', 'c', 'c'], creator: ['two'] } }));
  expect(q.getAll('facet.topic')).toEqual(['a/b', 'c']);
  expect(q.getAll('facet.creator')).toEqual(['two']);
  expect(q.get('query')).toBe('game & art');
  expect(q.has('facets')).toBe(false);
});
test('cache identity includes search and facet OR sets independent of order', () => {
  expect(libraryKey('a', { facets: { x: ['2', '1'], y: ['a'] } })).toBe(libraryKey('a', { facets: { y: ['a'], x: ['1', '2', '2'] } }));
  expect(libraryKey('a', { query: 'one' })).not.toBe(libraryKey('a', { query: 'two' }));
});
test('tabs preserve labels, identity and order, skipping unknown kinds', () => {
  expect(libraryTabs(undefined)).toBeUndefined();
  expect(libraryTabs([])).toEqual([]);
  const tabs = [{ id: 'custom', label: 'Videos', kind: 'library' }, { id: 'future', label: '?', kind: 'future' }, { id: 'for-you', label: 'For you', kind: 'recommended' }];
  expect(libraryTabs(tabs as any)?.map(t => [t.id, t.label])).toEqual([['custom', 'Videos'], ['for-you', 'For you']]);
});
test('unknown presentation safely uses posters', () => {
  expect(libraryCard('future')).toBe('poster');
  expect(libraryCardRatio(undefined)).toBe('2 / 3');
  expect(libraryCardRatio('landscape')).toBe('16 / 9');
  expect(libraryCardRatio('square')).toBe('1 / 1');
});

test('library search and facets require an adapter operation and a server declaration', async () => {
  const { supportsLibraryBrowse } = await import('../src/adapter/capabilities');
  const { libraries } = await import('../../protocol/fixtures/libraries');
  const declared = { ...libraries[0]!, tabs: [{ id: 'browse', label: 'Browse', kind: 'library' as const }] };
  expect(supportsLibraryBrowse({} as any, declared)).toBe(false);
  const api = { libraryFacets() {} } as any;
  expect(supportsLibraryBrowse(api, declared)).toBe(true);
  expect(supportsLibraryBrowse(api, { ...declared, tabs: undefined, browse: { ...declared.browse, filters: {} } })).toBe(false);
});

test('thumb-only plugin artwork remains available to landscape card rendering', async () => {
  const { entry } = await import('../src/discovery/models');
  const model = entry({ id: 'plugin', receiptToken: '', kind: 'directory', targetId: 'plugin', name: 'Video', artwork: [{ id: 'art', kind: 'thumb', tag: '', sizes: [{ width: 1600, height: 900, url: 'https://example.test/thumb.jpg' }] }] });
  expect(model.backdrop).toBe('https://example.test/thumb.jpg');
});

test('landscape art prefers thumb, then backdrop, then poster; square retains poster', () => {
  const art = { poster: 'poster', backdrop: 'backdrop', thumbnail: 'thumb' } as any;
  expect(libraryCardArtwork(art, 'landscape').poster).toBe('thumb');
  expect(libraryCardArtwork({ ...art, thumbnail: '' }, 'landscape').poster).toBe('backdrop');
  expect(libraryCardArtwork({ ...art, thumbnail: '', backdrop: '' }, 'landscape').poster).toBe('poster');
  expect(libraryCardArtwork(art, 'square').poster).toBe('poster');
  expect(libraryCardArtwork(art, 'unknown').poster).toBe('poster');
});

test('facet collection IDs preserve opaque values and reject incomplete IDs', async () => {
  const { parseFacetCollectionId, facetCollectionQuery } = await import('../src/library-presentation');
  expect(parseFacetCollectionId('facet:creators:plugin:a/b%20')).toEqual({ field: 'creators', valueId: 'plugin:a/b%20' });
  for (const id of ['collection:abc', 'facet::value', 'facet:studios:', 'facet:studios']) expect(parseFacetCollectionId(id)).toBeUndefined();
  const tab = { id: 'studios-new', label: 'Studios', kind: 'collections' as const, facet: 'creators', sort: 'released' as const, direction: 'desc' as const };
  const query = facetCollectionQuery('facet:creators:plugin:a/b%20', tab)!;
  const params = new URLSearchParams(libraryBrowseQuery(query));
  expect(params.get('facet.creators')).toBe('plugin:a/b%20');
  expect(params.get('sort')).toBe('released');
  expect(params.get('direction')).toBe('desc');
  expect(params.has('collectionId')).toBe(false);
  expect(facetCollectionQuery('facet:studios:a', tab)).toBeUndefined();
  expect(facetCollectionQuery('facet:creators:a', { ...tab, facet: undefined })).toBeUndefined();
});

test('collection counts become localized card facts; absent counts remain absent', async () => {
  const { entry } = await import('../src/discovery/models');
  const collection = { id: 'set', kind: 'collection' as const, targetId: 'set', name: 'Studio', receiptToken: '', artwork: [] };
  expect(entry({ ...collection, itemCount: 24 }).facts).toBe('24 titles');
  expect(entry({ ...collection, itemCount: 1 }).facts).toBe('1 title');
  expect(entry({ ...collection, itemCount: 0 }).facts).toBe('0 titles');
  expect(entry(collection).facts).toBe('');
});
