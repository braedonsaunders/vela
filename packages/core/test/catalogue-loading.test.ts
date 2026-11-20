import { expect, test } from 'bun:test';
import { Catalogue, libraryKey, titleRetryDelay } from '../src/store/catalogue';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { LibraryBrowseQuery, LibraryContents } from '../src/wire';
import { VelaError } from '../src/adapter/errors';
import { libraries, libraryEntries } from '../../protocol/fixtures/libraries';

const answer = (): LibraryContents => ({ library: libraries[0]!, items: libraryEntries('movies'), sort: 'server', direction: 'asc', continuation: 'exhausted' });
function setup() {
  const box = new StateBox({ library: {}, titles: {}, related: {}, collections: {} } as unknown as VelaState);
  const resets: (() => void)[] = [];
  let read: (query: LibraryBrowseQuery) => Promise<LibraryContents> = async () => answer();
  let calls = 0;
  const session = {
    epoch: 0,
    onReset(fn: () => void) { resets.push(fn); },
    async ready() { return { adapter: { library: (_id: string, query: LibraryBrowseQuery) => { calls++; return read(query); } }, images: async () => ({ origin: 'https://fixture.test' }) }; },
  };
  const catalogue = new Catalogue(box, session as unknown as Session, () => 640);
  return { box, catalogue, session, calls: () => calls, read(fn: typeof read) { read = fn; }, reset() { session.epoch++; resets.forEach(fn => fn()); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('concurrent first reads share one request and publish the complete model atomically', async () => {
  const f = setup(), pending = deferred<LibraryContents>();
  f.read(() => pending.promise);
  const first = f.catalogue.library('movies');
  expect(f.catalogue.library('movies')).toBe(first);
  expect(f.box.get().library[libraryKey('movies', {})]?.load).toBe('loading');
  await Promise.resolve();
  expect(f.calls()).toBe(1);
  pending.resolve(answer()); await first;
  expect(f.box.get().library[libraryKey('movies', {})]?.value?.items.length).toBeGreaterThan(0);
});

test('a background refresh keeps cached content ready, including on failure', async () => {
  const f = setup(); await f.catalogue.library('movies');
  const held = f.box.get().library;
  const pending = deferred<LibraryContents>(); f.read(() => pending.promise);
  const refresh = f.catalogue.library('movies', {}, 1, true);
  expect(f.box.get().library).toBe(held);
  pending.reject(new Error('offline')); await refresh;
  expect(f.box.get().library).toBe(held);
  expect(held[libraryKey('movies', {})]?.load).toBe('ready');
});

test('opening eleven library pages reads each cursor exactly once', async () => {
  const f = setup();
  const items = answer().items;
  f.read(async ({ cursor }) => {
    const offset = Number(cursor ?? 0);
    return { ...answer(), items: [items[offset]!], continuation: offset < 10 ? 'more' : 'exhausted',
      nextCursor: offset < 10 ? String(offset + 1) : undefined };
  });
  for (let pages = 1; pages <= 11; pages++) await f.catalogue.library('movies', {}, pages);
  expect(f.calls()).toBe(11);
  expect(f.box.get().library[libraryKey('movies', {})]?.value?.items.map(item => item.id))
    .toEqual(items.slice(0, 11).map(item => item.kind === 'title' ? item.title.id : item.id));
});

test('an expired cursor replaces the old snapshot and restarts only once', async () => {
  const f = setup();
  const items = answer().items;
  let restarted = false;
  const cursors: (string | undefined)[] = [];
  const expired = () => new VelaError({ class: 'conflict', code: 'cursor_expired', message: 'Restart', retry: { allowed: false } }, 409);
  f.read(async ({ cursor }) => {
    cursors.push(cursor);
    if (cursor === 'old') { restarted = true; throw expired(); }
    if (cursor === 'new') return { ...answer(), items: [items[2]!] };
    return { ...answer(), items: [items[restarted ? 1 : 0]!], continuation: 'more', nextCursor: restarted ? 'new' : 'old' };
  });
  await f.catalogue.library('movies');
  await f.catalogue.library('movies', {}, 2);
  expect(cursors).toEqual([undefined, 'old', undefined, 'new']);
  expect(f.box.get().library[libraryKey('movies', {})]?.value?.items.map(item => item.id))
    .toEqual(items.slice(1, 3).map(item => item.kind === 'title' ? item.title.id : item.id));
});

test('repeated cursor expiry keeps the last visible snapshot', async () => {
  const f = setup();
  f.read(async ({ cursor }) => {
    if (cursor) throw new VelaError({ class: 'conflict', code: 'cursor_expired', message: 'Restart', retry: { allowed: false } }, 409);
    return { ...answer(), items: [answer().items[0]!], continuation: 'more', nextCursor: 'expired' };
  });
  const key = libraryKey('movies', {});
  await f.catalogue.library('movies');
  const held = f.box.get().library[key]?.value;
  await f.catalogue.library('movies', {}, 2);
  expect(f.calls()).toBe(4);
  expect(f.box.get().library[key]?.load).toBe('failed');
  expect(f.box.get().library[key]?.value).toBe(held);
});

test('a session reset drops cached libraries and ignores an old background response', async () => {
  const f = setup(); await f.catalogue.library('movies');
  const pending = deferred<LibraryContents>(); f.read(() => pending.promise);
  const refresh = f.catalogue.library('movies', {}, 1, true);
  f.reset(); pending.resolve(answer()); await refresh;
  expect(f.box.get().library).toEqual({});
});

test('person titles require a real adapter capability and never fall back to name search', async () => {
  let searches = 0;
  const session = { onReset() {}, async ready() { return { adapter: { search() { searches++; } } }; } };
  const box = new StateBox({} as VelaState);
  const catalogue = new Catalogue(box, session as unknown as Session, () => 640);
  await expect(catalogue.personTitles('person-id', 'library-id')).rejects.toThrow('Person filmography is unavailable');
  expect(searches).toBe(0);
});

test('title retry policy follows declared transient attempts without retrying permanent failures', () => {
  const transient = new VelaError({ class: 'transient', code: 'service_unavailable', message: 'Busy', retry: { allowed: true, maxAttempts: 3 } }, 503);
  expect(titleRetryDelay(transient, 0)).toBe(1000);
  expect(titleRetryDelay(transient, 1)).toBe(2000);
  expect(titleRetryDelay(transient, 2)).toBeUndefined();
  const missing = new VelaError({ class: 'not-found', code: 'not_found', message: 'Gone', retry: { allowed: false } }, 404);
  expect(titleRetryDelay(missing, 0)).toBeUndefined();
});

test('a library\'s recommendations are handed over before its collections and genres arrive', async () => {
  const box = new StateBox({ library: {}, titles: {}, related: {}, collections: {} } as unknown as VelaState);
  const collections = deferred<{ items: never[] }>();
  const rowReads: (boolean | undefined)[] = [];
  const adapter = {
    libraryRows: async (_id: string, _kind: string, fresh?: boolean) => { rowReads.push(fresh); return [{ id: 'r', name: 'Recently added', purpose: 'recentlyAdded', items: [], receiptToken: '', continuation: 'exhausted' }]; },
    libraryCollections: () => collections.promise,
    libraryGenres: async () => [{ id: 'g', label: 'Drama' }],
  };
  const session = { epoch: 0, onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  const catalogue = new Catalogue(box, session as unknown as Session, () => 640);
  const early = deferred<string[]>();
  const all = catalogue.libraryExtras('movies', 'movies', extras => { expect(extras.rowsLoad).toBe('ready'); expect(extras.collectionsLoad).toBe('loading'); early.resolve(extras.rows.map(row => row.name)); }, undefined, undefined, true);
  expect(await early.promise).toEqual(['Recently added']);
  collections.resolve({ items: [] });
  const done = await all;
  expect(done?.rows.map(row => row.name)).toEqual(['Recently added']);
  expect(done?.collectionsLoad).toBe('ready');
  expect(done?.rowsLoad).toBe('ready');
  expect(done?.genresLoad).toBe('ready');
  expect(done?.genres).toEqual([{ id: 'g', label: 'Drama' }]);
  expect(rowReads).toEqual([true]);
});

test('collection first and continuation reads carry the selected tab and preserve its cursor', async () => {
  const calls: unknown[][] = [];
  const adapter = {
    libraryRows: async () => [], libraryGenres: async () => [],
    libraryCollections: async (id: string, cursor?: string, tab?: string) => {
      calls.push([id, cursor, tab]);
      return { items: [{ id: 'facet:people:creator:1', targetId: 'facet:people:creator:1', name: 'Creator', kind: 'collection', artwork: [], receiptToken: '' }], nextCursor: cursor ? undefined : 'opaque-next', continuation: cursor ? 'exhausted' : 'more' };
    },
  };
  const session = { onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  const catalogue = new Catalogue(new StateBox({} as VelaState), session as unknown as Session, () => 640);
  const first = await catalogue.libraryExtras('library', 'mixed', undefined, 'creator-collections');
  expect(first?.collectionCursor).toBe('opaque-next');
  expect(first?.collections[0]?.id).toBe('facet:people:creator:1');
  const next = await catalogue.moreLibraryCollections('library', first!.collectionCursor, 'creator-collections');
  expect(next.cursor).toBe('');
  expect(calls).toEqual([['library', undefined, 'creator-collections'], ['library', 'opaque-next', 'creator-collections']]);
});

 test('empty library is loading until the response finishes; failure never becomes ready', async () => {
  const f = setup(), pending = deferred<LibraryContents>();
  f.read(() => pending.promise);
  const reading = f.catalogue.library('movies');
  const key = libraryKey('movies', {});
  expect(f.box.get().library[key]?.load).toBe('loading');
  expect(f.box.get().library[key]?.value).toBeUndefined();
  pending.resolve({ ...answer(), items: [] }); await reading;
  expect(f.box.get().library[key]?.load).toBe('ready');
  expect(f.box.get().library[key]?.value?.items).toEqual([]);
  f.read(async () => { throw new Error('offline'); });
  await f.catalogue.library('movies');
  expect(f.box.get().library[key]?.load).toBe('failed');
});

test('failed collections cannot masquerade as an empty successful view', async () => {
  const adapter = { libraryRows: async () => [], libraryCollections: async () => { throw new Error('offline'); }, libraryGenres: async () => [] };
  const session = { onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  const catalogue = new Catalogue(new StateBox({} as VelaState), session as unknown as Session, () => 640);
  const result = await catalogue.libraryExtras('movies', 'movies');
  expect(result?.rowsLoad).toBe('ready');
  expect(result?.collectionsLoad).toBe('failed');
  expect(result?.genresLoad).toBe('ready');
});

test('a server-counted total reaches the library model; a missing or invalid one is left out', async () => {
  const f = setup();
  f.read(async () => ({ ...answer(), total: 1234 }));
  await f.catalogue.library('movies');
  expect(f.box.get().library[libraryKey('movies', {})]?.value?.total).toBe(1234);
  for (const total of [undefined, -1, 1.5]) {
    const g = setup();
    g.read(async () => ({ ...answer(), total }));
    await g.catalogue.library('movies');
    expect(g.box.get().library[libraryKey('movies', {})]?.value).not.toHaveProperty('total');
  }
});
