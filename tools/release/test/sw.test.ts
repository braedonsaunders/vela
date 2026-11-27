// The release service worker's offline launch (docs/downloads.md): offline Downloads and Watch open
// the verified app only once its whole offline copy is complete; every other route still gets
// offline.html; PRECACHE_OFFLINE and RELEASE_OFFLINE come only from the app's own origin; every
// cached byte is digest-verified; API, media and metadata are never cached; an update drops the old copy.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORIGIN = 'https://ether.example';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const files: Record<string, string> = {
  '/vela/offline.html': 'OFFLINE',
  '/vela/index.html': 'APP',
  '/vela/_expo/static/js/web/entry-1.js': 'ENTRY',
  '/vela/player/d1/engine.wasm': 'WASM',
};

function shell(version = '1.0.0', overrides: Partial<Record<string, string>> = {}) {
  const body = (path: string) => overrides[path] ?? files[path]!;
  return {
    version, digest: sha(version), offlineUrl: '/vela/offline.html',
    routes: ['/vela', '/vela/downloads', '/vela/watch/:id', '/vela/title/:id'],
    files: [{ url: '/vela/offline.html', sha256: sha(files['/vela/offline.html']!) }],
    offline: { entry: { url: '/vela/index.html', sha256: sha(body('/vela/index.html')) }, routes: ['/vela/downloads', '/vela/watch/:id'] },
    staticFiles: ['/vela/_expo/static/js/web/entry-1.js', '/vela/player/d1/engine.wasm'].map(url => ({ url, sha256: sha(body(url)) })),
  };
}

/** A minimal service worker global: Cache Storage, fetch against a routable network, and events. */
function worker(shellValue: ReturnType<typeof shell>, storage = new Map<string, Map<string, Response>>()) {
  const listeners: Record<string, ((event: any) => void)[]> = {};
  const network = { online: true, served: new Map(Object.entries(files)), fetched: [] as string[], failAt: '' };
  const cacheOf = (name: string) => {
    let entries = storage.get(name);
    if (!entries) storage.set(name, entries = new Map());
    const key = (input: Request | string) => new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
    return {
      match: async (input: Request | string) => entries!.get(key(input))?.clone(),
      put: async (input: Request | string, response: Response) => { entries!.set(key(input), response); },
    };
  };
  const caches = {
    open: async (name: string) => cacheOf(name),
    has: async (name: string) => storage.has(name),
    delete: async (name: string) => storage.delete(name),
    keys: async () => [...storage.keys()],
  };
  const fetchStub = async (input: Request | string) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    network.fetched.push(url.pathname);
    if (!network.online || (network.failAt && url.pathname === network.failAt)) throw new TypeError('Failed to fetch');
    const body = network.served.get(url.pathname);
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: any) => void) => { (listeners[type] ??= []).push(fn); },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const source = readFileSync(join(import.meta.dir, '../sw.js'), 'utf8')
    .replace('const shell = __VELA_SHELL__;', `const shell = ${JSON.stringify(shellValue)};`);
  new Function('self', 'caches', 'fetch', 'crypto', source)(self, caches, fetchStub, globalThis.crypto);
  const dispatch = async (type: string, event: any) => {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    for (const fn of listeners[type] ?? []) fn({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (r: Promise<Response>) => { response = r; } });
    await Promise.allSettled(waits);
    return response ? await response : undefined;
  };
  const navigate = (path: string) => dispatch('fetch', { request: new Request(ORIGIN + path, { mode: 'navigate' as RequestMode }) });
  const get = (path: string) => dispatch('fetch', { request: new Request(ORIGIN + path) });
  const message = (type: string, from: string | null = `${ORIGIN}/vela/downloads`) => dispatch('message', { data: { type }, source: from === null ? null : { url: from } });
  return { storage, network, dispatch, navigate, get, message };
}

