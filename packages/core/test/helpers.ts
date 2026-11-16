// Small fakes shared by the core tests: an in-memory secret store, credentials holding one
// session, and a fetch stand-in that answers by method and path.
import { afterEach } from 'bun:test';
import type { Credentials } from '../src/adapter';
import type { SecretStore } from '../src/session';
import type * as V from '../src/wire';

export class MemoryStore implements SecretStore {
  readonly values = new Map<string, string>();
  writes = 0;
  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.writes++;
    this.values.set(key, value);
  }
}

export const device: V.Device = { id: 'device-test', name: 'Test Device', platform: 'web', appVersion: '0.1.0' };

export function tokens(accessToken = 'token-1', viewerId = 'viewer-1'): V.Tokens {
  return { accessToken, refreshToken: accessToken, expiresAt: '9999-12-31T23:59:59Z', viewer: { id: viewerId, name: 'Viewer', policyRevision: 'test' } };
}

export class FakeCredentials implements Credentials {
  readonly device = device;
  constructor(public current: V.Tokens | null = tokens()) {}
  async get() { return this.current; }
  async set(next: V.Tokens | null) { this.current = next; }
  refreshKey() { return 'refresh-key'; }
}

export interface Seen { method: string; url: URL; headers: Headers; body?: unknown }
type Answer = unknown | ((request: Seen) => unknown);

/**
 * Replace global fetch for one test. Routes are `METHOD /path` (query ignored) mapped to a JSON
 * body, a Response, or a function of the request returning either. Unrouted requests are 404s.
 */
export function routeFetch(routes: Record<string, Answer>): Seen[] {
  const seen: Seen[] = [];
  const original = globalThis.fetch;
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const request: Seen = { method, url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    seen.push(request);
    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) return new Response('not found', { status: 404 });
    const answer = typeof route === 'function' ? (route as (r: Seen) => unknown)(request) : route;
    return answer instanceof Response ? answer : Response.json(answer);
  };
  globalThis.fetch = Object.assign(fake, { preconnect: () => {} }) as typeof fetch;
  restore.push(() => { globalThis.fetch = original; });
  return seen;
}

const restore: (() => void)[] = [];
afterEach(() => {
  while (restore.length) restore.pop()!();
});
