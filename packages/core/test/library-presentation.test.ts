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
  expect(libraryKey('a', { tab: 'recent' })).not.toBe(libraryKey('a', { tab: 'history' }));
});
test('tabs preserve labels, identity and order, skipping unknown kinds', () => {
  expect(libraryTabs(undefined)).toBeUndefined();
  expect(libraryTabs([])).toEqual([]);
  const tabs = [{ id: 'custom', label: 'Videos', kind: 'library' }, { id: 'future', label: '?', kind: 'future' }, { id: 'history', label: 'History', kind: 'view' }, { id: 'for-you', label: 'For you', kind: 'recommended' }, { id: 'streams', label: 'Live now', kind: 'live' }];
  expect(libraryTabs(tabs as any)?.map(t => [t.id, t.label])).toEqual([['custom', 'Videos'], ['history', 'History'], ['for-you', 'For you'], ['streams', 'Live now']]);
});

test('view browse parameters carry the tab with its search and ordering', () => {
  const q = new URLSearchParams(libraryBrowseQuery({ tab: 'history', query: 'portal', sort: 'updated', direction: 'desc', cursor: 'opaque' }));
  expect(Object.fromEntries(q)).toEqual({ tab: 'history', query: 'portal', sort: 'updated', direction: 'desc', cursor: 'opaque' });
});

test('lastViewed has the Recently watched sort label', async () => {
  const { msg } = await import('../src/i18n');
  expect(msg('library.sort.lastViewed')).toBe('Recently watched');
});

test('the shared library date rule uses ISO full dates and falls back to year', async () => {
  const { card } = await import('../src/discovery/models');
  const title = { id: 'dated', kind: 'movie' as const, name: 'Dated', summary: '', genres: [], artwork: [], year: 2026, airDate: '2026-11-19' };
  expect(card(title).yearLabel).toBe('2026');
  expect(card({ ...title, dateDisplay: 'date' }).yearLabel).toBe('2026-11-19');
  expect(card({ ...title, airDate: undefined, dateDisplay: 'date' }).yearLabel).toBe('2026');
  expect(card({ ...title, airDate: 'not-a-date', dateDisplay: 'date' }).facts).toBe('2026');
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

test('people tabs retain opaque keys, facets and server order declarations', () => {
  const tabs = [
    { id: 'cast-count', label: 'Popular cast', kind: 'people' as const, facet: 'performers', order: 'count' as const },
    { id: 'sets', label: 'Sets', kind: 'collections' as const, order: 'name' as const },
    { id: 'cast-name', label: 'Cast', kind: 'people' as const, facet: 'performers', order: 'name' as const },
  ];
  expect(libraryTabs(tabs)).toEqual(tabs);
});

test('person cards use the person ID, round portrait source and localized title counts', async () => {
  const { entry } = await import('../src/discovery/models');
  const item = { id: 'person:opaque:id', kind: 'person' as const, receiptToken: '', person: { id: 'opaque:id', name: 'A Person', photo: null }, itemCount: 1 };
  expect(entry(item)).toMatchObject({ id: 'opaque:id', kind: 'person', name: 'A Person', poster: '', facts: '1 title' });
  expect(entry({ ...item, itemCount: 0 }).facts).toBe('0 titles');
});

test('a person page names its sections for the library it was opened from', async () => {
  const { personSectionLabels } = await import('../src/store/catalogue');
  const labels = (scope?: Parameters<typeof personSectionLabels>[0]) => Object.values(personSectionLabels(scope));
  expect(labels(undefined)).toEqual(['person.movies', 'person.tvShows']);
  expect(labels({ kind: 'mixed' })).toEqual(['person.movies', 'person.tvShows']);
  expect(labels({ kind: 'movies', presentation: { card: 'poster' } })).toEqual(['person.movies', 'person.titles']);
  expect(labels({ kind: 'shows' })).toEqual(['person.titles', 'person.tvShows']);
  // A landscape library of movie-kind items (scenes, clips) and a book library hold "Titles".
  expect(labels({ kind: 'movies', presentation: { card: 'landscape' } })).toEqual(['person.titles', 'person.titles']);
  expect(labels({ kind: 'movies', media: 'audiobook', presentation: { card: 'square' } })).toEqual(['person.titles', 'person.titles']);
});
