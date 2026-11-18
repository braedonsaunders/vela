import { expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { hasLibraryRecommendations, hasPersonFilmography } from '../src/adapter/capabilities';
import { FakeCredentials } from './helpers';
import { launchMock } from '../../../mock-server/test/launch';

async function connect(old = false) {
  const mock = await launchMock(old ? { VELA_MOCK_OLD: '1' } : { VELA_MOCK_LIBRARY_ROW_PAGE: '2', VELA_MOCK_COLLECTION_PAGE_SIZE: '2' });
  const credentials = new FakeCredentials(null);
  const adapter = new EtherAdapter(mock.url, credentials, 'test');
  credentials.current = await adapter.signInWithPassword({ username: 'demo', password: 'vela', device: credentials.device, idempotencyKey: 'sign-in' });
  return { mock, adapter, credentials };
}

test('Ether person and library capabilities use the scoped endpoints', async () => {
  const { mock, adapter, credentials } = await connect();
  try {
    expect(hasPersonFilmography(adapter)).toBe(false);
    await adapter.probeLibraryViews('movies');
    expect(hasLibraryRecommendations(adapter)).toBe(true);
    const detail = await adapter.detail('title-1-1');
    expect(detail.cast[0]?.id).toBe('person-mara-vale');
    expect(hasPersonFilmography(adapter)).toBe(true);
    const person = await adapter.personDetails('person-mara-vale');
    expect(person).toMatchObject({ name: 'Mara Vale', knownFor: 'Acting', birthday: '1985-04-12' });
    const image = new URL(person.photo!.sizes[0]!.url, mock.url);
    expect((await fetch(image)).status).toBe(200);
    image.searchParams.set('grant', 'invalid');
    expect((await fetch(image)).status).toBe(401);
    expect((await adapter.personTitles('person-mara-vale', 'movies')).items[0]).toMatchObject({ kind: 'title', role: 'Commander' });
    expect((await adapter.libraryRows('movies', 'movies')).length).toBeGreaterThan(2);
    expect((await adapter.libraryGenres('movies')).length).toBeGreaterThan(0);
    const collections = await adapter.libraryCollections('movies');
    expect(collections.items[0]).toMatchObject({ kind: 'collection', targetId: 'fixture-collection' });
    expect((await adapter.library('movies', { collectionId: 'fixture-collection' })).items).toHaveLength(1);
    await expect(adapter.personDetails('unknown')).rejects.toMatchObject({ status: 404 });
    expect(hasPersonFilmography(adapter)).toBe(true);
    await expect(adapter.rows({ placement: 'home', libraryId: 'movies' })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.rows({ placement: 'library', libraryId: 'hidden' })).rejects.toMatchObject({ status: 404 });
    await expect(adapter.libraryCollections('hidden')).rejects.toMatchObject({ status: 404 });
    await expect(adapter.personTitles('person-mara-vale', 'hidden')).rejects.toMatchObject({ status: 404 });
    const duplicate = await fetch(`${mock.url}/vela/v0/rows?placement=library&libraryId=movies&libraryId=shows`, { headers: { Authorization: `Bearer ${credentials.current!.accessToken}`, 'X-Vela-Device-Id': credentials.device.id } });
    expect(duplicate.status).toBe(400);
  } finally { await mock.stop(); }
});

test('older Ether remembers unavailable capabilities', async () => {
  const { mock, adapter } = await connect(true);
  try {
    await adapter.probeLibraryViews('movies');
    await adapter.detail('title-1-1');
    expect(hasLibraryRecommendations(adapter)).toBe(false);
    expect(hasPersonFilmography(adapter)).toBe(false);
    await adapter.probeLibraryViews('movies');
  } finally { await mock.stop(); }
});

test('lab-shaped library rows retain row continuations and ranked shelves', async () => {
  const mock = await launchMock({ VELA_MOCK_LAB: '1' });
  try {
    const credentials = new FakeCredentials(null);
    const adapter = new EtherAdapter(mock.url, credentials, 'test-client');
    credentials.current = await adapter.signInWithPassword({ username: 'demo', password: 'vela', device: credentials.device, idempotencyKey: 'lab' });
    const libraries = await adapter.libraries({});
    expect(libraries.items.map(library => [library.id, library.kind])).toEqual([['1', 'movies'], ['2', 'shows'], ['4', 'shows']]);
    const result = await adapter.rows({ placement: 'library', libraryId: '1' });
    expect(result.continuation).toBe('exhausted');
    expect(result.items.map(row => [row.name, row.items.length, row.continuation])).toEqual([
      ['Trending Now', 20, 'more'], ['Top 10 on Ether On Air Lab Today', 10, 'exhausted'],
      ['New & Noteworthy', 17, 'exhausted'], ['Acclaimed Thrillers', 20, 'more'],
      ['Acclaimed Romances', 20, 'more'], ['Acclaimed History', 20, 'more'],
      ['Under 100 Minutes', 20, 'more'], ['Top Rated', 19, 'exhausted'],
    ]);
    expect(result.items[1]!.presentation).toBe('ranked');
    const first = result.items[0]!;
    expect((await adapter.row!(first.id, first.nextCursor)).items).toHaveLength(10);
    expect((await adapter.home()).capabilities.features.liveTV?.available).toBe(true);
  } finally { await mock.stop(); }
});

test('plugin library facets apply OR within fields, AND across fields and library search', async () => {
  const { mock, adapter } = await connect();
  try {
    const libraries = await adapter.libraries({});
    expect(libraries.items.find(l => l.id === 'videos')).toMatchObject({ presentation: { card: 'landscape' } });
    await adapter.probeLibraryViews('videos');
    expect(hasLibraryRecommendations(adapter)).toBe(true);
    expect((await adapter.libraryRows('videos', 'mixed')).length).toBeGreaterThan(0);
    expect((await adapter.libraryCollections('videos', undefined, 'topics')).items.length).toBeGreaterThan(0);
    const facets = await adapter.libraryFacets('videos', 'topic', 'science');
    expect(facets.items).toEqual([{ id: 'Science Fiction', label: 'Science Fiction', count: 26 }]);
    const first = await adapter.library('videos', { limit: 100 });
    expect(first.sort).toBe('index');
    const all = first.items;
    const or = (await adapter.library('videos', { limit: 100, facets: { topic: ['Science Fiction', 'Romance'] } })).items;
    expect(or.length).toBe(53);
    const and = (await adapter.library('videos', { limit: 100, facets: { topic: ['Science Fiction', 'Romance'], creator: ['Pixel Workshop'] } })).items;
    expect(and.length).toBeGreaterThan(0);
    expect(and.length).toBeLessThan(or.length);
    expect(and.every(e => e.kind === 'title' && e.title.year! % 2 === 0)).toBe(true);
    const found = (await adapter.library('videos', { query: 'Observatory' })).items;
    expect(found.length).toBeGreaterThan(0);
    expect(found.every(e => e.kind === 'title' && e.title.name.includes('Observatory'))).toBe(true);
    expect(all.length).toBeGreaterThan(or.length);
  } finally { await mock.stop(); }
});

test('facet collection tab pages stay scoped and open newest-first filtered items', async () => {
  const { mock, adapter } = await connect();
  try {
    await adapter.libraries({});
    const first = await adapter.libraryCollections('movies', undefined, 'collections');
    expect(first.items).toHaveLength(2);
    expect(first.continuation).toBe('more');
    const next = await adapter.libraryCollections('movies', first.nextCursor, 'collections');
    expect(next.continuation).toBe('exhausted');
    expect(new Set([...first.items, ...next.items].map(item => item.id)).size).toBe(4);
    const { facetCollectionQuery } = await import('../src/library-presentation');
    const { libraries } = await import('../../protocol/fixtures/libraries');
    const tab = libraries[0]!.tabs!.find(tab => tab.id === 'collections')!;
    const queries = [...first.items, ...next.items].map(item => facetCollectionQuery(item.id, tab)!);
    let previous = Infinity;
    for (const query of queries) {
      const answer = await adapter.library('movies', query);
      expect(answer.items.length).toBeLessThanOrEqual(previous);
      previous = answer.items.length;
      const dates = answer.items.flatMap(item => item.kind === 'title' ? [item.title.airDate!] : []);
      expect(dates.length).toBeGreaterThan(0);
      expect(dates).toEqual([...dates].sort().reverse());
    }
    // Legacy collections keep the existing wrapped response and endpoint behavior.
    expect((await adapter.libraryCollections('movies')).items[0]?.kind).toBe('collection');
  } finally { await mock.stop(); }
});

test('collection reads request a full grid page and retain counts', async () => {
  const mock = await launchMock();
  const credentials = new FakeCredentials(null);
  const adapter = new EtherAdapter(mock.url, credentials, 'test');
  try {
    credentials.current = await adapter.signInWithPassword({ username: 'demo', password: 'vela', device: credentials.device, idempotencyKey: 'sign-in' });
    const page = await adapter.libraryCollections('movies', undefined, 'collections');
    expect(page.items).toHaveLength(4);
    expect(page.continuation).toBe('exhausted');
    expect(page.items[0]).toMatchObject({ kind: 'collection', itemCount: expect.any(Number) });
    // A smaller explicit request proves the server honors a client's page size.
    const small = await fetch(`${mock.url}/vela/v0/libraries/movies/collections?tab=collections&limit=2`, { headers: { Authorization: `Bearer ${credentials.current!.accessToken}`, 'X-Vela-Device-Id': credentials.device.id } });
    expect((await small.json()).items).toHaveLength(2);
  } finally { await mock.stop(); }
});

test('plugin people tabs page in server order and enable direct filmography', async () => {
  const { mock, adapter } = await connect();
  try {
    const libraries = await adapter.libraries({});
    const plugin = libraries.items.find(l => l.id === 'videos')!;
    expect(plugin.tabs?.filter(t => t.kind === 'people').map(t => t.order)).toEqual(['name', 'count']);
    expect(hasPersonFilmography(adapter)).toBe(true);
    const first = await adapter.libraryCollections('videos', undefined, 'performers');
    expect(first.items).toHaveLength(2);
    expect(first.items[0]).toMatchObject({ kind: 'person', id: 'person:performer-0', person: { id: 'performer-0', name: 'Performer 001' }, itemCount: 1 });
    expect(first.items[1]?.kind === 'person' && first.items[1].person.photo).toBeNull();
    const next = await adapter.libraryCollections('videos', first.nextCursor, 'performers');
    expect(next.items[0]).toMatchObject({ person: { id: 'performer-2' } });
    const counted = await adapter.libraryCollections('videos', undefined, 'popular-cast');
    expect(counted.items[0]).toMatchObject({ person: { id: 'performer-104' }, itemCount: 105 });
    expect((await adapter.personDetails('performer-104')).name).toBe('Performer 105');
    expect((await adapter.personTitles('performer-104')).items.length).toBeGreaterThan(0);
  } finally { await mock.stop(); }
});

test('plugin collections honor each declared order without client sorting', async () => {
  const { mock, adapter } = await connect();
  try {
    await adapter.libraries({});
    const byName = await adapter.libraryCollections('videos', undefined, 'topics');
    const byCount = await adapter.libraryCollections('videos', undefined, 'popular-topics');
    expect(byName.items.map(item => item.kind === 'collection' ? item.name : '')).toEqual(['Adventure', 'Comedy']);
    expect(byCount.items[0]?.kind).toBe('collection');
    const counts = byCount.items.flatMap(item => item.kind === 'collection' ? [item.itemCount!] : []);
    expect(counts[0]!).toBeGreaterThanOrEqual(counts[1]!);
    expect(byCount.items.map(item => item.id)).not.toEqual(byName.items.map(item => item.id));
  } finally { await mock.stop(); }
});
