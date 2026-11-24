import type * as V from '../../wire';
import type { Credentials } from '../index';
import { VelaError } from '../errors';
import { readEvents, type EventHandler } from '../../protocol/sse';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Token = V.Tokens | null;

export interface RequestOptions {
  /** Send the session's bearer token (default true). */
  auth?: boolean;
  /** Revalidate with the server's ETag and keep the answer (default false). */
  cacheable?: boolean;
  /** On web, retain this ETag answer across a full reload in this tab. */
  persistent?: boolean;
  /** Replace cached grants without sending an old ETag. */
  fresh?: boolean;
  /** Refresh and resend once on 401 (default true). */
  retryAuth?: boolean;
  signal?: AbortSignal;
  /** Extra request headers (X-Vela-Screen-Renderer). */
  headers?: Record<string, string>;
  /** Follow a redirect that stays inside the bound server's /vela/v0 (a stale screen document's
   * 301); `moved` hears the path read. Redirects are refused otherwise. */
  follow?: boolean;
  moved?: (path: string) => void;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * HTTP to one Ether server's `/vela/v0/` tree: bearer credentials, token rotation, ETag answers
 * keyed by viewer, policy and declared client, and redirects refused.
 */
export class EtherTransport {
  private cache = new Map<string, { etag: string; body: unknown }>();
  private refreshing: Promise<V.Tokens> | undefined;
  /**
   * A refresh the server just failed: requests that find their token rejected meanwhile do not
   * ask again until `until` (the server's stated wait, else a short hold). Never permanent: a
   * transient failure leaves the same refresh token, and it must be tried again later.
   */
  private refreshFailure?: { token: string; error: unknown; until: number };

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
    const { auth = true, cacheable = false, persistent = false, fresh = false, retryAuth = true, signal, follow = false } = options;
    signal?.throwIfAborted();
    let tokens = auth ? await abortable(this.credentials.get(), signal) : null;
    if (auth && !tokens) throw new Error('Sign in required');
    const identity = method === 'GET' ? path : JSON.stringify([method, path, body]);
    const key = this.cacheKey(tokens, identity);
    const cached = cacheable && !fresh ? this.cache.get(key) ?? (persistent ? persistentRead(key) : undefined) : undefined;
    if (cached && !this.cache.has(key)) this.cache.set(key, cached);
    const send = (token: Token, useCache = true) => {
      const headers: Record<string, string> = { ...options.headers };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cached && useCache) headers['If-None-Match'] = cached.etag;
      const init: RequestInit = { method, signal, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      return follow ? this.fetchFollowing(path, init, token, options.moved) : this.fetchBound(`/vela/v0${path}`, init, token);
    };
    let response = await send(tokens);
    if (response.status === 401 && tokens && retryAuth) {
      tokens = await abortable(this.refresh(tokens), signal);
      signal?.throwIfAborted();
      response = await send(tokens, false);
    }
    if (response.status === 304 && cached) return cached.body as T;
    if (!response.ok) throw await this.failure(response, signal);
    // A mutation may answer with no body (favourites, multiview ends).
    if (response.status === 204) return undefined as T;
    const value = await response.json() as T;
    signal?.throwIfAborted();
    const etag = response.headers.get('etag');
    // A refresh may change policy: do not store under the old identity.
    const sameIdentity = !tokens || key === this.cacheKey(tokens, identity);
    // A partial answer (a title still being filled) says no-store: it is never kept or revalidated.
    const storable = !/(^|,)\s*no-store\s*(,|$)/i.test(response.headers.get('cache-control') ?? '');
    if (etag && cacheable && sameIdentity && storable) {
      const entry = { etag, body: value };
      this.cache.set(key, entry);
      if (persistent) persistentWrite(key, entry);
    } else if (cacheable && !storable) {
      this.cache.delete(key);
      if (persistent) persistentDelete(key);
    }
    return value;
  }