describe('release service worker offline launch', () => {
  test('offline Downloads and Watch open the app only after a complete offline copy; other routes get offline.html', async () => {
    const w = worker(shell());
    await w.dispatch('install', {});
    await w.dispatch('activate', {});
    w.network.online = false;
    expect(await (await w.navigate('/vela/downloads'))!.text()).toBe('OFFLINE');
    w.network.online = true;
    await w.message('PRECACHE_OFFLINE');
    w.network.online = false;
    expect(await (await w.navigate('/vela/downloads'))!.text()).toBe('APP');
    expect(await (await w.navigate('/vela/watch/101'))!.text()).toBe('APP');
    expect(await (await w.navigate('/vela/title/101'))!.text()).toBe('OFFLINE');
    expect(await (await w.navigate('/vela'))!.text()).toBe('OFFLINE');
    expect(await (await w.get('/vela/player/d1/engine.wasm'))!.text()).toBe('WASM');
    expect(await (await w.get('/vela/_expo/static/js/web/entry-1.js'))!.text()).toBe('ENTRY');
  });

  test('PRECACHE_OFFLINE and RELEASE_OFFLINE are refused from another origin', async () => {
    const w = worker(shell());
    await w.dispatch('install', {});
    await w.message('PRECACHE_OFFLINE', 'https://evil.example/vela/downloads');
    await w.message('PRECACHE_OFFLINE', null as unknown as string);
    expect([...w.storage.keys()].some(name => name.startsWith('vela-offline-'))).toBe(false);
    await w.message('PRECACHE_OFFLINE');
    await w.message('RELEASE_OFFLINE', 'https://evil.example/');
    expect([...w.storage.keys()].some(name => name.startsWith('vela-offline-'))).toBe(true);
    // Deleting the last download releases the copy.
    await w.message('RELEASE_OFFLINE');
    expect([...w.storage.keys()].some(name => name.startsWith('vela-offline-'))).toBe(false);
  });

  test('a byte that fails its digest, or a copy cut short, is never kept or served', async () => {
    const w = worker(shell());
    await w.dispatch('install', {});
    w.network.served.set('/vela/player/d1/engine.wasm', 'TAMPERED');
    await w.message('PRECACHE_OFFLINE');
    expect([...w.storage.keys()].some(name => name.startsWith('vela-offline-'))).toBe(false);
    w.network.served.set('/vela/player/d1/engine.wasm', 'WASM');
    w.network.failAt = '/vela/player/d1/engine.wasm';
    await w.message('PRECACHE_OFFLINE');
    expect([...w.storage.keys()].some(name => name.startsWith('vela-offline-'))).toBe(false);
    // A copy interrupted mid-way (the worker stopped) has no completion mark, so it is never served.
    const partial = new Map([[`${ORIGIN}/vela/index.html`, new Response('APP')]]);
    w.storage.set(`vela-offline-1.0.0-${sha('1.0.0')}`, partial);
    w.network.online = false;
    w.network.failAt = '';
    expect(await (await w.navigate('/vela/downloads'))!.text()).toBe('OFFLINE');
  });

  test('API, session, media and metadata URLs are never cached, even with an offline copy', async () => {
    const w = worker(shell());
    await w.dispatch('install', {});
    await w.message('PRECACHE_OFFLINE');
    for (const path of ['/vela/v0/titles/1', '/sessions/abc', '/vela/v0/download/ticket', '/vela/skins/catalog.json', '/library/parts/9/file.mkv']) {
      expect(await w.get(path)).toBeUndefined();
    }
    expect(await w.dispatch('fetch', { request: new Request('https://plex.example/vela/index.html') })).toBeUndefined();
    const cached = [...w.storage.values()].flatMap(cache => [...cache.keys()].map(url => new URL(url).pathname));
    expect(cached.sort()).toEqual(['/vela/.offline-complete', '/vela/_expo/static/js/web/entry-1.js', '/vela/index.html', '/vela/offline.html', '/vela/player/d1/engine.wasm']);
  });

  test("a new release's worker removes the old offline copy and does not refill it on its own", async () => {
    const storage = new Map<string, Map<string, Response>>();
    const old = worker(shell('1.0.0'), storage);
    await old.dispatch('install', {});
    await old.dispatch('activate', {});
    await old.message('PRECACHE_OFFLINE');
    expect([...storage.keys()].filter(name => name.startsWith('vela-offline-'))).toEqual([`vela-offline-1.0.0-${sha('1.0.0')}`]);
    const next = worker(shell('1.1.0', { '/vela/index.html': 'APP2' }), storage);
    next.network.served.set('/vela/index.html', 'APP2');
    await next.dispatch('install', {});
    await next.dispatch('activate', {});
    expect([...storage.keys()].sort()).toEqual([`vela-shell-1.1.0-${sha('1.1.0')}`]);
    next.network.online = false;
    expect(await (await next.navigate('/vela/downloads'))!.text()).toBe('OFFLINE');
    next.network.online = true;
    await next.message('PRECACHE_OFFLINE');
    next.network.online = false;
    expect(await (await next.navigate('/vela/downloads'))!.text()).toBe('APP2');
  });
});
