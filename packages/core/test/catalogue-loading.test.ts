import { expect, test } from 'bun:test';
import { Catalogue, libraryKey } from '../src/store/catalogue';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { LibraryContents } from '../src/wire';
import { libraries, libraryEntries } from '../../protocol/fixtures/libraries';

const answer = (): LibraryContents => ({ library: libraries[0]!, items: libraryEntries('movies'), sort: 'server', direction: 'asc', continuation: 'exhausted' });
function setup() {
  const box = new StateBox({ library: {}, titles: {}, related: {}, collections: {} } as unknown as VelaState);
  const resets: (() => void)[] = [];
  let read = async () => answer();
  let calls = 0;
  const session = {
    epoch: 0,
    onReset(fn: () => void) { resets.push(fn); },
    async ready() { return { adapter: { library: () => { calls++; return read(); } }, images: async () => ({ origin: 'https://fixture.test' }) }; },
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

test('a library\'s recommendations are handed over before its collections and genres arrive', async () => {
  const box = new StateBox({ library: {}, titles: {}, related: {}, collections: {} } as unknown as VelaState);
  const collections = deferred<{ items: never[] }>();
  const adapter = {
    libraryRows: async () => [{ id: 'r', name: 'Recently added', purpose: 'recentlyAdded', items: [], receiptToken: '', continuation: 'exhausted' }],
    libraryCollections: () => collections.promise,
    libraryGenres: async () => [{ id: 'g', label: 'Drama' }],
  };
  const session = { epoch: 0, onReset() {}, async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; } };
  const catalogue = new Catalogue(box, session as unknown as Session, () => 640);
  const early = deferred<string[]>();
  const all = catalogue.libraryExtras('movies', 'movies', extras => early.resolve(extras.rows.map(row => row.name)));
  expect(await early.promise).toEqual(['Recently added']);
  collections.resolve({ items: [] });
  const done = await all;
  expect(done?.rows.map(row => row.name)).toEqual(['Recently added']);
  expect(done?.genres).toEqual([{ id: 'g', label: 'Drama' }]);
});
