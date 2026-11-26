// Direct Plex server relocation: when a directly linked Plex server's saved address stops
// answering, Vela asks plex.tv for its current HTTPS addresses by machineIdentifier, proves
// identity + library access with the stored server token (never sending the account token to a
// candidate), updates the record in place, and resets once.
import { afterEach, describe, expect, test } from 'bun:test';
import { PlexAdapter } from '../src/adapter/plex';
import {
  findWorkingPlexOrigin,
  isUnreachableError,
  isValidLibrarySectionsResponse,
  markPlexUnreachable,
  probePlexCandidate,
  relocationCandidates,
} from '../src/adapter/plex/relocate';
import { VelaError } from '../src/adapter/errors';
import { fetchBounded, fetchTextBounded, readJsonBody } from '../src/protocol/timeout';
import { ServerCredentials, ServerRegistry } from '../src/session/servers';
import { createVela, type VelaOptions } from '../src/store';
import { isPlaybackActive, PlexRelocator } from '../src/store/plex-relocate';
import type { Session } from '../src/store/session';
import { MemoryStore, device, restoreFetch, tokens } from './helpers';

afterEach(restoreFetch);

const OLD_ORIGIN = 'https://192-168-1-10.old.plex.direct:32400';
const NEW_DIRECT = 'https://192-168-1-20.new.plex.direct:32400';
const CUSTOM_HTTPS = 'https://plex.home.example';
const RELAY_ORIGIN = 'https://192-168-1-20.relay.plex.direct:8443';
const MACHINE = 'machine-abc-123';

function platform(store: MemoryStore): VelaOptions {
  return {
    appVersion: '0.1.0',
    rendererVersion: 1,
    artWidth: 1280,
    device: { name: 'Test Browser', platform: 'web' },
    secrets: store,
    media: Promise.resolve({
      containers: ['mp4'],
      videoCodecs: ['h264'],
      audioCodecs: ['aac'],
      subtitleFormats: [],
      maxResolution: { width: 1920, height: 1080 },
      hdr: [],
      hls: true,
      mse: true,
    }),
  };
}

interface MockCall {
  method: string;
  url: URL;
  headers: Headers;
  signal: AbortSignal | undefined;
}

function mockFetch(handler: (call: MockCall) => Response | Promise<Response>): MockCall[] {
  const calls: MockCall[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call: MockCall = {
      method: init?.method ?? 'GET',
      url,
      headers: new Headers(init?.headers),
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    return handler(call);
  };
  globalThis.fetch = Object.assign(fake, { preconnect: () => {} }) as typeof fetch;
  return calls;
}

function abortableWait(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
  });
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function seedPlexServer(
  store: MemoryStore,
  options: { origin?: string; machineIdentifier?: string; serverToken?: string; accountToken?: string | null; name?: string } = {},
) {
  const registry = new ServerRegistry(store);
  const record = registry.add('plex', options.name ?? 'Home Plex', options.origin ?? OLD_ORIGIN, options.machineIdentifier);
  registry.select(record.id);
  const creds = new ServerCredentials(store, device, () => 'k', record.id);
  await creds.set({
    accessToken: options.serverToken ?? 'server-token-1',
    refreshToken: '',
    expiresAt: '9999-12-31T23:59:59Z',
    viewer: { id: 'viewer-1', name: 'Owner', policyRevision: 'plex' },
  });
  if (options.accountToken !== null) {
    await creds.setPlexAccount(options.accountToken ?? 'account-token-1');
  }
  return { registry, record, creds };
}

