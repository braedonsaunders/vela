// A library's recommendations, collections and genres are read as independent parts: a slow or
// failed collections answer never holds back or fails the recommendations, collections are read
// only when asked for and then held for the session, and slow side reads queue in a lane of their
// own instead of holding every connection to the server.
import { expect, test } from 'bun:test';
import { Catalogue } from '../src/store/catalogue';
import { Lane } from '../src/store/lane';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { Page, Row, RowEntry } from '../src/wire';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = (name: string): Row => ({ id: name, name, purpose: 'recentlyAdded', items: [], receiptToken: '', continuation: 'exhausted' } as unknown as Row);
const collectionPage = (name: string, nextCursor?: string): Page<RowEntry> => ({
  items: [{ id: name, targetId: name, name, kind: 'collection', artwork: [], receiptToken: '' } as unknown as RowEntry],
  nextCursor, continuation: nextCursor ? 'more' : 'exhausted',
});

function setup(progressRevision = 0) {
  const box = new StateBox({ library: {}, titles: {}, related: {}, collections: {}, home: { progressRevision } } as unknown as VelaState);
  const calls = { rows: [] as (boolean | undefined)[], collections: [] as unknown[][], genres: 0 };
  const adapter = {
    libraryRows: async (_id: string, _kind: string, fresh?: boolean): Promise<Row[]> => { calls.rows.push(fresh); return rowsAnswer(); },
    libraryCollections: (id: string, cursor?: string, tab?: string, search?: string): Promise<Page<RowEntry>> => { calls.collections.push([id, cursor, tab, search]); return collectionsAnswer(id, cursor); },
    libraryGenres: async () => { calls.genres++; return genresAnswer(); },
  };
  let rowsAnswer = async (): Promise<Row[]> => [row('Recently added')];
  let collectionsAnswer = async (id: string, _cursor?: string): Promise<Page<RowEntry>> => collectionPage(`${id} collection`);
  let genresAnswer = async () => [{ id: 'g', label: 'Drama' }];
  const resets: (() => void)[] = [];
  const session = { epoch: 0, onReset(fn: () => void) { resets.push(fn); }, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  const catalogue = new Catalogue(box, session as unknown as Session, () => 640);
  return {
    box, catalogue, session, calls,
    rows(fn: typeof rowsAnswer) { rowsAnswer = fn; },
    collections(fn: typeof collectionsAnswer) { collectionsAnswer = fn; },
    genres(fn: typeof genresAnswer) { genresAnswer = fn; },
    progress(revision: number) { box.update('home', home => ({ ...home, progressRevision: revision })); },
  };
}

test('recommendations arrive on their own: collections and genres are not read, however slow they would be', async () => {
  const f = setup();
  const never = deferred<Page<RowEntry>>();
  f.collections(() => never.promise);
  const rows = await f.catalogue.libraryRecommendations('movies', 'movies');
  expect(rows?.map(value => value.name)).toEqual(['Recently added']);
  expect(f.calls.collections).toEqual([]);
  expect(f.calls.genres).toBe(0);
});

test('a failed or slow collections read leaves recommendations ready, and failed recommendations leave collections ready', async () => {
  const f = setup();
  f.collections(async () => { throw new Error('collections timed out'); });
  const [rows, collections] = await Promise.allSettled([
    f.catalogue.libraryRecommendations('movies', 'movies'),
    f.catalogue.libraryCollectionPage('movies'),
  ]);
  expect(rows.status).toBe('fulfilled');
  expect(collections.status).toBe('rejected');

  const g = setup();
  g.rows(async () => { throw new Error('not found'); });
  const [failedRows, readyCollections] = await Promise.allSettled([
    g.catalogue.libraryRecommendations('movies', 'movies'),
    g.catalogue.libraryCollectionPage('movies'),
  ]);
  expect(failedRows.status).toBe('rejected');
  expect(readyCollections.status === 'fulfilled' && readyCollections.value?.items.map(card => card.name)).toEqual(['movies collection']);
});

test('collections are held for the session: progress moving never reads them again; Try again does, once', async () => {
  const f = setup();
  const first = await f.catalogue.libraryCollectionPage('movies', 'collections-tab');
  expect(first?.items.map(card => card.name)).toEqual(['movies collection']);
  f.progress(4);
  expect(await f.catalogue.libraryCollectionPage('movies', 'collections-tab')).toBe(first);
  expect(f.catalogue.cachedLibraryCollections('movies', 'collections-tab')).toBe(first);
  expect(f.catalogue.cachedLibraryCollections('movies', 'other-tab')).toBeUndefined();
  expect(f.calls.collections.length).toBe(1);
  // Two Try agains while one read is in flight share it.
  const slow = deferred<Page<RowEntry>>();
  f.collections(() => slow.promise);
  const again = f.catalogue.libraryCollectionPage('movies', 'collections-tab', undefined, true);
  const twice = f.catalogue.libraryCollectionPage('movies', 'collections-tab', undefined, true);
  slow.resolve(collectionPage('fresh'));
  expect((await again)?.items[0]?.name).toBe('fresh');
  expect(await twice).toBe(await again);
  expect(f.calls.collections.length).toBe(2);
  // Another session's collections are never shown.
  f.session.epoch++;
  expect(f.catalogue.cachedLibraryCollections('movies', 'collections-tab')).toBeUndefined();
});

test('a failed collections read is not held, so the next open reads again', async () => {
  const f = setup();
  f.collections(async () => { throw new Error('offline'); });
  await expect(f.catalogue.libraryCollectionPage('movies')).rejects.toThrow('offline');
  expect(f.catalogue.cachedLibraryCollections('movies')).toBeUndefined();
  f.collections(async id => collectionPage(`${id} collection`));
  expect((await f.catalogue.libraryCollectionPage('movies'))?.items.length).toBe(1);
  expect(f.calls.collections.length).toBe(2);
});

test('recommendations are held at their progress revision and one read serves a prefetch and its page', async () => {
  const f = setup(3);
  const pending = deferred<Row[]>();
  f.rows(() => pending.promise);
  const prefetch = f.catalogue.libraryRecommendations('movies', 'movies', true);
  const page = f.catalogue.libraryRecommendations('movies', 'movies', true);
  pending.resolve([row('Continue watching')]);
  expect(await page).toBe(await prefetch);
  expect(f.calls.rows).toEqual([true]);
  expect(f.catalogue.cachedLibraryRecommendations('movies')?.progressRevision).toBe(3);
  // Held at this revision: no read.
  await f.catalogue.libraryRecommendations('movies', 'movies', true);
  expect(f.calls.rows.length).toBe(1);
  // Progress moved: read again.
  f.rows(async () => [row('Continue watching')]);
  f.progress(4);
  await f.catalogue.libraryRecommendations('movies', 'movies', true);
  expect(f.calls.rows.length).toBe(2);
  expect(f.catalogue.cachedLibraryRecommendations('movies')?.progressRevision).toBe(4);
});

test('collection pages carry the tab and search, and continue from the server\'s cursor', async () => {
  const f = setup();
  f.collections(async (id, cursor) => collectionPage(cursor ? 'second' : 'first', cursor ? undefined : 'opaque-next'));
  const first = await f.catalogue.libraryCollectionPage('library', 'creator-collections', 'cre');
  expect(first).toMatchObject({ cursor: 'opaque-next' });
  const next = await f.catalogue.moreLibraryCollections('library', first!.cursor, 'creator-collections', 'cre');
  expect(next.items[0]?.name).toBe('second');
  expect(next.cursor).toBe('');
  expect(f.calls.collections).toEqual([['library', undefined, 'creator-collections', 'cre'], ['library', 'opaque-next', 'creator-collections', 'cre']]);
});

test('slow collections reads wait in their own lane, two at a time, while recommendations go straight through', async () => {
  const f = setup();
  const answers = new Map<string, ReturnType<typeof deferred<Page<RowEntry>>>>();
  f.collections(id => { const answer = deferred<Page<RowEntry>>(); answers.set(id, answer); return answer.promise; });
  const reads = ['movies', 'shows', 'music'].map(id => f.catalogue.libraryCollectionPage(id));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([...answers.keys()]).toEqual(['movies', 'shows']);
  // Recommendations are not queued behind the slow collections.
  expect((await f.catalogue.libraryRecommendations('movies', 'movies'))?.length).toBe(1);
  answers.get('movies')!.resolve(collectionPage('m'));
  await reads[0];
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([...answers.keys()]).toEqual(['movies', 'shows', 'music']);
  answers.get('shows')!.resolve(collectionPage('s'));
  answers.get('music')!.reject(new Error('slow and failed'));
  await reads[1];
  await expect(reads[2]).rejects.toThrow('slow and failed');
});

test('genres are read on their own and held for the session', async () => {
  const f = setup();
  expect(await f.catalogue.libraryGenreChoices('movies')).toEqual([{ id: 'g', label: 'Drama' }]);
  expect(await f.catalogue.libraryGenreChoices('movies')).toEqual([{ id: 'g', label: 'Drama' }]);
  expect(f.calls.genres).toBe(1);
  expect(f.calls.collections).toEqual([]);
  expect(f.calls.rows).toEqual([]);
});

test('a lane runs at most its limit at once, in arrival order, and frees its place on failure', async () => {
  const lane = new Lane(2);
  const started: number[] = [];
  const gates = [0, 1, 2, 3].map(() => deferred<void>());
  const runs = gates.map((gate, n) => lane.run(async () => { started.push(n); await gate.promise; return n; }));
  await Promise.resolve();
  expect(started).toEqual([0, 1]);
  expect(lane.size).toBe(4);
  gates[1]!.reject(new Error('failed'));
  await expect(runs[1]!).rejects.toThrow('failed');
  await Promise.resolve();
  expect(started).toEqual([0, 1, 2]);
  gates[0]!.resolve(); gates[2]!.resolve(); gates[3]!.resolve();
  expect(await Promise.all([runs[0], runs[2], runs[3]])).toEqual([0, 2, 3]);
  expect(started).toEqual([0, 1, 2, 3]);
  expect(lane.size).toBe(0);
});