  /**
   * An authenticated binary GET (a trickplay sheet), revalidated with `etag`: the bytes, or
   * `unchanged` on 304, or null when the server has no such resource (404). Never cached here.
   */
  async bytes(path: string, etag?: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mimeType: string; etag?: string } | 'unchanged' | null> {
    signal?.throwIfAborted();
    let tokens = await abortable(this.credentials.get(), signal);
    if (!tokens) throw new Error('Sign in required');
    const send = (token: Token, revalidate: boolean) =>
      this.fetchBound(`/vela/v0${path}`, { method: 'GET', signal, headers: revalidate && etag ? { 'If-None-Match': etag } : {} }, token);
    let response = await send(tokens, true);
    if (response.status === 401) {
      tokens = await abortable(this.refresh(tokens), signal);
      signal?.throwIfAborted();
      response = await send(tokens, true);
    }
    if (response.status === 304 && etag) return 'unchanged';
    if (response.status === 404) return null;
    if (!response.ok) throw await this.failure(response, signal);
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    return { bytes, mimeType: response.headers.get('content-type') ?? '', ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}) };
  }

  /** Replace the current viewer while holding the same cross-window lock as token refresh. */
  replaceSession<T>(work: () => Promise<T>): Promise<T> {
    return acrossWindows(`vela-refresh:${this.origin}`, work);
  }

  /**
   * Rotate the session's tokens once, shared by every request that found them rejected. Session
   * restoration asks with `restore`: one attempt that always reaches the server, because the
   * caller paces its own retries (and the viewer's Retry must really ask again).
   */
  refresh(tokens: V.Tokens, restore = false): Promise<V.Tokens> {
    if (!this.refreshing) {
      this.refreshing = acrossWindows(`vela-refresh:${this.origin}`, () => this.rotate(tokens, restore)).finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async rotate(tokens: V.Tokens, restore: boolean): Promise<V.Tokens> {
    const current = await this.credentials.get();
    if (current && current.refreshToken !== tokens.refreshToken) return current;
    if (!current) throw new Error('Session ended');
    const failed = this.refreshFailure;
    if (!restore && failed?.token === current.refreshToken && Date.now() < failed.until) throw failed.error;
    const request: V.RefreshRequest = {
      refreshToken: current.refreshToken,
      device: this.credentials.device,
      // One key per refresh token: two requests rotating the same token (a retry, another window
      // that raced this one) are the same operation to the server, never a reuse of a rotated token.
      idempotencyKey: refreshIdempotencyKey(current.refreshToken),
    };
    let next: V.Tokens | undefined;
    for (let attempt = 0; attempt < (restore ? 1 : 3); attempt++) {
      try {
        next = await this.refreshOnce(request);
        break;
      } catch (error) {
        if (refusesSession(error)) {
          await this.forgetRejected(current);
          throw error;
        }
        const delay = retryDelay(error, attempt);
        if (restore || delay === undefined) {
          this.refreshFailure = { token: current.refreshToken, error, until: Date.now() + (serverWait(error) || REFRESH_FAILURE_HOLD_MS) };
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

  /** One refresh request, abandoned when the server does not answer in time (a held socket never ends on Android). */
  private async refreshOnce(request: V.RefreshRequest): Promise<V.Tokens> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REFRESH_ATTEMPT_TIMEOUT_MS);
    try {
      return await this.request<V.Tokens>('POST', '/auth/refresh', request, { auth: false, signal: abort.signal });
    } catch (error) {
      if (abort.signal.aborted) throw new Error(`The server did not answer within ${REFRESH_ATTEMPT_TIMEOUT_MS / 1000} seconds`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
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

  private fetchBound(path: string, init: RequestInit, token: Token, redirect: RequestRedirect = 'error'): Promise<Response> {
    const headers: Record<string, string> = { ...init.headers as Record<string, string> };
    if (token) {
      headers.Authorization = `Bearer ${token.accessToken}`;
      headers['X-Vela-Device-Id'] = this.credentials.device.id;
    }
    return fetch(this.boundURL(path), { ...init, redirect, headers });
  }

  /** The path under /vela/v0 of a URL inside the bound server, or undefined outside it. */
  boundPath(href: string): string | undefined {
    try {
      const url = new URL(href, `${this.origin}/`);
      if (url.origin !== this.origin || !url.pathname.startsWith('/vela/v0/')) return undefined;
      return `${url.pathname.slice('/vela/v0'.length)}${url.search}`;
    } catch { return undefined; }
  }

  /** A GET that follows at most three redirects, each inside the bound server. Natively the
   * Location is read and checked before it is asked; a browser hides it (an opaque redirect), so
   * there the request is sent following and the final URL is checked. */
  private async fetchFollowing(path: string, init: RequestInit, token: Token, moved?: (path: string) => void): Promise<Response> {
    let current = path;
    for (let hop = 0; hop < 4; hop++) {
      const response = await this.fetchBound(`/vela/v0${current}`, init, token, 'manual');
      if (response.type === 'opaqueredirect') {
        const followed = await this.fetchBound(`/vela/v0${current}`, init, token, 'follow');
        const final = followed.url ? this.boundPath(followed.url) : current;
        if (!final) throw new Error('Request outside bound server');
        if (final !== current) moved?.(final);
        return followed;
      }
      if (!REDIRECTS.has(response.status)) {
        if (current !== path) moved?.(current);
        return response;
      }
      const next = this.boundPath(response.headers.get('location') ?? '');
      if (!next) throw new Error('Redirect outside bound server');
      current = next;
    }
    throw new Error('Too many redirects');
  }
}

type CacheEntry = { etag: string; body: unknown };
interface SessionCache { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const storage = (): SessionCache | undefined => {
  try { return (globalThis as typeof globalThis & { sessionStorage?: SessionCache }).sessionStorage; } catch { return undefined; }
};
const persistentKey = (key: string) => `vela.bootstrap.${refreshIdempotencyKey(key)}`;
function persistentRead(key: string): CacheEntry | undefined {
  try {
    const saved = storage()?.getItem(persistentKey(key));
    if (!saved) return undefined;
    const parsed = JSON.parse(saved) as { key?: unknown; entry?: CacheEntry };
    if (parsed.key === key && typeof parsed.entry?.etag === 'string') return parsed.entry;
  } catch { /* Storage is an optional reload optimization. */ }
  persistentDelete(key);
  return undefined;
}
function persistentWrite(key: string, entry: CacheEntry): void {
  try { storage()?.setItem(persistentKey(key), JSON.stringify({ key, entry })); } catch { /* Private/quota-limited browsers keep the memory cache. */ }
}
function persistentDelete(key: string): void {
  try { storage()?.removeItem(persistentKey(key)); } catch { /* Optional storage. */ }
}

/** One refresh request waits this long for the server's answer. */
export const REFRESH_ATTEMPT_TIMEOUT_MS = 8_000;
/** After a failed refresh, requests mid-session wait this long (or the server's stated wait) before asking again. */
export const REFRESH_FAILURE_HOLD_MS = 5_000;

/**
 * Whether a refresh answer ends the session for good: the server refused the refresh token
 * (401/403, or an auth-class error). Everything else (5xx, 503, timeouts, no network) is transient.
 */
export function refusesSession(error: unknown): boolean {
  return error instanceof VelaError && (error.status === 401 || error.status === 403 || error.detail.class === 'auth');
}

/** The wait the server asked for (Retry-After or retry.afterSeconds), in milliseconds; 0 when none. */
export function serverWait(error: unknown): number {
  if (!(error instanceof VelaError)) return 0;
  const header = error.retryAfter ? Number(error.retryAfter) : 0;
  const headerDelay = Number.isFinite(header) && header > 0 ? header * 1000 : 0;
  const after = error.detail.retry?.afterSeconds ?? 0;
  return Math.max(headerDelay, Number.isFinite(after) && after > 0 ? after * 1000 : 0);
}

/** How long to wait before the next refresh attempt, or undefined when the server forbids another. */
function retryDelay(error: unknown, attempt: number): number | undefined {
  const policy = error instanceof VelaError ? error.detail.retry : undefined;
  const maxAttempts = policy?.maxAttempts;
  const limit = maxAttempts && Number.isFinite(maxAttempts) ? Math.max(1, Math.min(3, Math.floor(maxAttempts))) : 3;
  const delay = Math.max(1000 * 2 ** attempt, serverWait(error));
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