describe('ServerRegistry machineIdentifier', () => {
  test('persists machineIdentifier on Plex records and preserves it on relocate', () => {
    const store = new MemoryStore();
    const reg = new ServerRegistry(store);
    const added = reg.add('plex', 'Living Room', OLD_ORIGIN, MACHINE);
    expect(added.machineIdentifier).toBe(MACHINE);

    const readBack = new ServerRegistry(store).get(added.id);
    expect(readBack.machineIdentifier).toBe(MACHINE);

    const relocated = reg.relocate(added.id, 'Living Room 2', NEW_DIRECT);
    expect(relocated.id).toBe(added.id);
    expect(relocated.origin).toBe(NEW_DIRECT);
    expect(relocated.machineIdentifier).toBe(MACHINE);
    expect(new ServerRegistry(store).get(added.id)).toMatchObject({
      id: added.id,
      origin: NEW_DIRECT,
      name: 'Living Room 2',
      machineIdentifier: MACHINE,
    });
  });

  test('rejects invalid or non-plex machineIdentifier on write and read', () => {
    const store = new MemoryStore();
    const reg = new ServerRegistry(store);
    expect(() => reg.add('jellyfin', 'JF', 'https://jf.example', MACHINE)).toThrow();
    expect(() => reg.add('plex', 'Bad Empty', OLD_ORIGIN, '   ')).toThrow();
    expect(() => reg.add('plex', 'Bad Space', OLD_ORIGIN, 'has space')).toThrow();
    expect(() => reg.add('plex', 'Too Long', OLD_ORIGIN, 'a'.repeat(129))).toThrow();

    // Older records without machineIdentifier remain valid and are not backfilled.
    const legacy = reg.add('plex', 'Legacy Plex', OLD_ORIGIN);
    expect(legacy.machineIdentifier).toBeUndefined();

    // Corrupt machineIdentifier in persisted storage is rejected by read().
    const raw = JSON.parse(store.get('vela.servers')!);
    raw.servers[0].machineIdentifier = 'bad value with spaces';
    store.set('vela.servers', JSON.stringify(raw));
    expect(() => reg.read()).toThrow('Invalid server record');
  });
});

