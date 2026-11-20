import type * as V from '../../wire';
import type { Credentials } from '../index';
import { VelaError } from '../errors';
import { readEvents, type EventHandler } from '../../protocol/sse';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Token = V.Tokens | null;

export interface RequestOptions {
  /** Send the session's bearer token (default true). */
  auth?: boolean;
  /** Revalidate with the server's ETag and keep the answer (default false). */
  cacheable?: boolean;
  /** Replace cached grants without sending an old ETag. */
  fresh?: boolean;
  /** Refresh and resend once on 401 (default true). */
  retryAuth?: boolean;
  signal?: AbortSignal;
}

/**
 * HTTP to one Ether server's `/vela/v0/` tree: bearer credentials, token rotation, ETag answers
 * keyed by viewer, policy and declared client, and redirects refused.
 */
export class EtherTransport {
  private cache = new Map<string, { etag: string; body: unknown }>();
  private refreshing: Promise<V.Tokens> | undefined;
  private refreshFailure?: { token: string; error: unknown };

  constructor(
    private readonly origin: string,
    readonly credentials: Credentials,
    private capabilityContext: string,
    private readonly onSessionRejected?: () => void,
  ) {}

  /** A new client declaration changes what the server answers, so earlier answers are dropped. */
  setCapabilityContext(context: string): void {
    if (this.capabilityContext !== context) {
      this.capabilityContext = context;
      this.cache.clear();
    }
  }

  /** One connection to an event stream under `/vela/v0`, read to its end. */
  async stream(path: string, headers: Record<string, string>, onEvent: EventHandler, signal?: AbortSignal): Promise<void> {
    const tokens = await this.credentials.get();
    if (!tokens) throw new Error('Sign in required');
    const init = { headers: { Accept: 'text/event-stream', ...headers }, signal };
    const response = await this.fetchBound(`/vela/v0${path}`, init, tokens);
    if (!response.ok) throw await this.failure(response, signal);
    await readEvents(response, onEvent, signal);
  }

  async request<T>(method: Method, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const { auth = true, cacheable = false, fresh = false, retryAuth = true, signal } = options;
    signal?.throwIfAborted();
    let tokens = auth ? await abortable(this.credentials.get(), signal) : null;
    if (auth && !tokens) throw new Error('Sign in required');
    const identity = method === 'GET' ? path : JSON.stringify([method, path, body]);
    const key = this.cacheKey(tokens, identity);
    const cached = cacheable && !fresh ? this.cache.get(key) : undefined;
    const send = (token: Token, useCache = true) => {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cached && useCache) headers['If-None-Match'] = cached.etag;
      const init: RequestInit = { method, signal, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      return this.fetchBound(`/vela/v0${path}`, init, token);
    };
    let response = await send(tokens);
    if (response.status === 401 && tokens && retryAuth) {
      tokens = await abortable(this.refresh(tokens), signal);
      signal?.throwIfAborted();
      response = await send(tokens, false);
    }
    if (response.status === 304 && cached) return cached.body as T;
    if (!response.ok) throw await this.failure(response, signal);
    const value = await response.json() as T;
    signal?.throwIfAborted();
    const etag = response.headers.get('etag');
    // A refresh may change policy: do not store under the old identity.
    const sameIdentity = !tokens || key === this.cacheKey(tokens, identity);
    // A partial answer (a title still being filled) says no-store: it is never kept or revalidated.
    const storable = !/(^|,)\s*no-store\s*(,|$)/i.test(response.headers.get('cache-control') ?? '');
    if (etag && cacheable && sameIdentity && storable) this.cache.set(key, { etag, body: value });
    else if (cacheable && !storable) this.cache.delete(key);
    return value;
  }

  /** Rotate the session's tokens once, shared by every request that found them rejected. */
  refresh(tokens: V.Tokens): Promise<V.Tokens> {
    if (!this.refreshing) {
      this.refreshing = acrossWindows(`vela-refresh:${this.origin}`, () => this.rotate(tokens)).finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async rotate(tokens: V.Tokens): Promise<V.Tokens> {
    const current = await this.credentials.get();
    if (current && current.refreshToken !== tokens.refreshToken) return current;
    if (!current) throw new Error('Session ended');
    if (this.refreshFailure?.token === current.refreshToken) throw this.refreshFailure.error;
    const request: V.RefreshRequest = {
      refreshToken: current.refreshToken,
      device: this.credentials.device,
      // One key per refresh token: two requests rotating the same token (a retry, another window
      // that raced this one) are the same operation to the server, never a reuse of a rotated token.
      idempotencyKey: refreshIdempotencyKey(current.refreshToken),
    };
    let next: V.Tokens | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        next = await this.request<V.Tokens>('POST', '/auth/refresh', request, { auth: false });
        break;
      } catch (error) {
        if (error instanceof VelaError && (error.status === 401 || error.detail.class === 'auth')) {
          await this.forgetRejected(current);
          throw error;
        }
        const delay = retryDelay(error, attempt);
        if (delay === undefined) {
          this.refreshFailure = { token: current.refreshToken, error };
          throw error;
        }
        await new Promise<void>(resolve => setTimeout(resolve, delay));
      }
    }
    if (!next) throw new Error('Refresh unavailable');
    this.refreshFailure = undefined;
    const latest = await this.credentials.get();
    if (!latest || latest.refreshToken !== current.refreshToken) throw new Error('Session changed during refresh');
    await this.credentials.set(next);
    return next;
  }

