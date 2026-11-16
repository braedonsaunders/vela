// A minimal v0 client for the spike: sign-in, negotiation, bootstrap, libraries, title detail
// and fast search, with the protocol's device header and idempotency keys. At conversion the
// app uses packages/core's adapters instead (docs/rn-migration.md), which also cover Jellyfin,
// Plex, refresh, events and playback.
import { Platform } from 'react-native';
import type * as V from '../../../protocol/v0/types';

const key = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export class EtherClient {
  readonly device: V.Device;
  private tokens: V.Tokens | null = null;

  constructor(readonly origin: string) {
    this.device = { id: `vela-rn-${Platform.OS}-${key()}`, name: `Vela (${Platform.isTV ? 'tvOS' : Platform.OS})`, platform: Platform.isTV ? 'tvos' : Platform.OS, appVersion: '0.2.0' };
  }

  get signedIn(): boolean {
    return this.tokens !== null;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (this.tokens) {
      headers.Authorization = `Bearer ${this.tokens.accessToken}`;
      headers['X-Vela-Device-Id'] = this.device.id;
    }
    const response = await fetch(`${this.origin}/vela/v0${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
    return response.json() as Promise<T>;
  }

  async signIn(username: string, password: string): Promise<V.Tokens> {
    this.tokens = await this.request<V.Tokens>('POST', '/auth/sign-in', { username, password, device: this.device, idempotencyKey: key() } satisfies V.SignInRequest);
    return this.tokens;
  }

  negotiate(): Promise<V.NegotiateResponse> {
    const client: V.ClientCapabilities = {
      device: this.device, protocolVersions: [0], containers: ['mp4', 'mkv'], videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'ac3', 'eac3'],
      subtitleFormats: ['webvtt'], hls: true, mse: Platform.OS === 'web',
    };
    return this.request('POST', '/negotiate', { client, idempotencyKey: key() } satisfies V.NegotiateRequest);
  }

  bootstrap(): Promise<V.Bootstrap> {
    return this.request('GET', '/bootstrap');
  }

  libraries(): Promise<V.Page<V.Library>> {
    return this.request('GET', '/libraries');
  }

  detail(id: string): Promise<V.TitleDetail> {
    return this.request('GET', `/titles/${encodeURIComponent(id)}`);
  }

  search(query: string, generation: number): Promise<V.SearchResponse> {
    return this.request('POST', '/search', { query, generation, mode: 'fast', limit: 30, idempotencyKey: key() } satisfies V.SearchRequest);
  }
}
