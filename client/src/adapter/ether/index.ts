import type * as V from '../../../wire/v0/types';
import type { ServerAdapter } from '../index';

export class VelaError extends Error {
  constructor(readonly detail: V.ProtocolError, readonly status: number) { super(detail.message); }
}

/** The caller supplies stable mutation keys and persists every rotated token. */
export interface Credentials {
  get(): Promise<V.Tokens | null>;
  set(tokens: V.Tokens | null): Promise<void>;
  device: V.Device;
  refreshKey(): string;
}

export class EtherAdapter implements ServerAdapter {
  private cache = new Map<string, { etag: string; body: unknown }>();
  private refreshing: Promise<V.Tokens> | undefined;
  constructor(private origin: string, private credentials: Credentials, private capabilityContext: string) {}

  private async refresh(tokens: V.Tokens): Promise<V.Tokens> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const current = await this.credentials.get();
        if (current && current.refreshToken !== tokens.refreshToken) return current;
        if (!current) throw new Error('Session ended');
        const next = await this.request<V.Tokens>('POST', '/auth/refresh', {
          refreshToken: current.refreshToken, device: this.credentials.device,
          idempotencyKey: this.credentials.refreshKey(),
        }, false);
        const latest = await this.credentials.get();
        if (!latest || latest.refreshToken !== current.refreshToken) throw new Error('Session changed during refresh');
        await this.credentials.set(next);
        return next;
      })().finally(() => { this.refreshing = undefined; });
    }
    return this.refreshing;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = true, cacheable = false): Promise<T> {
    let tokens = auth ? await this.credentials.get() : null;
    if (auth && !tokens) throw new Error('Sign in required');
    const key = JSON.stringify([this.origin, tokens?.viewer.id ?? '', tokens?.viewer.policyRevision ?? '', this.capabilityContext, 0, path]);
    const cached = cacheable ? this.cache.get(key) : undefined;
    const send = (token: V.Tokens | null, useCache = true) => fetch(`${this.origin}/vela/v0${path}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token.accessToken}` } : {}),
        ...(cached && useCache ? { 'If-None-Match': cached.etag } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let response = await send(tokens);
    if (response.status === 401 && tokens) { tokens = await this.refresh(tokens); response = await send(tokens, false); }
    if (response.status === 304 && cached) return cached.body as T;
    if (!response.ok) {
      let detail: V.ProtocolError;
      try { detail = ((await response.json()) as V.ErrorResponse).error; }
      catch { detail = { class: 'transient', code: 'http_error', message: `Server returned ${response.status}`, retry: { allowed: false } }; }
      throw new VelaError(detail, response.status);
    }
    const value = await response.json() as T;
    const etag = response.headers.get('etag');
    // A refresh may change policy: do not store under the old identity.
    if (etag && cacheable && (!tokens || key === JSON.stringify([this.origin, tokens.viewer.id, tokens.viewer.policyRevision, this.capabilityContext, 0, path]))) this.cache.set(key, { etag, body: value });
    return value;
  }
  capabilities() { return this.request<V.ServerCapabilities>('GET', '/capabilities', undefined, false, true); }
  signIn(r: V.SignInRequest) { return this.request<V.Tokens>('POST', '/auth/sign-in', r, false); }
  deviceGrant(r: V.DeviceGrantRequest) { return this.request<V.DeviceGrant>('POST', '/auth/device', r, false); }
  pollDevice(r: V.DevicePollRequest) { return this.request<V.GrantPoll>('POST', '/auth/device/poll', r, false); }
  quickConnect(r: V.DeviceGrantRequest) { return this.request<V.QuickConnect>('POST', '/auth/quick-connect', r, false); }
  pollQuickConnect(r: V.QuickPollRequest) { return this.request<V.GrantPoll>('POST', '/auth/quick-connect/poll', r, false); }
  revoke(r: V.RevokeRequest) { return this.request<V.Ack>('POST', '/auth/revoke', r); }
  bootstrap() { return this.request<V.Bootstrap>('GET', '/bootstrap', undefined, true, true); }
  rows(q: V.RowsQuery) { return this.request<V.Page<V.Row>>('GET', `/rows${query(q)}`, undefined, true, true); }
  row(id: string, cursor?: string, limit?: number) { return this.request<V.Row>('GET', `/rows/${encodeURIComponent(id)}${query({ cursor, limit })}`, undefined, true, true); }
  detail(id: string) { return this.request<V.TitleDetail>('GET', `/titles/${encodeURIComponent(id)}`, undefined, true, true); }
  search(r: V.SearchRequest) { return this.request<V.SearchResponse>('POST', '/search', r); }
  startAI(r: V.AISearchRequest) { return this.request<V.AISearchJob>('POST', '/search/ai', r); }
  aiJob(id: string) { return this.request<V.AISearchJob>('GET', `/search/ai/${encodeURIComponent(id)}`); }
  cancelAI(id: string, r: V.CancelRequest) { return this.request<V.AISearchJob>('POST', `/search/ai/${encodeURIComponent(id)}/cancel`, r); }
  interactions(r: V.InteractionsRequest) { return this.request<V.Ack>('POST', '/interactions', r); }
  playback(r: V.PlaybackRequest) { return this.request<V.PlaybackPlan>('POST', '/playback', r); }
  observe(id: string, r: V.PlayerObservation) { return this.request<V.Ack>('POST', `/sessions/${encodeURIComponent(id)}/observations`, r); }
  command(id: string, r: V.SessionCommand) { return this.request<V.PlaybackPlan>('POST', `/sessions/${encodeURIComponent(id)}/commands`, r); }
  snapshot(id: string) { return this.request<V.SessionSnapshot>('GET', `/sessions/${encodeURIComponent(id)}`); }
}
function query(values: object): string {
  const pairs = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}