  /** The server rejected this session: clear it, unless a newer one already replaced it. */
  private async forgetRejected(rejected: V.Tokens): Promise<void> {
    const latest = await this.credentials.get();
    if (latest?.refreshToken !== rejected.refreshToken) return;
    await this.credentials.set(null);
    this.cache.clear();
    this.onSessionRejected?.();
  }

  private cacheKey(tokens: Token, path: string): string {
    const viewer = tokens?.viewer.id ?? '';
    const policy = tokens?.viewer.policyRevision ?? '';
    return JSON.stringify([this.origin, viewer, policy, this.capabilityContext, 0, path]);
  }

  private async failure(response: Response, signal?: AbortSignal): Promise<VelaError> {
    let detail: V.ProtocolError;
    try {
      detail = ((await response.json()) as V.ErrorResponse).error;
    } catch {
      signal?.throwIfAborted();
      detail = {
        class: 'transient',
        code: 'http_error',
        message: `Server returned ${response.status}`,
        retry: { allowed: false },
      };
    }
    return new VelaError(detail, response.status, response.headers.get('retry-after'));
  }

  private boundURL(path: string): string {
    const url = new URL(path, `${this.origin}/`);
    const inside = url.origin === this.origin && url.pathname.startsWith('/vela/v0/');
    if (!inside) throw new Error('Request outside bound server');
    return url.href;
  }

  private fetchBound(path: string, init: RequestInit, token: Token): Promise<Response> {
    const headers: Record<string, string> = { ...init.headers as Record<string, string> };
    if (token) {
      headers.Authorization = `Bearer ${token.accessToken}`;
      headers['X-Vela-Device-Id'] = this.credentials.device.id;
    }
    return fetch(this.boundURL(path), { ...init, redirect: 'error', headers });
  }
}

/** How long to wait before the next refresh attempt, or undefined when the server forbids another. */
function retryDelay(error: unknown, attempt: number): number | undefined {
  const policy = error instanceof VelaError ? error.detail.retry : undefined;
  const maxAttempts = policy?.maxAttempts;
  const limit = maxAttempts && Number.isFinite(maxAttempts) ? Math.max(1, Math.min(3, Math.floor(maxAttempts))) : 3;
  const header = error instanceof VelaError && error.retryAfter ? Number(error.retryAfter) : 0;
  const headerDelay = Number.isFinite(header) && header > 0 ? header * 1000 : 0;
  const delay = Math.max(1000 * 2 ** attempt, (policy?.afterSeconds ?? 0) * 1000, headerDelay);
  if (policy?.allowed === false || attempt + 1 >= limit || !Number.isFinite(delay) || delay > 30000) return undefined;
  return delay;
}

/** Abort one waiter without canceling token rotation shared by other requests. */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new Error('Request aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      value => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
        else resolve(value);
      },
      error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

/**
 * Runs `work` while holding a lock shared by every window of this origin (the Web Locks API), so
 * two tabs of the web app never rotate the same refresh token at once: the second waits, then
 * finds the rotated tokens in shared storage. Where there are no Web Locks (native), it just runs.
 */
export function acrossWindows<T>(name: string, work: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request(name: string, run: () => Promise<T>): Promise<T> } } }).navigator?.locks;
  return locks ? locks.request(name, work) : work();
}

/** A stable, non-reversible idempotency key for rotating one refresh token (two FNV-1a 64 passes). */
export function refreshIdempotencyKey(refreshToken: string): string {
  const pass = (seed: bigint) => {
    let hash = seed;
    for (let i = 0; i < refreshToken.length; i++) {
      hash ^= BigInt(refreshToken.charCodeAt(i));
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
  };
  return `refresh-${pass(0xcbf29ce484222325n)}${pass(0x84222325cbf29ce4n)}`;
}
