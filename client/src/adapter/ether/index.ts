import type * as V from '../../../wire/v0/types';
import type { ServerAdapter } from '../index';
import type { StreamEvent } from '../../../app.contract.d.ts';

export class VelaError extends Error {
  constructor(readonly detail: V.ProtocolError, readonly status: number, readonly retryAfter: string | null = null) { super(detail.message); }
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

  private boundURL(path: string): string {
    const url = new URL(path, `${this.origin}/`);
    if (url.origin !== this.origin || !url.pathname.startsWith('/vela/v0/')) throw new Error('Request outside bound server');
    return url.href;
  }
  private fetchBound<T>(path: string, init: RequestInit & { exactStream: (event: StreamEvent) => T }, token: V.Tokens | null): Promise<T>;
  private fetchBound(path: string, init: RequestInit, token: V.Tokens | null): Promise<Response>;
  private fetchBound(path: string, init: RequestInit, token: V.Tokens | null): Promise<any> {
    const url = this.boundURL(path);
    return fetch(url, { ...init, redirect: 'error', headers: { ...init.headers as Record<string, string>,
      ...(token ? { Authorization: `Bearer ${token.accessToken}`, 'X-Vela-Device-Id': this.credentials.device.id } : {}) } });
  }
  async streamSession<T>(id: string, cursor: string, mapper: (event: StreamEvent) => T): Promise<T> {
    const token = await this.credentials.get();
    if (!token) throw new Error('Sign in required');
    return this.fetchBound(`/vela/v0/sessions/${encodeURIComponent(id)}/events`, { headers: { 'Last-Event-ID': cursor }, exactStream: mapper }, token);
  }

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

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = true, cacheable = false, retryAuth = true): Promise<T> {
    let tokens = auth ? await this.credentials.get() : null;
    if (auth && !tokens) throw new Error('Sign in required');
    const key = JSON.stringify([this.origin, tokens?.viewer.id ?? '', tokens?.viewer.policyRevision ?? '', this.capabilityContext, 0, path]);
    const cached = cacheable ? this.cache.get(key) : undefined;
    const send = (token: V.Tokens | null, useCache = true) => this.fetchBound(`/vela/v0${path}`, {
      method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cached && useCache ? { 'If-None-Match': cached.etag } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, token);
    let response = await send(tokens);
    if (response.status === 401 && tokens && retryAuth) { tokens = await this.refresh(tokens); response = await send(tokens, false); }
    if (response.status === 304 && cached) return cached.body as T;
    if (!response.ok) {
      let detail: V.ProtocolError;
      try { detail = ((await response.json()) as V.ErrorResponse).error; }
      catch { detail = { class: 'transient', code: 'http_error', message: `Server returned ${response.status}`, retry: { allowed: false } }; }
      throw new VelaError(detail, response.status, response.headers.get('retry-after'));
    }
    const value = await response.json() as T;
    const etag = response.headers.get('etag');
    // A refresh may change policy: do not store under the old identity.
    if (etag && cacheable && (!tokens || key === JSON.stringify([this.origin, tokens.viewer.id, tokens.viewer.policyRevision, this.capabilityContext, 0, path]))) this.cache.set(key, { etag, body: value });
    return value;
  }
  negotiate(r: V.NegotiateRequest) { return this.request<V.NegotiateResponse>('POST', '/negotiate', r); }
  capabilities() { return this.request<V.ServerCapabilities>('GET', '/capabilities', undefined, false, true); }
  redeemWebCode(r: V.WebCodeRedeemRequest) { return this.request<V.Tokens>('POST', '/auth/web-code/redeem', r, false); }
  signIn(r: V.SignInRequest) { return this.request<V.Tokens>('POST', '/auth/sign-in', r, false); }
  deviceGrant(r: V.DeviceGrantRequest) { return this.request<V.DeviceGrant>('POST', '/auth/device', r, false); }
  pollDevice(r: V.DevicePollRequest) { return this.request<V.GrantPoll>('POST', '/auth/device/poll', r, false); }
  quickConnect(r: V.DeviceGrantRequest) { return this.request<V.QuickConnect>('POST', '/auth/quick-connect', r, false); }
  pollQuickConnect(r: V.QuickPollRequest) { return this.request<V.GrantPoll>('POST', '/auth/quick-connect/poll', r, false); }
  async revoke(r: V.RevokeRequest) {
    const before = await this.credentials.get();
    try { return await this.request<V.Ack>('POST', '/auth/revoke', r, true, false, false); }
    catch (error) {
      if (!(error instanceof VelaError) || error.status !== 401 || !before) throw error;
      const rotated = await this.refresh(before);
      return this.request<V.Ack>('POST', '/auth/revoke', { refreshToken: rotated.refreshToken, idempotencyKey: this.credentials.refreshKey() }, true, false, false);
    }
  }
  bootstrap() { return this.request<V.Bootstrap>('GET', '/bootstrap', undefined, true, true); }
  rows(q: V.RowsQuery) { return this.request<V.Page<V.Row>>('GET', `/rows${query(q)}`, undefined, true, true); }
  row(id: string, cursor?: string, limit?: number) { return this.request<V.Row>('GET', `/rows/${encodeURIComponent(id)}${query({ cursor, limit })}`, undefined, true, true); }
  collection(id: string) { return this.request<V.CollectionContents>('GET', `/collections/${encodeURIComponent(id)}`, undefined, true, true); }
  detail(id: string) { return this.request<V.TitleDetail>('GET', `/titles/${encodeURIComponent(id)}`, undefined, true, true); }
  search(r: V.SearchRequest) { return this.request<V.SearchResponse>('POST', '/search', r); }
  startAI(r: V.AISearchRequest) { return this.request<V.AISearchJob>('POST', '/search/ai', r); }
  aiJob(id: string) { return this.request<V.AISearchJob>('GET', `/search/ai/${encodeURIComponent(id)}`); }
  cancelAI(id: string, r: V.CancelRequest) { return this.request<V.AISearchJob>('POST', `/search/ai/${encodeURIComponent(id)}/cancel`, r); }
  interactions(r: V.InteractionsRequest) { return this.request<V.Ack>('POST', '/interactions', r); }
  playback(r: V.PlaybackRequest) { return this.request<V.PlaybackPlan>('POST', '/playback', r); }
  observe(id: string, r: V.PlayerObservation) { return this.request<V.Ack>('POST', `/sessions/${encodeURIComponent(id)}/observations`, r); }
  command(id: string, r: V.SessionCommand) { return this.request<V.PlaybackPlan>('POST', `/sessions/${encodeURIComponent(id)}/commands`, r); }
  channels(cursor?: string, limit?: number) { return this.request<V.Page<V.Channel>>('GET', `/live/channels${query({ cursor, limit })}`, undefined, true, true); }
  guide(q: V.GuideQuery) { return this.request<V.GuideResponse>('GET', `/live/guide${query({ ...q, channelIds: q.channelIds?.join(',') })}`, undefined, true, true); }
  snapshot(id: string) { return this.request<V.SessionSnapshot>('GET', `/sessions/${encodeURIComponent(id)}`); }
}
function query(values: object): string {
  const pairs = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}
