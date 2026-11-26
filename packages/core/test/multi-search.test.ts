import { expect, test } from 'bun:test';
import type { Connection } from '../src/adapter/connection';
import type { CatalogueSearch } from '../src/adapter';
import { initialAuth } from '../src/store/auth';
import { Catalogue } from '../src/store/catalogue';
import type { VelaState } from '../src/store';
import { searchDeadline, SearchTimeout, searchServers } from '../src/store/multi-search';
import { initialSearch, Search } from '../src/store/search';
import { initialServers } from '../src/store/servers';
import type { Session } from '../src/store/session';
import { idle, StateBox } from '../src/store/state';

function fixture() {
  const box = new StateBox({
    auth: { ...initialAuth, phase: 'signed-in', crossServerSearch: true, viewerId: 'viewer-a', serverId: 'a' },
    servers: { ...initialServers, selectedId: 'a', list: ['a', 'b'].map(id => ({
      id, name: id.toUpperCase(), status: 'ready', origin: `https://${id}.example`, selected: id === 'a',
    })) },
    search: initialSearch, home: {}, titles: {}, related: {}, rows: {}, library: {}, collections: {}, libraries: idle(),
  } as unknown as VelaState);
  const reply = ({ query, generation }: CatalogueSearch) => ({
    generation, items: [{ id: '42', kind: 'movie', name: query, genres: [], artwork: [] }],
  });
  const viewers = { a: 'viewer-a', b: 'viewer-b' };
  const writes: string[] = [];
  const requests: { id: string; request: CatalogueSearch }[] = [];
  let failB = false;
  let pauseB: Promise<void> | undefined;
  const connections = Object.fromEntries((['a', 'b'] as const).map(id => [id, {
    record: { id },
    credentials: { get: async () => ({ viewer: { id: viewers[id], policyRevision: '1' } }) },
    images: async () => ({ origin: `https://${id}.example` }),
    adapter: {
      async search(request: CatalogueSearch) {
        requests.push({ id, request });
        if (id === 'b') {
          await pauseB;
          if (failB) throw new Error('Unavailable');
        }
        return { ...reply(request), nextCursor: id === 'a' && !request.cursor ? 'next-a' : undefined };
      },
      titleActions() {},
      async setTitleWatch(title: string) { writes.push(`${id}:${viewers[id]}:${title}`); },
    },
  }])) as unknown as Record<string, Connection>;
  let selected = 'a';
  const resets: (() => void)[] = [];
  const session = {
    epoch: 0, onReset: (fn: () => void) => resets.push(fn),
    key: () => crypto.randomUUID(),
    connection: (id: string) => connections[id]!,
    selected: () => connections[selected]!,
    ready: async () => connections[selected]!,
    tokens: (connection: Connection) => connection.credentials.get(),
    select(id: string) {
      selected = id;
      this.epoch++;
      for (const reset of resets) reset();
    },
  };
  const search = new Search(box, session as unknown as Session, () => 960, 0);
  const catalogue = new Catalogue(box, session as unknown as Session, () => 960);
  catalogue.title = async () => {};
  return {
    search, catalogue, box, session, viewers, writes, requests,
    fail: (value: boolean) => { failB = value; },
    pause: () => {
      const reply = Promise.withResolvers<void>();
      pauseB = reply.promise;
      return () => { pauseB = undefined; reply.resolve(); };
    },
  };
}

const settle = () => Bun.sleep(0);

test('each server publishes independently and retries or pages with its own cursor', async () => {
  const f = fixture();
  const resume = f.pause();
  f.fail(true);
  f.search.setAll(true);
  f.search.setQuery('Heat');
  await settle();
  expect(f.box.get().search.sections?.map(s => s.status)).toEqual(['ready', 'loading']);
  resume();
  await settle();
  expect(f.box.get().search.sections?.map(s => s.status)).toEqual(['ready', 'failed']);
  f.fail(false);
  f.search.serverPage('b');
  f.search.serverPage('a');
  await settle();
  const sections = f.box.get().search.sections!;
  expect(sections.map(s => s.results.map(r => [r.card.id, r.viewer]))).toEqual([[['42', 'viewer-a']], [['42', 'viewer-b']]]);
  expect(sections[0]?.results[0]?.ref).not.toBe(sections[1]?.results[0]?.ref);
  expect(f.requests.map(({ id, request }) => [id, request.cursor])).toEqual([['a', undefined], ['b', undefined], ['b', undefined], ['a', 'next-a']]);
});

test('a new query drops late results and a changed viewer cannot open a stale result', async () => {
  const f = fixture();
  const resume = f.pause();
  f.search.setAll(true);
  f.search.setQuery('Old');
  await settle();
  f.search.setQuery('New');
  resume();
  await settle();
  const sections = f.box.get().search.sections!;
  expect(sections.map(s => s.results[0]?.card.name)).toEqual(['New', 'New']);
  f.viewers.b = 'another-viewer';
  await f.search.openResult(sections[1]!.results[0]!.ref, () => { throw new Error('Unexpected open'); });
  expect(f.session.selected().record.id).toBe('a');
});

test('opening a remote result routes a played write through its server and viewer', async () => {
  const f = fixture();
  f.search.setAll(true);
  f.search.setQuery('Heat');
  await settle();
  const remote = f.box.get().search.sections![1]!.results[0]!;
  let write: Promise<void> | undefined;
  await f.search.openResult(remote.ref, card => { write = f.catalogue.setTitleWatch(card.id, { played: true }); });
  expect(write).toBeDefined();
  await write;
  expect(f.writes).toEqual(['b:viewer-b:42']);
  expect(f.box.get().search.sections).toBeUndefined();
});

test('unknown access and a signed-out server never qualify for all-server search', () => {
  const { box } = fixture();
  const state = box.get();
  expect(searchServers({ ...state, auth: { ...state.auth, crossServerSearch: undefined } })).toEqual([]);
  expect(searchServers({ ...state, servers: { ...state.servers, list: state.servers.list.map(server => ({
    ...server, status: server.id === 'b' ? 'signed-out' : 'unreachable',
  })) } }).map(server => server.id)).toEqual(['a']);
});

test('a deadline aborts an unresponsive server and parent cancellation wins immediately', async () => {
  const controller = new AbortController();
  let signal: AbortSignal | undefined;
  const never = (request: AbortSignal) => { signal = request; return new Promise<void>(() => {}); };
  await expect(searchDeadline(controller.signal, 5, never)).rejects.toBeInstanceOf(SearchTimeout);
  expect(signal?.aborted).toBe(true);
  const pending = searchDeadline(controller.signal, 5000, never);
  controller.abort(new Error('New query'));
  await expect(pending).rejects.toThrow('New query');
  expect(signal?.aborted).toBe(true);
});
