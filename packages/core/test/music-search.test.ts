// The audio app's search: a second Search answering in its own slice (musicSearch), kept to one
// library where the server can scope search, and unscoped (state.library unset) where it cannot.
import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { Search, initialSearch, type SearchState } from '../src/store/search';
import { StateBox } from '../src/store/state';
import type { Session } from '../src/store/session';
import type { VelaState } from '../src/store';
import type * as V from '../src/wire';

type Request = Omit<V.SearchRequest, 'mode'>;
const title = (id: string): V.Title => ({ id, kind: 'show', name: id, summary: '', genres: [], artwork: [] });
const answer = (r: Request, items: V.Title[]): V.SearchResponse => ({ query: r.query, generation: r.generation, items, continuation: 'exhausted' });

function harness(caps: Pick<V.ServerCapabilities, 'searchLibraries'> | undefined, options: { unified?: boolean; fetchedCaps?: V.ServerCapabilities } = {}) {
  const calls: (Request & { mode: string })[] = [];
  const search = async (r: Request) => { calls.push({ ...r, mode: 'fast' }); return answer(r, [title(r.library ?? 'everywhere')]); };
  const searchAuto = async (r: Request) => { calls.push({ ...r, mode: 'auto' }); return { ...answer(r, [title(r.library ?? 'everywhere')]), match: 'title' as const, state: 'complete' as const }; };
  const adapter = { search, ...(options.unified ? { searchAuto } : {}), ...(options.fetchedCaps ? { describe: async () => options.fetchedCaps } : {}) };
  const connection = { adapter, images: async () => ({ origin: 'https://server.example' }) };
  const session = {
    searchCapabilities: caps,
    features: options.fetchedCaps ? undefined : { descriptiveSearch: { available: false }, ...(options.unified ? { unifiedSearch: { available: true } } : {}) },
    selected: () => connection,
    ready: async () => connection,
    key: () => crypto.randomUUID(),
    onReset: () => () => {},
  } as unknown as Session;
  const box = new StateBox({ search: initialSearch, musicSearch: initialSearch, libraries: { value: [{ id: 'music' }, { id: 'films' }] } } as unknown as VelaState);
  const music = new Search(box, session, () => 400, 0, 'musicSearch');
  return { music, calls, box, state: (): SearchState => box.get().musicSearch, app: (): SearchState => box.get().search };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('the audio app searches in its own slice, leaving the app search and its query alone', async () => {
  const { music, state, app } = harness({ searchLibraries: true });
  music.scopeTo('music');
  music.setQuery('coldplay');
  await settle();
  expect(state()).toMatchObject({ query: 'coldplay', library: 'music', fast: { status: 'ready' } });
  expect(state().fast.items.map(c => c.id)).toEqual(['music']);
  expect(app()).toBe(initialSearch);
});

test('every query is kept to the library, even after clearing the field', async () => {
  const { music, calls } = harness({ searchLibraries: true });
  music.scopeTo('music');
  music.setQuery('a');
  await settle();
  music.setQuery('');
  music.setQuery('ab');
  await settle();
  expect(calls.map(c => c.library)).toEqual(['music', 'music']);
});

test('a unified server is asked in auto mode, scoped', async () => {
  const { music, calls, state } = harness({ searchLibraries: true }, { unified: true });
  music.scopeTo('music');
  music.setQuery('rumours');
  await settle();
  expect(calls).toEqual([expect.objectContaining({ mode: 'auto', library: 'music', query: 'rumours' })]);
  expect(state().match).toBe('title');
});

test('a server that cannot scope search is asked unscoped, and the state says so', async () => {
  const { music, calls, state } = harness({ searchLibraries: false });
  music.scopeTo('music');
  music.setQuery('coldplay');
  await settle();
  expect(calls[0]!.library).toBeUndefined();
  expect(state().library).toBeUndefined();
  expect(state().fast.status).toBe('ready');
});

test('a library the server does not list is not sent', async () => {
  const { music, calls, state } = harness({ searchLibraries: true });
  music.scopeTo('gone');
  music.setQuery('x');
  await settle();
  expect(calls[0]!.library).toBeUndefined();
  expect(state().library).toBeUndefined();
});

test('a first query before the server\'s controls are known still goes scoped once they are fetched', async () => {
  const fetchedCaps = { searchLibraries: true, features: { descriptiveSearch: { available: false } } } as unknown as V.ServerCapabilities;
  const { music, calls, state } = harness(undefined, { fetchedCaps });
  music.scopeTo('music');
  music.setQuery('coldplay');
  await settle();
  expect(calls[0]!.library).toBe('music');
  expect(state().library).toBe('music');
});

test('a changed scope asks the open query again for the new library', async () => {
  const { music, calls } = harness({ searchLibraries: true });
  music.scopeTo('music');
  music.setQuery('x');
  await settle();
  music.scopeTo('films');
  await settle();
  expect(calls.map(c => c.library)).toEqual(['music', 'films']);
});

