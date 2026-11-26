// Letter-jump index (Plex firstCharacter) and offset-started library reads in Catalogue.
import { afterEach, describe, expect, test } from 'bun:test';
import { parsePlexJumpIndex } from '../src/adapter/plex/jump-index';
import { PlexAdapter } from '../src/adapter/plex';
import { Catalogue, libraryKey } from '../src/store/catalogue';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { LibraryJumpBucket } from '../src/models';
import type * as V from '../src/wire';
import { FakeCredentials } from './helpers';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('parsePlexJumpIndex', () => {
  test('parses numeric and string sizes, skips zero entries, preserves server order and computes cumulative offsets', () => {
    const buckets = parsePlexJumpIndex([
      { key: '#', title: '#', size: '12' },
      { key: 'A', title: 'A', size: 0 },
      { key: 'B', title: 'B', size: '0' },
      { key: 'É', title: 'É', size: 5 },
      { key: 'W', title: 'W', size: '140' },
      { key: 'Z', title: 'Z', size: 3 },
    ]);
    expect(buckets).toEqual([
      { key: '#', label: '#', count: 12, startOffset: 0 },
      { key: 'É', label: 'É', count: 5, startOffset: 12 },
      { key: 'W', label: 'W', count: 140, startOffset: 17 },
      { key: 'Z', label: 'Z', count: 3, startOffset: 157 },
    ]);
  });

  test('returns empty on malformed sizes or missing labels so cumulative offsets never drift', () => {
    expect(parsePlexJumpIndex(null)).toEqual([]);
    expect(parsePlexJumpIndex([{ key: 'A', title: 'A', size: -1 }])).toEqual([]);
    expect(parsePlexJumpIndex([{ key: 'A', title: 'A', size: '12.5' }])).toEqual([]);
    expect(parsePlexJumpIndex([{ key: 'A', title: 'A', size: 'abc' }])).toEqual([]);
    expect(parsePlexJumpIndex([{ key: 'A', title: 'A' }])).toEqual([]);
    expect(parsePlexJumpIndex([{ key: 'A', title: 'A', size: 4 }, { key: '', title: '', size: 2 }])).toEqual([]);
  });
});

describe('PlexAdapter.libraryJumpIndex', () => {
  function makeAdapter(routes: Record<string, unknown>, requested: URL[]) {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      requested.push(url);
      const body = routes[url.pathname];
      if (!body) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ MediaContainer: body }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    return new PlexAdapter({ origin: 'http://plex.local:32400', clientIdentifier: 'dev-1', credentials: new FakeCredentials() });
  }

  test('reads /firstCharacter with matching parameters (no type or includeCollections) for movie and show sections', async () => {
    const requested: URL[] = [];
    const adapter = makeAdapter({
      '/library/sections': {
        Directory: [
          { key: '1', title: 'Movies', type: 'movie' },
          { key: '2', title: 'TV Shows', type: 'show' },
          { key: '3', title: 'Music', type: 'artist' },
        ],
      },
      '/library/sections/1/firstCharacter': {
        Directory: [
          { key: '#', title: '#', size: '4' },
          { key: 'A', title: 'A', size: 0 },
          { key: 'W', title: 'W', size: '30' },
        ],
      },
      '/library/sections/2/firstCharacter': {
        Directory: [
          { key: 'A', title: 'A', size: 10 },
          { key: 'S', title: 'S', size: 20 },
        ],
      },
    }, requested);

    const movieBuckets = await adapter.libraryJumpIndex('1', { sort: 'title', direction: 'asc' });
    expect(movieBuckets).toEqual([
      { key: '#', label: '#', count: 4, startOffset: 0 },
      { key: 'W', label: 'W', count: 30, startOffset: 4 },
    ]);
    const fcUrl = requested.find(u => u.pathname === '/library/sections/1/firstCharacter');
    expect(fcUrl).toBeDefined();
    expect(fcUrl!.searchParams.has('type')).toBe(false);
    expect(fcUrl!.searchParams.has('includeCollections')).toBe(false);

    const showBuckets = await adapter.libraryJumpIndex('2', { sort: 'title', direction: 'asc' });
    expect(showBuckets).toEqual([
      { key: 'A', label: 'A', count: 10, startOffset: 0 },
      { key: 'S', label: 'S', count: 20, startOffset: 10 },
    ]);

    // Music sections, descending direction, non-title sort and tabbed views return empty without calling /firstCharacter.
    const before = requested.length;
    expect(await adapter.libraryJumpIndex('3', { sort: 'title', direction: 'asc' })).toEqual([]);
    expect(await adapter.libraryJumpIndex('1', { sort: 'title', direction: 'desc' })).toEqual([]);
    expect(await adapter.libraryJumpIndex('1', { sort: 'added', direction: 'asc' })).toEqual([]);
    expect(await adapter.libraryJumpIndex('1', { sort: 'title', direction: 'asc', tab: 'albums' })).toEqual([]);
    expect(requested.length).toBe(before);
  });
});

