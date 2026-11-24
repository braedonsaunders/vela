// Session refresh against a server that fails: a transient failure is never remembered for
// good (the same refresh token must be tried again once the server recovers), a refresh the
// server does not answer is abandoned, and only a refusal ends the session.
import { afterEach, expect, jest, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { REFRESH_ATTEMPT_TIMEOUT_MS, REFRESH_FAILURE_HOLD_MS, refusesSession, serverWait } from '../src/adapter/ether/transport';
import { VelaError } from '../src/adapter/errors';
import { FakeCredentials, restoreFetch, routeFetch, tokens } from './helpers';

afterEach(() => { restoreFetch(); jest.useRealTimers(); });

const ORIGIN = 'https://ether.example';
const locked = () => Response.json({ error: { class: 'transient', code: 'internal', message: 'database is locked', retry: { allowed: false } } }, { status: 500 });
const refused = (status: number) => Response.json({ error: { class: status === 401 ? 'auth' : 'policy', code: 'invalid_refresh', message: 'Refresh invalid', retry: { allowed: false } } }, { status });

function server() {
  let failing = true, calls = 0;
  const seen = routeFetch({
    'POST /vela/v0/auth/refresh': () => { calls++; return failing ? locked() : tokens('rotated'); },
    'GET /vela/v0/libraries': (r: { headers: Headers }) => r.headers.get('authorization') === 'Bearer rotated'
      ? { items: [], continuation: 'exhausted' } : new Response('', { status: 401 }),
  });
  return { seen, calls: () => calls, recover: () => { failing = false; } };
}

test('session validation asks the server every time after a transient failure, then rotates once it recovers', async () => {
  const s = server();
  const credentials = new FakeCredentials(tokens('saved'));
  const adapter = new EtherAdapter(ORIGIN, credentials, 'web-1');
  await expect(adapter.validateSession()).rejects.toThrow('database is locked');
  await expect(adapter.validateSession()).rejects.toThrow('database is locked');
  expect(s.calls()).toBe(2);
  s.recover();
  expect((await adapter.validateSession())?.accessToken).toBe('rotated');
  expect(s.calls()).toBe(3);
  expect(credentials.current?.accessToken).toBe('rotated');
});

test('reads mid-session hold back briefly after a failed refresh, then ask again', async () => {
  const s = server();
  const credentials = new FakeCredentials(tokens('saved'));
  const adapter = new EtherAdapter(ORIGIN, credentials, 'web-1');
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    await expect(adapter.libraries({})).rejects.toThrow('database is locked');
    expect(s.calls()).toBe(1);
    await expect(adapter.libraries({})).rejects.toThrow('database is locked');
    expect(s.calls()).toBe(1);
    s.recover();
    now += REFRESH_FAILURE_HOLD_MS;
    await adapter.libraries({});
    expect(s.calls()).toBe(2);
    expect(credentials.current?.accessToken).toBe('rotated');
  } finally {
    Date.now = realNow;
  }
});

test('a refresh the server never answers is abandoned after its timeout', async () => {
  jest.useFakeTimers();
  let aborted = false;
  globalThis.fetch = Object.assign((_input: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
  }), { preconnect: () => {} }) as typeof fetch;
  const credentials = new FakeCredentials(tokens('saved'));
  const validating = new EtherAdapter(ORIGIN, credentials, 'web-1').validateSession().catch(error => error);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  jest.advanceTimersByTime(REFRESH_ATTEMPT_TIMEOUT_MS - 1);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(aborted).toBe(false);
  jest.advanceTimersByTime(1);
  const error = await validating;
  expect(aborted).toBe(true);
  expect(error.message).toContain('did not answer');
  expect(refusesSession(error)).toBe(false);
  expect(credentials.current?.accessToken).toBe('saved');
});

for (const status of [401, 403]) {
  test(`a ${status} refusal clears the stored session and reports it`, async () => {
    routeFetch({ 'POST /vela/v0/auth/refresh': refused(status) });
    const credentials = new FakeCredentials(tokens('saved'));
    let rejected = 0;
    const error = await new EtherAdapter(ORIGIN, credentials, 'web-1', () => rejected++).validateSession().catch(e => e);
    expect(refusesSession(error)).toBe(true);
    expect(credentials.current).toBeNull();
    expect(rejected).toBe(1);
  });
}

test('transient answers are not refusals, and the server-stated wait is read from either place', () => {
  const busy = new VelaError({ class: 'transient', code: 'unavailable', message: 'Busy', retry: { allowed: true, afterSeconds: 2 } }, 503, '7');
  expect(refusesSession(busy)).toBe(false);
  expect(refusesSession(new Error('Failed to fetch'))).toBe(false);
  expect(serverWait(busy)).toBe(7000);
  expect(serverWait(new VelaError({ class: 'transient', code: 'x', message: 'x', retry: { allowed: true, afterSeconds: 2 } }, 503))).toBe(2000);
  expect(serverWait(new Error('offline'))).toBe(0);
});