describe('Bounded fetch body reads (Android stalled body protection)', () => {
  test('fetchTextBounded times out and cancels a stalled response body', async () => {
    let cancelled = false;
    mockFetch(() => new Response(new ReadableStream({
      start() { /* never enqueues or closes */ },
      cancel() { cancelled = true; },
    }), { status: 200 }));

    await expect(fetchTextBounded('https://stalled.example/test', { method: 'GET' }, 30))
      .rejects.toThrow('Request timed out');
    expect(cancelled).toBe(true);
  });

  test('fetchTextBounded aborts and cancels a stalled response body when caller signal aborts', async () => {
    let cancelled = false;
    mockFetch(() => new Response(new ReadableStream({
      start() { /* never closes */ },
      cancel() { cancelled = true; },
    }), { status: 200 }));

    const controller = new AbortController();
    const pending = fetchTextBounded('https://stalled.example/test', { method: 'GET' }, 5_000, controller.signal);
    setTimeout(() => controller.abort(), 15);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });

  test('fetchBounded + readJsonBody cancels a stalled JSON response body on timeout', async () => {
    let cancelled = false;
    mockFetch(() => new Response(new ReadableStream({
      start() { /* never closes */ },
      cancel() { cancelled = true; },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(fetchBounded('https://stalled.example/json', { method: 'GET' }, readJsonBody, 30))
      .rejects.toThrow('Request timed out');
    expect(cancelled).toBe(true);
  });
});

describe('Unreachable classification and candidate validation', () => {
  test('isUnreachableError distinguishes transport/timeout failures from HTTP errors and caller aborts', () => {
    expect(isUnreachableError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isUnreachableError(new Error('Request timed out'))).toBe(true);
    expect(isUnreachableError(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toBe(true);

    const custom = new Error('ECONNRESET');
    markPlexUnreachable(custom);
    expect(isUnreachableError(custom)).toBe(true);
    expect(isUnreachableError(custom, true)).toBe(false);

    expect(isUnreachableError(new VelaError({ class: 'auth', code: 'plex_http', message: 'denied', retry: { allowed: false } }, 401))).toBe(false);
    expect(isUnreachableError(new VelaError({ class: 'source', code: 'plex_http', message: 'busy', retry: { allowed: false } }, 503))).toBe(false);
    expect(isUnreachableError(new SyntaxError('Unexpected token <'))).toBe(false);
    expect(isUnreachableError(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe(false);
  });

  test('relocationCandidates ranks plex.direct first, custom HTTPS next, relays last, and filters invalid/excluded', () => {
    const candidates = relocationCandidates({
      connections: [
        { uri: 'http://192.168.1.20:32400', local: true, relay: false, protocol: 'http' },
        { uri: RELAY_ORIGIN, local: false, relay: true, protocol: 'https' },
        { uri: CUSTOM_HTTPS, local: false, relay: false, protocol: 'https' },
        { uri: `${NEW_DIRECT}/extra`, local: false, relay: false, protocol: 'https' },
        { uri: 'https://user:pass@evil.example', local: false, relay: false, protocol: 'https' },
        { uri: 'https://query.example/?a=1', local: false, relay: false, protocol: 'https' },
        { uri: OLD_ORIGIN, local: false, relay: false, protocol: 'https' },
        { uri: 'https://taken.plex.direct:32400', local: false, relay: false, protocol: 'https' },
        { uri: NEW_DIRECT, local: false, relay: false, protocol: 'https' },
        { uri: NEW_DIRECT, local: true, relay: false, protocol: 'https' },
      ],
    }, OLD_ORIGIN, new Set(['https://taken.plex.direct:32400']));

    expect(candidates).toEqual([NEW_DIRECT, CUSTOM_HTTPS, RELAY_ORIGIN]);
  });

  test('isValidLibrarySectionsResponse rejects HTML/empty/mismatched payloads and accepts valid MediaContainer', () => {
    expect(isValidLibrarySectionsResponse(null, MACHINE)).toBe(false);
    expect(isValidLibrarySectionsResponse('<html></html>', MACHINE)).toBe(false);
    expect(isValidLibrarySectionsResponse({}, MACHINE)).toBe(false);
    expect(isValidLibrarySectionsResponse({ MediaContainer: {} }, MACHINE)).toBe(false);
    expect(isValidLibrarySectionsResponse({ MediaContainer: { Directory: 'nope' } }, MACHINE)).toBe(false);
    expect(isValidLibrarySectionsResponse({ MediaContainer: { Directory: [null] } }, MACHINE)).toBe(false);
    expect(isValidLibrarySectionsResponse({ MediaContainer: { size: -1 } }, MACHINE)).toBe(false);
    expect(isValidLibrarySectionsResponse({ MediaContainer: { size: 0, machineIdentifier: 'other' } }, MACHINE)).toBe(false);

    expect(isValidLibrarySectionsResponse({ MediaContainer: { Directory: [] } }, MACHINE)).toBe(true);
    expect(isValidLibrarySectionsResponse({ MediaContainer: { size: 0 } }, MACHINE)).toBe(true);
    expect(isValidLibrarySectionsResponse({ MediaContainer: { machineIdentifier: MACHINE, Directory: [{ key: '1' }] } }, MACHINE)).toBe(true);
  });

  test('probePlexCandidate verifies /identity before sending serverToken and retries /identity on 401', async () => {
    // Mismatched identity: serverToken is NEVER sent to /library/sections or /identity.
    const mismatchCalls = mockFetch(({ url }) => {
      if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: 'wrong-machine' } });
      return Response.json({ MediaContainer: { Directory: [] } });
    });
    expect(await probePlexCandidate(NEW_DIRECT, MACHINE, 'srv-secret', device, 1_000)).toBe(false);
    expect(mismatchCalls.map(c => c.url.pathname)).toEqual(['/identity']);
    expect(mismatchCalls[0].headers.has('X-Plex-Token')).toBe(false);

    // Relay requiring auth on /identity: retries once with serverToken, then validates /library/sections.
    const relayCalls = mockFetch(({ url, headers }) => {
      if (url.pathname === '/identity') {
        if (headers.get('X-Plex-Token') !== 'srv-secret') return new Response('', { status: 401 });
        return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
      }
      if (url.pathname === '/library/sections') {
        expect(headers.get('X-Plex-Token')).toBe('srv-secret');
        return Response.json({ MediaContainer: { Directory: [{ key: '1', title: 'Movies' }] } });
      }
      return new Response('', { status: 404 });
    });
    expect(await probePlexCandidate(RELAY_ORIGIN, MACHINE, 'srv-secret', device, 1_000)).toBe(true);
    expect(relayCalls.map(c => [c.url.pathname, c.headers.get('X-Plex-Token')])).toEqual([
      ['/identity', null],
      ['/identity', 'srv-secret'],
      ['/library/sections', 'srv-secret'],
    ]);
  });

  test('findWorkingPlexOrigin never sends accountToken to candidates and respects overall deadline', async () => {
    const calls = mockFetch(async ({ url, headers, signal }) => {
      if (url.origin === 'https://plex.tv' && url.pathname === '/api/v2/resources') {
        expect(headers.get('X-Plex-Token')).toBe('acct-only-secret');
        return Response.json([{
          name: 'Renamed Home',
          clientIdentifier: MACHINE,
          accessToken: 'different-resource-token',
          provides: 'server',
          owned: true,
          connections: [
            { uri: 'https://bad-json.plex.direct:32400', local: false, relay: false, protocol: 'https' },
            { uri: 'https://refuses.plex.direct:32400', local: false, relay: false, protocol: 'https' },
            { uri: NEW_DIRECT, local: false, relay: false, protocol: 'https' },
          ],
        }]);
      }
      if (url.origin === 'https://bad-json.plex.direct:32400') {
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        return Response.json({ notPlex: true });
      }
      if (url.origin === 'https://refuses.plex.direct:32400') {
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        return new Response('', { status: 401 });
      }
      if (url.origin === NEW_DIRECT) {
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        if (url.pathname === '/library/sections') return Response.json({ MediaContainer: { Directory: [] } });
      }
      return abortableWait(signal);
    });

    const found = await findWorkingPlexOrigin({
      device,
      accountToken: 'acct-only-secret',
      serverToken: 'server-only-secret',
      machineIdentifier: MACHINE,
      currentOrigin: OLD_ORIGIN,
      deadlineMs: 2_000,
      candidateTimeoutMs: 500,
    });
    expect(found).toEqual({ origin: NEW_DIRECT, name: 'Renamed Home' });

    const candidateCalls = calls.filter(c => c.url.origin !== 'https://plex.tv');
    expect(candidateCalls.length).toBeGreaterThan(0);
    for (const c of candidateCalls) {
      expect(c.headers.get('X-Plex-Token')).not.toBe('acct-only-secret');
    }

    // Overall deadline bounds multiple slow candidates.
    const slowCalls = mockFetch(({ url, signal }) => {
      if (url.origin === 'https://plex.tv') {
        return Response.json([{
          name: 'Slow',
          clientIdentifier: MACHINE,
          accessToken: 't',
          provides: 'server',
          owned: true,
          connections: [
            { uri: 'https://slow1.plex.direct:32400', local: false, relay: false, protocol: 'https' },
            { uri: 'https://slow2.plex.direct:32400', local: false, relay: false, protocol: 'https' },
            { uri: 'https://slow3.plex.direct:32400', local: false, relay: false, protocol: 'https' },
          ],
        }]);
      }
      return abortableWait(signal);
    });
    const started = Date.now();
    const missed = await findWorkingPlexOrigin({
      device,
      accountToken: 'acct-only-secret',
      serverToken: 'server-only-secret',
      machineIdentifier: MACHINE,
      currentOrigin: OLD_ORIGIN,
      deadlineMs: 90,
      candidateTimeoutMs: 60,
    });
    expect(missed).toBeNull();
    expect(Date.now() - started).toBeLessThan(400);
    // Should not have had time to start all 3 candidates after hitting the 90ms overall deadline.
    expect(slowCalls.filter(c => c.url.origin !== 'https://plex.tv').length).toBeLessThanOrEqual(2);
  });
});

describe('Store relocation behaviour', () => {
  test('restore relocates an unreachable directly linked Plex server, keeps ID/session, resets once, and signs in', async () => {
    const store = new MemoryStore();
    const { record } = await seedPlexServer(store, { machineIdentifier: MACHINE });
    let resourcesCalls = 0;

    const calls = mockFetch(({ url, headers }) => {
      if (url.origin === OLD_ORIGIN) throw new TypeError('Failed to fetch');
      if (url.origin === 'https://plex.tv' && url.pathname === '/api/v2/resources') {
        resourcesCalls++;
        expect(headers.get('X-Plex-Token')).toBe('account-token-1');
        return Response.json([{
          name: 'Home Plex',
          clientIdentifier: MACHINE,
          accessToken: 'ignored-new-token',
          provides: 'server',
          owned: true,
          connections: [{ uri: NEW_DIRECT, local: false, relay: false, protocol: 'https' }],
        }]);
      }
      if (url.origin === NEW_DIRECT) {
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        if (url.pathname === '/') return Response.json({ MediaContainer: { friendlyName: 'Home Plex' } });
        if (url.pathname === '/library/sections') {
          expect(headers.get('X-Plex-Token')).toBe('server-token-1');
          return Response.json({ MediaContainer: { Directory: [] } });
        }
        if (url.pathname === '/hubs') return Response.json({ MediaContainer: { Hub: [] } });
      }
      return new Response('', { status: 404 });
    });

    const vela = createVela(platform(store));
    const startRevision = vela.getState().auth.revision;
    await vela.auth.start();

    expect(vela.getState().auth.phase).toBe('signed-in');
    expect(vela.getState().auth.serverId).toBe(record.id);
    expect(vela.getState().auth.revision).toBe(startRevision + 1);
    expect(resourcesCalls).toBe(1);

    const updated = new ServerRegistry(store).get(record.id);
    expect(updated.id).toBe(record.id);
    expect(updated.origin).toBe(NEW_DIRECT);
    expect(updated.machineIdentifier).toBe(MACHINE);

    const creds = new ServerCredentials(store, device, () => 'k', record.id);
    expect((await creds.get())?.accessToken).toBe('server-token-1');
    expect(await creds.plexAccount()).toBe('account-token-1');

    // Never sent accountToken to any server candidate.
    for (const c of calls.filter(x => x.url.origin !== 'https://plex.tv')) {
      expect(c.headers.get('X-Plex-Token')).not.toBe('account-token-1');
    }
  });

  test('HTTP refusals (401/503) and older records without machineIdentifier never call plex.tv', async () => {
    // 503 on saved address -> offline, no plex.tv lookup.
    const store503 = new MemoryStore();
    await seedPlexServer(store503, { machineIdentifier: MACHINE });
    let plexTvCalls = 0;
    mockFetch(({ url }) => {
      if (url.origin === 'https://plex.tv') { plexTvCalls++; return Response.json([]); }
      return new Response('unavailable', { status: 503 });
    });
    const vela503 = createVela(platform(store503));
    await vela503.auth.start();
    expect(vela503.getState().auth.phase).toBe('offline');
    expect(plexTvCalls).toBe(0);

    // 401 on saved address -> signed-out, no plex.tv lookup.
    const store401 = new MemoryStore();
    await seedPlexServer(store401, { machineIdentifier: MACHINE });
    mockFetch(({ url }) => {
      if (url.origin === 'https://plex.tv') { plexTvCalls++; return Response.json([]); }
      return new Response('unauthorized', { status: 401 });
    });
    const vela401 = createVela(platform(store401));
    await vela401.auth.start();
    expect(vela401.getState().auth.phase).toBe('signed-out');
    expect(plexTvCalls).toBe(0);

    // Older saved Plex record without machineIdentifier -> offline, no plex.tv lookup.
    const storeLegacy = new MemoryStore();
    await seedPlexServer(storeLegacy, { machineIdentifier: undefined });
    mockFetch(({ url }) => {
      if (url.origin === 'https://plex.tv') { plexTvCalls++; return Response.json([]); }
      throw new TypeError('Failed to fetch');
    });
    const velaLegacy = createVela(platform(storeLegacy));
    await velaLegacy.auth.start();
    expect(velaLegacy.getState().auth.phase).toBe('offline');
    expect(plexTvCalls).toBe(0);
  });

  test('same-server reset during validation does not trigger relocation or touch the record', async () => {
    const store = new MemoryStore();
    const { record } = await seedPlexServer(store, { machineIdentifier: MACHINE });
    const validateGate = deferred<void>();
    let plexTvCalls = 0;

    mockFetch(async ({ url }) => {
      if (url.origin === 'https://plex.tv') {
        plexTvCalls++;
        return Response.json([{
          name: 'Home Plex',
          clientIdentifier: MACHINE,
          accessToken: 't',
          provides: 'server',
          owned: true,
          connections: [{ uri: NEW_DIRECT, local: false, relay: false, protocol: 'https' }],
        }]);
      }
      if (url.origin === OLD_ORIGIN && url.pathname === '/library/sections') {
        await validateGate.promise;
        throw new TypeError('Failed to fetch');
      }
      return new Response('', { status: 404 });
    });

    const vela = createVela(platform(store));
    const starting = vela.auth.start();
    await new Promise(r => setTimeout(r, 15));

    // Trigger a same-server session reset while validateSession is in flight (e.g. sign-out/switch).
    const session = (vela.auth as unknown as { session: Session }).session;
    session.resetSession();
    validateGate.resolve();
    await starting;

    expect(plexTvCalls).toBe(0);
    expect(new ServerRegistry(store).get(record.id).origin).toBe(OLD_ORIGIN);
  });

  test('concurrent reads share one plex.tv lookup and reset once', async () => {
    const store = new MemoryStore();
    const { record } = await seedPlexServer(store, { machineIdentifier: MACHINE });
    let oldReachable = true;
    let resourcesCalls = 0;
    const resourcesGate = deferred<void>();

    mockFetch(async ({ url }) => {
      if (url.origin === OLD_ORIGIN) {
        if (!oldReachable) throw new TypeError('Failed to fetch');
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        if (url.pathname === '/') return Response.json({ MediaContainer: { friendlyName: 'Home Plex' } });
        if (url.pathname === '/library/sections') return Response.json({ MediaContainer: { Directory: [] } });
        if (url.pathname === '/hubs') return Response.json({ MediaContainer: { Hub: [] } });
      }
      if (url.origin === 'https://plex.tv' && url.pathname === '/api/v2/resources') {
        resourcesCalls++;
        await resourcesGate.promise;
        return Response.json([{
          name: 'Home Plex',
          clientIdentifier: MACHINE,
          accessToken: 't',
          provides: 'server',
          owned: true,
          connections: [{ uri: NEW_DIRECT, local: false, relay: false, protocol: 'https' }],
        }]);
      }
      if (url.origin === NEW_DIRECT) {
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        if (url.pathname === '/') return Response.json({ MediaContainer: { friendlyName: 'Home Plex' } });
        if (url.pathname === '/library/sections') return Response.json({ MediaContainer: { Directory: [] } });
        if (url.pathname === '/hubs') return Response.json({ MediaContainer: { Hub: [] } });
        if (url.pathname === '/library/metadata/42') return Response.json({ MediaContainer: { Metadata: [] } });
      }
      return new Response('', { status: 404 });
    });

    const vela = createVela(platform(store));
    await vela.auth.start();
    expect(vela.getState().auth.phase).toBe('signed-in');

    // Now the old address stops answering; multiple slices read concurrently.
    oldReachable = false;
    const revisionBefore = vela.getState().auth.revision;
    const closeView = vela.catalogue.view('42');
    vela.search.setQuery('matrix', true);
    const reads = Promise.allSettled([
      vela.home.load(),
      vela.home.libraries(),
    ]);

    await new Promise(r => setTimeout(r, 25));
    expect(resourcesCalls).toBe(1);
    resourcesGate.resolve();
    await reads;
    closeView();
    // Wait for Auth's async onReset refresh to settle revision.
    for (let i = 0; i < 40 && vela.getState().auth.revision === revisionBefore; i++) {
      await new Promise(r => setTimeout(r, 10));
    }

    expect(resourcesCalls).toBe(1);
    expect(vela.getState().auth.revision).toBe(revisionBefore + 1);
    expect(new ServerRegistry(store).get(record.id).origin).toBe(NEW_DIRECT);
  });

  test('closing a title view aborts a sole search without recording cool-down, but keeps a shared search alive', async () => {
    const store = new MemoryStore();
    const { record } = await seedPlexServer(store, { machineIdentifier: MACHINE });
    let oldReachable = true;
    let resourcesCalls = 0;
    let firstAborted = false;
    const secondGate = deferred<void>();

    mockFetch(async ({ url, signal }) => {
      if (url.origin === OLD_ORIGIN) {
        if (!oldReachable) throw new TypeError('Failed to fetch');
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        if (url.pathname === '/') return Response.json({ MediaContainer: { friendlyName: 'Home Plex' } });
        if (url.pathname === '/library/sections') return Response.json({ MediaContainer: { Directory: [] } });
        if (url.pathname === '/hubs') return Response.json({ MediaContainer: { Hub: [] } });
      }
      if (url.origin === 'https://plex.tv' && url.pathname === '/api/v2/resources') {
        resourcesCalls++;
        if (resourcesCalls === 1) {
          signal?.addEventListener('abort', () => { firstAborted = true; }, { once: true });
          return abortableWait(signal);
        }
        await secondGate.promise;
        return Response.json([{
          name: 'Home Plex',
          clientIdentifier: MACHINE,
          accessToken: 't',
          provides: 'server',
          owned: true,
          connections: [{ uri: NEW_DIRECT, local: false, relay: false, protocol: 'https' }],
        }]);
      }
      if (url.origin === NEW_DIRECT) {
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        if (url.pathname === '/library/sections') return Response.json({ MediaContainer: { Directory: [] } });
        if (url.pathname === '/') return Response.json({ MediaContainer: { friendlyName: 'Home Plex' } });
      }
      return new Response('', { status: 404 });
    });

    const vela = createVela(platform(store));
    await vela.auth.start();
    expect(vela.getState().auth.phase).toBe('signed-in');
    oldReachable = false;

    // 1. Sole reader (title view) starts relocation, then closes -> aborts immediately, NO cool-down.
    const closeSole = vela.catalogue.view('99');
    for (let i = 0; i < 40 && resourcesCalls < 1; i++) await new Promise(r => setTimeout(r, 10));
    expect(resourcesCalls).toBe(1);
    closeSole();
    await new Promise(r => setTimeout(r, 15));
    expect(firstAborted).toBe(true);
    expect(new ServerRegistry(store).get(record.id).origin).toBe(OLD_ORIGIN);

    // 2. Immediately after abort, another read can start a new search (no cool-down),
    // and closing a title view while Home is also reading does NOT abort the shared search.
    const homeRead = vela.home.load();
    const closeShared = vela.catalogue.view('100');
    for (let i = 0; i < 40 && resourcesCalls < 2; i++) await new Promise(r => setTimeout(r, 10));
    expect(resourcesCalls).toBe(2);
    closeShared();

    secondGate.resolve();
    await homeRead;
    expect(new ServerRegistry(store).get(record.id).origin).toBe(NEW_DIRECT);
  });

  test('cool-down suppresses repeated lookups after a genuine miss until cool-down elapses', async () => {
    const store = new MemoryStore();
    await seedPlexServer(store, { machineIdentifier: MACHINE });
    let clock = 10_000;
    let findCalls = 0;

    const vela = createVela(platform(store));
    const session = (vela.auth as unknown as { session: Session }).session;
    const box = (vela.auth as unknown as { box: ConstructorParameters<typeof PlexRelocator>[0] }).box;
    const relocator = new PlexRelocator(box, session, {
      cooldownMs: 60_000,
      now: () => clock,
      findOrigin: async () => {
        findCalls++;
        return null;
      },
    });
    session.setRelocator(relocator);

    const conn = session.selected();
    const err = new TypeError('Failed to fetch');

    expect(await session.relocatePlex(conn, session.epoch, err)).toBe(false);
    expect(findCalls).toBe(1);

    // Within cool-down: skipped without calling findOrigin.
    clock += 30_000;
    expect(await session.relocatePlex(conn, session.epoch, err)).toBe(false);
    expect(findCalls).toBe(1);

    // After cool-down: allowed again.
    clock += 31_000;
    expect(await session.relocatePlex(conn, session.epoch, err)).toBe(false);
    expect(findCalls).toBe(2);
  });

  test('pre-commit guards refuse to relocate when server, session, account, or playback changed', async () => {
    // Active video & audio phase checks
    expect(isPlaybackActive({ playback: { phase: 'playing' } as never, audio: { phase: 'idle' } as never })).toBe(true);
    expect(isPlaybackActive({ playback: { phase: 'starting' } as never, audio: { phase: 'idle' } as never })).toBe(true);
    expect(isPlaybackActive({ playback: { phase: 'preparing' } as never, audio: { phase: 'idle' } as never })).toBe(true);
    expect(isPlaybackActive({ playback: { phase: 'idle' } as never, audio: { phase: 'playing' } as never })).toBe(true);
    expect(isPlaybackActive({ playback: { phase: 'idle' } as never, audio: { phase: 'paused' } as never })).toBe(true);
    expect(isPlaybackActive({ playback: { phase: 'idle' } as never, audio: { phase: 'buffering' } as never })).toBe(true);
    expect(isPlaybackActive({ playback: { phase: 'idle' } as never, audio: { phase: 'idle' } as never })).toBe(false);

    const scenarios: Array<{
      name: string;
      mutate: (args: {
        store: MemoryStore;
        recordId: string;
        session: Session;
        box: ConstructorParameters<typeof PlexRelocator>[0];
      }) => Promise<void> | void;
    }> = [
      {
        name: 'active video playback started mid-search',
        mutate: ({ box }) => {
          box.update('playback', p => ({ ...p, phase: 'playing' }));
        },
      },
      {
        name: 'active audio playback started mid-search',
        mutate: ({ box }) => {
          box.update('audio', a => ({ ...a, phase: 'paused' }));
        },
      },
      {
        name: 'selected server switched mid-search',
        mutate: ({ session }) => {
          const other = session.servers.add('plex', 'Other', 'https://other.plex.direct:32400', 'other-machine');
          session.select(other.id);
        },
      },
      {
        name: 'stored session token/viewer changed mid-search',
        mutate: async ({ store, recordId }) => {
          const creds = new ServerCredentials(store, device, () => 'k', recordId);
          await creds.set(tokens('different-server-token', 'viewer-2'));
        },
      },
      {
        name: 'stored plexAccount changed mid-search',
        mutate: async ({ store, recordId }) => {
          const creds = new ServerCredentials(store, device, () => 'k', recordId);
          await creds.setPlexAccount('different-account-token');
        },
      },
      {
        name: 'epoch moved on mid-search',
        mutate: ({ session }) => {
          session.resetSession();
        },
      },
    ];

    for (const scenario of scenarios) {
      const store = new MemoryStore();
      const { record } = await seedPlexServer(store, { machineIdentifier: MACHINE });
      const vela = createVela(platform(store));
      const session = (vela.auth as unknown as { session: Session }).session;
      const box = (vela.auth as unknown as { box: ConstructorParameters<typeof PlexRelocator>[0] }).box;
      const gate = deferred<void>();

      session.setRelocator(new PlexRelocator(box, session, {
        findOrigin: async () => {
          await gate.promise;
          return { origin: NEW_DIRECT, name: 'Moved' };
        },
      }));

      const conn = session.selected();
      const epoch = session.epoch;
      const pending = session.relocatePlex(conn, epoch, new TypeError('Failed to fetch'));
      await new Promise(r => setTimeout(r, 10));
      await scenario.mutate({ store, recordId: record.id, session, box });
      gate.resolve();

      expect(await pending, scenario.name).toBe(false);
      expect(new ServerRegistry(store).get(record.id).origin, scenario.name).toBe(OLD_ORIGIN);
    }
  });

  test('Servers.plexChoose stores machineIdentifier and relocates an existing Plex record by machineIdentifier without duplicating', async () => {
    const store = new MemoryStore();
    const { record: existing } = await seedPlexServer(store, {
      origin: OLD_ORIGIN,
      machineIdentifier: MACHINE,
      name: 'Old Name',
    });

    mockFetch(({ url }) => {
      if (url.origin === 'https://plex.tv') {
        if (url.pathname === '/api/v2/pins') return Response.json({ id: 7, code: 'ABCD', expiresAt: '2099-01-01' });
        if (url.pathname === '/api/v2/pins/7') return Response.json({ authToken: 'fresh-account' });
        if (url.pathname === '/api/v2/home/users') return Response.json({ users: [{ id: 1, uuid: 'u1', title: 'Owner' }] });
        if (url.pathname === '/api/v2/user') return Response.json({ id: 1, uuid: 'u1', username: 'Owner' });
        if (url.pathname === '/api/v2/resources') {
          return Response.json([{
            name: 'New Name',
            clientIdentifier: MACHINE,
            accessToken: 'fresh-server-token',
            provides: 'server',
            owned: true,
            connections: [{ uri: NEW_DIRECT, local: false, relay: false, protocol: 'https' }],
          }]);
        }
      }
      if (url.origin === NEW_DIRECT) {
        if (url.pathname === '/identity') return Response.json({ MediaContainer: { machineIdentifier: MACHINE } });
        if (url.pathname === '/vela/v0/capabilities') return new Response('', { status: 404 });
        if (url.pathname === '/library/sections') return Response.json({ MediaContainer: { Directory: [] } });
        if (url.pathname === '/') return Response.json({ MediaContainer: { friendlyName: 'New Name' } });
      }
      return new Response('', { status: 404 });
    });

    const vela = createVela(platform(store));
    const revisionBefore = vela.getState().auth.revision;

    await vela.servers.plexStart();
    // Wait for poll timer (PLEX_POLL_MS = 2s) to finish listing the server.
    for (let i = 0; i < 160 && vela.getState().servers.plex?.state !== 'linked'; i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    expect(vela.getState().servers.plex?.state).toBe('linked');

    const result = await vela.servers.plexChoose(MACHINE);
    expect(result.error).toBe('');
    expect(result.id).toBe(existing.id);

    const all = new ServerRegistry(store).read().servers;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: existing.id,
      origin: NEW_DIRECT,
      name: 'New Name',
      machineIdentifier: MACHINE,
    });
    for (let i = 0; i < 40 && vela.getState().auth.revision === revisionBefore; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
    expect(vela.getState().auth.revision).toBe(revisionBefore + 1);
  });

  test('PlexAdapter marks transport failures as unreachable but never marks HTTP errors', async () => {
    const store = new MemoryStore();
    const creds = new ServerCredentials(store, device, () => 'k', 's1');
    await creds.set(tokens('srv-tok'));
    const adapter = new PlexAdapter({ origin: OLD_ORIGIN, credentials: creds, clientIdentifier: device.id });

    mockFetch(() => { throw new Error('connect ETIMEDOUT'); });
    let caught: unknown;
    try { await adapter.validateSession(); } catch (e) { caught = e; }
    expect(isUnreachableError(caught)).toBe(true);

    mockFetch(() => new Response('down', { status: 503 }));
    caught = undefined;
    try { await adapter.validateSession(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(VelaError);
    expect(isUnreachableError(caught)).toBe(false);
  });
});
