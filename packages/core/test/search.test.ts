import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { Search, initialSearch, type SearchState } from '../src/store/search';
import { StateBox } from '../src/store/state';
import type { Session } from '../src/store/session';
import type { VelaState } from '../src/store';
import type * as V from '../src/wire';

const title = (id: string, name = id): V.Title => ({ id, kind: 'movie', name, summary: '', genres: [], artwork: [] });
const answer = (request: { query: string; generation: number }, items: V.Title[], descriptive?: V.DescriptiveSearchState): V.SearchResponse =>
  ({ query: request.query, generation: request.generation, items, continuation: 'exhausted', ...(descriptive ? { descriptive } : {}) });

type Request = Omit<V.SearchRequest, 'mode'>;
interface FakeAdapter {
  search: (r: Request, signal?: AbortSignal) => Promise<V.SearchResponse>;
  searchByDescription?: (r: Request) => Promise<V.SearchResponse>;
}

/** A session holding one connection to a fake adapter; `descriptive` turns the feature on. */
function harness(adapter: FakeAdapter, descriptive = true, caps?: Pick<V.ServerCapabilities, 'searchSorts' | 'searchKinds' | 'searchLibraries'>) {
  const resets: (() => void)[] = [];
  const connection = { adapter, images: async () => ({ origin: 'https://server.example' }) };
  const session = {
    searchCapabilities: caps,
    features: { descriptiveSearch: { available: descriptive } },
    selected: () => connection,
    ready: async () => connection,
    key: () => crypto.randomUUID(),
    onReset: (listener: () => void) => { resets.push(listener); return () => {}; },
  } as unknown as Session;
  const box = new StateBox({ search: initialSearch, libraries: { value: [{ id: 'movies' }, { id: 'shows' }] } } as unknown as VelaState);
  const search = new Search(box, session, () => 400);
  return { search, state: (): SearchState => box.get().search, reset: () => resets.forEach(r => r()) };
}

