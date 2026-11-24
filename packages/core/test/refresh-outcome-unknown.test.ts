// A refresh whose outcome the server lost for good (409 mutation_outcome_unknown, retry not
// allowed) is never asked again under the same idempotency key: the same key would only replay the
// unknown outcome, and the app would sit on "Reconnecting…" for good. A refresh still running on
// the server (retry allowed), or one this client stopped waiting for, keeps its key: the server
// may finish it and replay the rotated tokens, and a new key would reuse a rotated token.
import { afterEach, expect, jest, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { deadKey, REFRESH_ATTEMPT_TIMEOUT_MS, refreshIdempotencyKey, refusesSession } from '../src/adapter/ether/transport';
import { VelaError } from '../src/adapter/errors';
import { FakeCredentials, restoreFetch, routeFetch, tokens, type Seen } from './helpers';

afterEach(() => { restoreFetch(); jest.useRealTimers(); });

const ORIGIN = 'https://ether.example';
const unknownOutcome = () => Response.json({ error: { class: 'conflict', code: 'mutation_outcome_unknown',
  message: 'The outcome of an earlier request with this idempotency key is unknown', retry: { allowed: false } } }, { status: 409 });
const keyOf = (request: Seen) => (request.body as { idempotencyKey: string }).idempotencyKey;

/** A server that has lost the outcome of the keys in `dead` and rotates under any other key. */
function server(dead: Set<string>) {
  const seen = routeFetch({
    'POST /vela/v0/auth/refresh': (r: Seen) => dead.has(keyOf(r)) ? unknownOutcome() : tokens('rotated'),
    'GET /vela/v0/libraries': (r: Seen) => r.headers.get('authorization') === 'Bearer rotated'
      ? { items: [], continuation: 'exhausted' } : new Response('', { status: 401 }),
  });
  return { keys: () => seen.filter(r => r.url.pathname.endsWith('/auth/refresh')).map(keyOf) };
}

test('a refresh key spent on a lost outcome gives way to a new, stable key that differs from the first', () => {
  const first = refreshIdempotencyKey('rt-1');
  expect(refreshIdempotencyKey('rt-1', 0)).toBe(first);
  expect(refreshIdempotencyKey('rt-1', 1)).not.toBe(first);
  expect(refreshIdempotencyKey('rt-1', 1)).toBe(refreshIdempotencyKey('rt-1', 1));
  expect(refreshIdempotencyKey('rt-1', 2)).not.toBe(refreshIdempotencyKey('rt-1', 1));
  expect(refreshIdempotencyKey('rt-1', 1)).toMatch(/^refresh-[0-9a-f]{32}$/);
});

test('only a mutation_outcome_unknown that allows no retry is a dead key, and it is not a refusal', () => {
  const lost = new VelaError({ class: 'conflict', code: 'mutation_outcome_unknown', message: 'x', retry: { allowed: false } }, 409);
  expect(deadKey(lost)).toBe(true);
  expect(refusesSession(lost)).toBe(false);
  expect(deadKey(new VelaError({ class: 'conflict', code: 'mutation_outcome_unknown', message: 'x', retry: { allowed: true, afterSeconds: 2 } }, 409, '2'))).toBe(false);
  expect(deadKey(new VelaError({ class: 'conflict', code: 'idempotency_conflict', message: 'x', retry: { allowed: false } }, 409))).toBe(false);
  expect(deadKey(new Error('offline'))).toBe(false);
});

test('a refresh still running on the server (409 with retry allowed) is asked again under the same key after its wait', async () => {
  const keys: string[] = [];
  let calls = 0;
  routeFetch({
    'POST /vela/v0/auth/refresh': (r: Seen) => {
      keys.push(keyOf(r));
      return ++calls === 1 ? Response.json({ error: { class: 'conflict', code: 'mutation_outcome_unknown', message: 'In progress',
        retry: { allowed: true, afterSeconds: 1 } } }, { status: 409, headers: { 'Retry-After': '1' } }) : tokens('rotated');
    },
    'GET /vela/v0/libraries': (r: Seen) => r.headers.get('authorization') === 'Bearer rotated'
      ? { items: [], continuation: 'exhausted' } : new Response('', { status: 401 }),
  });
  const started = Date.now();
  await new EtherAdapter(ORIGIN, new FakeCredentials(tokens('saved')), 'web-1').libraries({});
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  expect(keys).toEqual([refreshIdempotencyKey('saved'), refreshIdempotencyKey('saved')]);
});

test('restoring after a 409 outcome-unknown asks again at once under a new key, and the session recovers', async () => {
  const dead = new Set([refreshIdempotencyKey('saved')]);
  const s = server(dead);
  const credentials = new FakeCredentials(tokens('saved'));
  expect((await new EtherAdapter(ORIGIN, credentials, 'web-1').validateSession())?.accessToken).toBe('rotated');
  expect(s.keys()).toEqual([refreshIdempotencyKey('saved'), refreshIdempotencyKey('saved', 1)]);
  expect(credentials.current?.accessToken).toBe('rotated');
});

test('a mid-session refresh does the same: the read that found its token rejected succeeds', async () => {
  const s = server(new Set([refreshIdempotencyKey('saved')]));
  const credentials = new FakeCredentials(tokens('saved'));
  await new EtherAdapter(ORIGIN, credentials, 'web-1').libraries({});
  expect(s.keys()).toEqual([refreshIdempotencyKey('saved'), refreshIdempotencyKey('saved', 1)]);
});

test('keys that keep failing are each asked once: every Retry moves to a key never tried before', async () => {
  const dead = new Set([0, 1, 2, 3].map(n => refreshIdempotencyKey('saved', n)));
  const s = server(dead);
  const credentials = new FakeCredentials(tokens('saved'));
  const adapter = new EtherAdapter(ORIGIN, credentials, 'web-1');
  await expect(adapter.validateSession()).rejects.toThrow('outcome');
  await expect(adapter.validateSession()).rejects.toThrow('outcome');
  expect(credentials.current?.accessToken).toBe('saved');
  expect((await adapter.validateSession())?.accessToken).toBe('rotated');
  const keys = s.keys();
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys).toEqual([0, 1, 2, 3, 4].map(n => refreshIdempotencyKey('saved', n)));
});