describe('Catalogue letter jump & offset-started reads', () => {
  const baseLibrary: V.Library = {
    id: 'movies',
    name: 'Movies',
    kind: 'movies',
    artwork: [],
    browse: {
      sorts: [{ id: 'title', directions: ['asc', 'desc'] }],
      defaultSort: 'title',
      defaultDirection: 'asc',
      filters: {},
    },
  };

  function entryAt(index: number): V.RowEntry {
    return {
      id: `m-${index}`,
      kind: 'title',
      receiptToken: '',
      title: {
        id: `m-${index}`,
        kind: 'movie',
        name: `Title ${index}`,
        summary: '',
        genres: [],
        ratings: [],
        artwork: [],
        watch: { positionSeconds: 0, played: false, favorite: false, watchlisted: false },
      },
    };
  }

  function setupCatalogue(withJumpIndex = true) {
    const box = new StateBox({ library: {}, titles: {}, related: {}, collections: {}, home: { progressRevision: 0 } } as unknown as VelaState);
    const libraryCalls: V.LibraryBrowseQuery[] = [];
    let jumpResponder = async (): Promise<LibraryJumpBucket[]> => [
      { key: '#', label: '#', count: 10, startOffset: 0 },
      { key: 'W', label: 'W', count: 150, startOffset: 340 },
    ];
    let jumpCalls = 0;

    const adapter: Record<string, unknown> = {
      library: async (_id: string, query: V.LibraryBrowseQuery): Promise<V.LibraryContents> => {
        libraryCalls.push({ ...query });
        const start = query.cursor ? Number(query.cursor) : 0;
        const limit = query.limit ?? 100;
        const total = 500;
        const count = Math.max(0, Math.min(limit, total - start));
        const items = Array.from({ length: count }, (_, i) => entryAt(start + i));
        const next = start + count;
        return {
          library: baseLibrary,
          sort: query.sort ?? 'title',
          direction: query.direction ?? 'asc',
          items,
          total,
          continuation: next < total ? 'more' : 'exhausted',
          nextCursor: next < total ? String(next) : undefined,
        };
      },
    };
    if (withJumpIndex) {
      adapter.libraryJumpIndex = async () => {
        jumpCalls++;
        return jumpResponder();
      };
    }

    const resets: (() => void)[] = [];
    const session = {
      epoch: 1,
      selected: () => ({ adapter }),
      onReset(fn: () => void) { resets.push(fn); },
      async ready() { return { adapter, images: async () => ({ origin: 'https://fixture.test' }) }; },
    };
    const catalogue = new Catalogue(box, session as unknown as Session, () => 640);
    return {
      box,
      catalogue,
      session,
      libraryCalls,
      get jumpCalls() { return jumpCalls; },
      setJumpResponder(fn: typeof jumpResponder) { jumpResponder = fn; },
      reset() {
        session.epoch++;
        for (const fn of resets) fn();
      },
    };
  }

  test('jumping to an offset issues ONE bounded read at that offset and none below it, and Show more continues from nextCursor', async () => {
    const f = setupCatalogue();
    const jumpedQuery = { sort: 'title' as const, direction: 'asc' as const, start: 340 };
    await f.catalogue.library('movies', jumpedQuery, 1);

    expect(f.libraryCalls).toHaveLength(1);
    expect(f.libraryCalls[0]!.cursor).toBe('340');
    expect('start' in f.libraryCalls[0]!).toBe(false);

    const jumpedKey = libraryKey('movies', jumpedQuery);
    const topKey = libraryKey('movies', { sort: 'title', direction: 'asc' });
    expect(jumpedKey).not.toBe(topKey);
    expect(libraryKey('movies', { sort: 'title', direction: 'asc', start: 0 })).toBe(topKey);

    const page1 = f.box.get().library[jumpedKey]?.value;
    expect(page1?.startOffset).toBe(340);
    expect(page1?.pages).toBe(1);
    expect(page1?.items).toHaveLength(100);
    expect(page1?.items[0]!.id).toBe('m-340');
    expect(page1?.more).toBe(true);

    // Show more continues from nextCursor ("440"), never reading 0..339.
    await f.catalogue.library('movies', jumpedQuery, 2);
    expect(f.libraryCalls).toHaveLength(2);
    expect(f.libraryCalls[1]!.cursor).toBe('440');

    const page2 = f.box.get().library[jumpedKey]?.value;
    expect(page2?.pages).toBe(2);
    expect(page2?.items).toHaveLength(160);
    expect(page2?.items[0]!.id).toBe('m-340');
    expect(page2?.items[159]!.id).toBe('m-499');
    expect(page2?.more).toBe(false);
    // Offset 0 view remains completely separate and untouched.
    expect(f.box.get().library[topKey]).toBeUndefined();
  });

  test('adapters without LibraryJumpIndex advertise unavailable and return undefined', async () => {
    const f = setupCatalogue(false);
    expect(f.catalogue.libraryJumpIndexAvailable).toBe(false);
    expect(await f.catalogue.libraryJumpIndex('movies')).toBeUndefined();
  });

  test('jump index caches per session and drops a stale reply after session epoch moves on', async () => {
    const f = setupCatalogue(true);
    expect(f.catalogue.libraryJumpIndexAvailable).toBe(true);

    const first = deferred<LibraryJumpBucket[]>();
    f.setJumpResponder(() => first.promise);
    const pending = f.catalogue.libraryJumpIndex('movies');

    // Switch server / viewer before the first reply resolves.
    f.reset();
    first.resolve([{ key: 'OLD', label: 'OLD', count: 5, startOffset: 0 }]);
    await pending;

    // Stale reply must NOT be cached under the new epoch.
    expect(f.catalogue.cachedLibraryJumpIndex('movies')).toBeUndefined();

    // New epoch fetches fresh buckets and caches them.
    f.setJumpResponder(async () => [
      { key: 'A', label: 'A', count: 10, startOffset: 0 },
      { key: 'W', label: 'W', count: 20, startOffset: 10 },
    ]);
    const fresh = await f.catalogue.libraryJumpIndex('movies');
    expect(fresh?.map(b => b.key)).toEqual(['A', 'W']);
    expect(f.catalogue.cachedLibraryJumpIndex('movies')?.map(b => b.key)).toEqual(['A', 'W']);

    // Second read uses cache.
    const callsBefore = f.jumpCalls;
    await f.catalogue.libraryJumpIndex('movies');
    expect(f.jumpCalls).toBe(callsBefore);
  });
});