/** Let pending promise chains run to their next timer. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Search', () => {
  test('the fast lane answers; a server without descriptive search says so at once', async () => {
    const calls: Request[] = [];
    const { search, state } = harness({ search: async r => { calls.push(r); return answer(r, [title('a', 'Alpha')]); } }, false);
    search.setQuery('alp');
    expect(state()).toMatchObject({ query: 'alp', generation: 1, fast: { status: 'loading' }, descriptive: { status: 'unavailable' }, ai: { status: 'idle' } });
    await settle();
    expect(state().fast.status).toBe('ready');
    expect(state().fast.items.map(c => c.name)).toEqual(['Alpha']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ query: 'alp', generation: 1 });
    expect(calls[0]!.idempotencyKey).toMatch(/^search-.+-1$/);
    jest.advanceTimersByTime(5000);
    await settle();
    expect(state().descriptive.status).toBe('unavailable');
    expect(state().ai).toEqual({ status: 'idle', items: [], error: '' });
  });

  test('an adapter without searchByDescription is unavailable even when the feature is advertised', () => {
    const { search, state } = harness({ search: async r => answer(r, []) }, true);
    search.setQuery('heist');
    expect(state().descriptive.status).toBe('unavailable');
  });

  test('an empty query clears every lane but still advances the generation', async () => {
    const { search, state } = harness({ search: async r => answer(r, [title('a')]) }, false);
    search.setQuery('a');
    await settle();
    search.setQuery('   ');
    expect(state()).toEqual({ ...initialSearch, query: '   ', generation: 2 });
  });

  test('an answer for an older query is dropped', async () => {
    const pending: ((value: V.SearchResponse) => void)[] = [];
    const requests: Request[] = [];
    const { search, state } = harness({ search: r => { requests.push(r); return new Promise(resolve => pending.push(resolve)); } }, false);
    search.setQuery('in');
    await settle();
    search.setQuery('inception');
    await settle();
    expect(requests.map(r => r.generation)).toEqual([1, 2]);
    pending[1]!(answer(requests[1]!, [title('new', 'Inception')]));
    await settle();
    pending[0]!(answer(requests[0]!, [title('old', 'Interstellar')]));
    await settle();
    expect(state().generation).toBe(2);
    expect(state().fast.items.map(c => c.id)).toEqual(['new']);
  });

  test('a failed fast lane reports the error message', async () => {
    const { search, state } = harness({ search: async () => { throw new Error('Server returned 500'); } }, false);
    search.setQuery('x');
    await settle();
    expect(state().fast).toMatchObject({ status: 'failed', error: 'Server returned 500' });
  });

  test('the descriptive lane starts only once typing pauses', async () => {
    const described: Request[] = [];
    const { search, state } = harness({
      search: async r => answer(r, []),
      searchByDescription: async r => { described.push(r); return answer(r, [title('d', 'Lisbon Job')], { state: 'ready' }); },
    });
    search.setQuery('films about a heist');
    expect(state().descriptive.status).toBe('loading');
    jest.advanceTimersByTime(400);
    search.setQuery('films about a heist in Lisbon');
    jest.advanceTimersByTime(599);
    await settle();
    expect(described).toHaveLength(0);
    jest.advanceTimersByTime(1);
    await settle();
    expect(described.map(r => r.query)).toEqual(['films about a heist in Lisbon']);
    expect(state().descriptive).toMatchObject({ status: 'ready', canRetry: false });
    expect(state().descriptive.items.map(c => c.name)).toEqual(['Lisbon Job']);
  });

  test('partial answers stay loading while the server will be asked again; the final one shows', async () => {
    const replies: V.DescriptiveSearchState[] = [
      { state: 'pending', retry: { allowed: true, afterSeconds: 2 } },
      { state: 'partial', retry: { allowed: true, afterSeconds: 0.2 } },
      { state: 'ready' },
    ];
    let asked = 0;
    const { search, state } = harness({
      search: async r => answer(r, []),
      searchByDescription: async r => { const reply = replies[asked]!; asked++; return answer(r, [title(`t${asked}`)], reply); },
    });
    search.setQuery('quiet space drama');
    jest.advanceTimersByTime(600);
    await settle();
    expect(asked).toBe(1);
    expect(state().descriptive).toMatchObject({ status: 'loading', items: [] });

    // The server asked for two seconds.
    jest.advanceTimersByTime(1999);
    await settle();
    expect(asked).toBe(1);
    jest.advanceTimersByTime(1);
    await settle();
    expect(asked).toBe(2);
    // A partial answer is not shown in turn.
    expect(state().descriptive).toMatchObject({ status: 'loading', items: [] });

    // Sub-second waits round up to one second.
    jest.advanceTimersByTime(1000);
    await settle();
    expect(asked).toBe(3);
    expect(state().descriptive.status).toBe('ready');
    expect(state().descriptive.items.map(c => c.id)).toEqual(['t3']);
    expect(state().ai.status).toBe('idle');
  });

  test('a partial answer the server will not refine is shown as final', async () => {
    const { search, state } = harness({
      search: async r => answer(r, []),
      searchByDescription: async r => answer(r, [title('p')], { state: 'partial', retry: { allowed: false } }),
    });
    search.setQuery('heist');
    jest.advanceTimersByTime(600);
    await settle();
    expect(state().descriptive.status).toBe('ready');
    expect(state().descriptive.items.map(c => c.id)).toEqual(['p']);
  });

  test('a busy server that does not allow asking again fails without a retry', async () => {
    const { search, state } = harness({
      search: async r => answer(r, []),
      searchByDescription: async r => answer(r, [], { state: 'busy', retry: { allowed: false } }),
    });
    search.setQuery('heist');
    jest.advanceTimersByTime(600);
    await settle();
    expect(state().descriptive).toMatchObject({ status: 'failed', canRetry: false });
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(state().descriptive.canRetry).toBe(false);
  });

  test('a failure that allows retrying offers it after the backoff, and retrying asks again', async () => {
    let asked = 0;
    const { search, state } = harness({
      search: async r => answer(r, []),
      searchByDescription: async r => {
        asked++;
        return asked === 1 ? answer(r, [], { state: 'failed', retry: { allowed: true, afterSeconds: 3 } }) : answer(r, [title('ok')], { state: 'ready' });
      },
    });
    search.setQuery('heist');
    search.retryDescriptive();
    jest.advanceTimersByTime(600);
    await settle();
    expect(state().descriptive).toMatchObject({ status: 'failed', canRetry: false });
    search.retryDescriptive();
    await settle();
    expect(asked).toBe(1);
    jest.advanceTimersByTime(3000);
    await settle();
    expect(state().descriptive.canRetry).toBe(true);
    search.retryDescriptive();
    await settle();
    expect(asked).toBe(2);
    expect(state().descriptive).toMatchObject({ status: 'ready', canRetry: false });
  });

  test('a new query cancels the old query\'s pending retries', async () => {
    const described: string[] = [];
    const { search } = harness({
      search: async r => answer(r, []),
      searchByDescription: async r => { described.push(r.query); return answer(r, [], { state: 'pending', retry: { allowed: true, afterSeconds: 5 } }); },
    });
    search.setQuery('first');
    jest.advanceTimersByTime(600);
    await settle();
    search.setQuery('');
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(described).toEqual(['first']);
  });

  test('a session reset clears search', async () => {
    const { search, state, reset } = harness({ search: async r => answer(r, [title('a')]) }, false);
    search.setQuery('a');
    await settle();
    reset();
    expect(state()).toEqual(initialSearch);
  });
});


test('controls are capability gated, cancel old work and reset lane cursors', async () => {
  const calls: { r: Request; signal?: AbortSignal }[] = [];
  const { search, state } = harness({ search: async (r, signal) => {
    calls.push({ r, signal });
    return { ...answer(r, [title(r.cursor ? 'second' : 'first')]), nextCursor: r.cursor ? undefined : 'page2' };
  } }, false, { searchSorts: [{ id: 'title', directions: ['asc', 'desc'] }], searchKinds: ['movie'] });
  search.setQuery('film'); await settle();
  search.more(); await settle();
  expect(calls[1].r.cursor).toBe('page2');
  expect(state().fast.items.map(x => x.id)).toEqual(['first', 'second']);
  search.setOptions({ sort: 'title', direction: 'desc', kind: 'movie' }); await settle();
  expect(calls[0].signal?.aborted).toBe(true);
  expect(calls[2].r).toMatchObject({ sort: 'title', direction: 'desc', kind: 'movie', generation: 2 });
  expect(calls[2].r.cursor).toBeUndefined();
  search.setOptions({ sort: 'popularity', direction: 'asc', kind: 'show' }); await settle();
  expect(calls.at(-1)?.r.sort).toBe('title');
  expect(calls.at(-1)?.r.kind).toBeUndefined();
});

test('older servers never receive unsupported search controls', async () => {
  const calls: Request[] = [];
  const { search } = harness({ search: async r => { calls.push(r); return answer(r, []); } }, false);
  search.setQuery('film'); await settle();
  search.setOptions({ sort: 'rating', kind: 'movie' }); await settle();
  expect(calls).toHaveLength(1);
  expect(calls[0].sort).toBeUndefined();
});

test('both search modes receive the same options', async () => {
  const descriptions: Request[] = [];
  const { search } = harness({ search: async r => answer(r, []), searchByDescription: async r => {
    descriptions.push(r); return answer(r, []);
  } }, true, { searchSorts: [{ id: 'rating', directions: ['desc'] }], searchKinds: ['show'] });
  search.setQuery('space drama');
  search.setOptions({ sort: 'rating', direction: 'asc', kind: 'show' });
  jest.advanceTimersByTime(600); await settle();
  expect(descriptions).toHaveLength(1);
  expect(descriptions[0]).toMatchObject({ generation: 2, sort: 'rating', direction: 'desc', kind: 'show' });
});


test('plugin kind and sort IDs pass through unchanged', async () => {
  const calls: Request[] = [];
  const { search, state } = harness({ search: async r => { calls.push(r); return answer(r, []); } }, false,
    { searchKinds: [{ id: 'game', label: 'Video games' }], searchSorts: [{ id: 'play_time', label: 'Play time', directions: ['desc'] }] });
  search.setOptions({ kind: 'game', sort: 'play_time' });
  search.setQuery('portal'); await settle();
  expect(calls[0]).toMatchObject({ kind: 'game', sort: 'play_time', direction: 'desc' });
  expect(state().searchKinds).toEqual([{ id: 'game', label: 'Video games' }]);
});

test('a late page from the old sort cannot replace the new generation', async () => {
  const pending: ((answer: V.SearchResponse) => void)[] = [];
  const requests: Request[] = [];
  const { search, state } = harness({ search: r => { requests.push(r); return new Promise(resolve => pending.push(resolve)); } }, false,
    { searchSorts: [{ id: 'title', directions: ['asc', 'desc'] }] });
  search.setQuery('film'); await settle();
  search.setOptions({ direction: 'desc' }); await settle();
  pending[1](answer(requests[1], [title('new')])); await settle();
  pending[0]({ ...answer(requests[0], [title('old')]), nextCursor: 'stale' }); await settle();
  expect(state().fast.items.map(x => x.id)).toEqual(['new']);
  expect(state().fast.nextCursor).toBeUndefined();
});


test('library changes abort old requests, reset paging and survive kind and sort changes', async () => {
  const calls: Request[] = [];
  const signals: AbortSignal[] = [];
  const { search, state } = harness({ search: async (r, signal) => {
    calls.push(r); signals.push(signal!);
    return { ...answer(r, [title(r.library ?? 'all')]), nextCursor: 'next', continuation: 'more' };
  } }, false, { searchLibraries: true, searchKinds: ['movie'], searchSorts: [{ id: 'title', directions: ['asc', 'desc'] }] });
  search.setQuery('heat'); await settle();
  search.more(); await settle();
  search.setOptions({ library: 'movies' });
  expect(signals[0]!.aborted).toBe(true);
  expect(state().fast.nextCursor).toBeUndefined();
  expect(state().fast.items).toEqual([]);
  await settle();
  expect(calls.at(-1)).toMatchObject({ library: 'movies', generation: 2 });
  expect(calls.at(-1)!.cursor).toBeUndefined();
  search.setOptions({ kind: 'movie', direction: 'desc' }); await settle();
  expect(calls.at(-1)).toMatchObject({ library: 'movies', kind: 'movie', direction: 'desc', generation: 3 });
  search.setOptions({ library: 'invisible' }); await settle();
  expect(calls.at(-1)!.library).toBeUndefined();
  search.setOptions({ library: 'shows' }); await settle();
  search.clear();
  expect(state().library).toBeUndefined();
  search.setQuery('heat'); await settle();
  expect(calls.at(-1)!.library).toBeUndefined();
});

test('library options are ignored without server support', async () => {
  const { search, state } = harness({ search: async r => answer(r, []) }, false);
  search.setQuery('heat'); await settle();
  search.setOptions({ library: 'movies' });
  expect(state().generation).toBe(1);
  expect(state().library).toBeUndefined();
});