test('a definitive refusal under the new key still ends the session', async () => {
  routeFetch({ 'POST /vela/v0/auth/refresh': (r: Seen) => keyOf(r) === refreshIdempotencyKey('saved') ? unknownOutcome()
    : Response.json({ error: { class: 'auth', code: 'invalid_refresh', message: 'Refresh invalid', retry: { allowed: false } } }, { status: 401 }) });
  const credentials = new FakeCredentials(tokens('saved'));
  let rejected = 0;
  const error = await new EtherAdapter(ORIGIN, credentials, 'web-1', () => rejected++).validateSession().catch(e => e);
  expect(refusesSession(error)).toBe(true);
  expect(credentials.current).toBeNull();
  expect(rejected).toBe(1);
});

/** fetch that never answers refresh until `answer` says how, recording each key. */
function heldServer() {
  const keys: string[] = [];
  let answer: (() => Response) | undefined;
  globalThis.fetch = Object.assign((_input: unknown, init?: RequestInit) => {
    keys.push(JSON.parse(String(init?.body)).idempotencyKey);
    if (answer) return Promise.resolve(answer());
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }, { preconnect: () => {} }) as typeof fetch;
  return { keys, answer: (next: () => Response) => { answer = next; } };
}

async function abandonOnce(adapter: EtherAdapter) {
  jest.useFakeTimers();
  const validating = adapter.validateSession().catch(error => error);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  jest.advanceTimersByTime(REFRESH_ATTEMPT_TIMEOUT_MS);
  expect((await validating).message).toContain('did not answer within 15 seconds');
  jest.useRealTimers();
}

test('after the client abandons a refresh at its timeout, it asks under the same key and gets the tokens the server finished', async () => {
  const server = heldServer();
  const credentials = new FakeCredentials(tokens('saved'));
  const adapter = new EtherAdapter(ORIGIN, credentials, 'web-1');
  await abandonOnce(adapter);
  server.answer(() => Response.json(tokens('rotated')));
  expect((await adapter.validateSession())?.accessToken).toBe('rotated');
  expect(server.keys).toEqual([refreshIdempotencyKey('saved'), refreshIdempotencyKey('saved')]);
});

test('a server that kept the abandoned key without finishing says so, and the app moves to a new key at once', async () => {
  const server = heldServer();
  const credentials = new FakeCredentials(tokens('saved'));
  const adapter = new EtherAdapter(ORIGIN, credentials, 'web-1');
  await abandonOnce(adapter);
  server.answer(() => server.keys.at(-1) === refreshIdempotencyKey('saved') ? unknownOutcome() : Response.json(tokens('rotated')));
  expect((await adapter.validateSession())?.accessToken).toBe('rotated');
  expect(server.keys).toEqual([refreshIdempotencyKey('saved'), refreshIdempotencyKey('saved'), refreshIdempotencyKey('saved', 1)]);
});
