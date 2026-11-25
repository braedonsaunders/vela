import type { SecretStore } from './index';
import { randomId } from '../protocol/id';

export type ServerKind = 'ether' | 'jellyfin' | 'emby' | 'plex';
export interface ServerRecord { id: string; name: string; kind: ServerKind; origin: string; basePath: string }
interface Registry { selectedId: string; servers: ServerRecord[] }
const registryKey = 'vela.servers';

/** Addresses are explicit viewer choices; user-info, query and fragment never belong in a server record. */
export function serverAddress(value: string, kind: ServerKind): { origin: string; basePath: string } {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /%(?:2e|2f|5c|25)/i.test(url.pathname) || url.pathname.includes('\\')) throw new Error('Invalid server address');
  const basePath = url.pathname.replace(/\/+$/, '') || '/';
  if (kind === 'plex' && basePath !== '/') throw new Error('Plex requires a server origin');
  return { origin: url.origin, basePath };
}

/**
 * Where Ether hosts the app, its server is implicit (ID `ether`), so old installs continue using the
 * existing session. A standalone app has no implicit server: every server, Ether included, is added.
 */
export class ServerRegistry {
  private dormantEther: ServerRecord[] = [];
  constructor(private readonly store: SecretStore, private readonly etherOrigin?: string) {}
  /** Ether servers can be added by address only where none is implicit. */
  get standalone(): boolean {
    return !this.etherOrigin;
  }
  private addable(kind: string): boolean {
    return ['jellyfin', 'emby', 'plex'].includes(kind) || (kind === 'ether' && this.standalone);
  }
  read(): Registry {
    this.dormantEther = [];
    const implicit: ServerRecord[] = this.etherOrigin
      ? [{ id: 'ether', name: 'Vela', kind: 'ether', origin: this.etherOrigin, basePath: '/' }] : [];
    const raw = this.store.get(registryKey);
    if (!raw) return { selectedId: implicit[0]?.id ?? '', servers: implicit };
    const parsed = JSON.parse(raw) as Registry;
    if (!parsed || !Array.isArray(parsed.servers) || typeof parsed.selectedId !== 'string') throw new Error('Invalid server registry');
    const servers = [...implicit];
    for (const item of parsed.servers) {
      if (!item || item.id === 'ether') continue;
      // A hosted/lab build uses its configured Ether, but must still open a
      // registry written by the standalone app. Keep those records for later.
      if (this.etherOrigin && item.kind === 'ether') { this.dormantEther.push(item); continue; }
      if (!/^[a-f0-9-]{36}$/.test(item.id) || !this.addable(item.kind) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100) throw new Error('Invalid server record');
      const address = serverAddress(item.origin + (item.basePath === '/' ? '' : item.basePath), item.kind);
      if (address.origin !== item.origin || address.basePath !== item.basePath || servers.some(s => s.id === item.id)) throw new Error('Invalid server record');
      servers.push({ id: item.id, name: item.name, kind: item.kind, ...address });
    }
    return { selectedId: servers.some(s => s.id === parsed.selectedId) ? parsed.selectedId : servers[0]?.id ?? '', servers };
  }
  private write(value: Registry): void {
    this.store.set(registryKey, JSON.stringify({ ...value, servers: [...value.servers, ...this.dormantEther] }));
  }
  get(id: string): ServerRecord {
    const record = this.read().servers.find(s => s.id === id);
    if (!record) throw new Error('Server not found');
    return record;
  }
  /** The record for this address, added once; a server reached again keeps its ID and session. */
  add(kind: ServerKind, name: string, url: string): ServerRecord {
    if (!this.addable(kind) || !name.trim() || name.length > 100) throw new Error('Invalid server');
    const current = this.read(), address = serverAddress(url, kind);
    const known = current.servers.find(s => s.kind === kind && s.origin === address.origin && s.basePath === address.basePath);
    if (known) return known;
    const record = { id: randomId(), name: name.trim(), kind, ...address };
    this.write({ ...current, servers: [...current.servers, record] });
    return record;
  }
  select(id: string): void {
    const current = this.read();
    if (!current.servers.some(s => s.id === id)) throw new Error('Server not found');
    this.write({ ...current, selectedId: id });
  }
  /** A record's proven address and name replace the ones it was added with; its ID and session stay. */
  relocate(id: string, name: string, url: string): ServerRecord {
    const current = this.read(), known = current.servers.find(s => s.id === id);
    if (!known || known.id === 'ether' || !name.trim() || name.length > 100) throw new Error('Server not found');
    const address = serverAddress(url, known.kind);
    if (current.servers.some(s => s.id !== id && s.kind === known.kind && s.origin === address.origin && s.basePath === address.basePath)) throw new Error('Server already added');
    const record = { ...known, name: name.trim(), ...address };
    this.write({ ...current, servers: current.servers.map(s => s.id === id ? record : s) });
    return record;
  }
  remove(id: string): void {
    if (id === 'ether') throw new Error('Cannot remove the default server');
    const current = this.read();
    if (!current.servers.some(s => s.id === id)) throw new Error('Server not found');
    const servers = current.servers.filter(s => s.id !== id);
    this.write({ selectedId: current.selectedId === id ? servers[0]?.id ?? '' : current.selectedId, servers });
  }
}

/** Per-server credentials share one declared secret; the original Ether key remains intact. */
export class ServerCredentials {
  constructor(private readonly store: SecretStore, readonly device: import('../wire').Device,
    readonly refreshKey: () => string, private readonly id: string) {}
  private all(): Record<string, import('../wire').Tokens> {
    const raw = this.store.get('vela.server-sessions');
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid server sessions');
    return value;
  }
  async get(): Promise<import('../wire').Tokens | null> {
    const value = this.all()[this.id];
    return value ?? null;
  }
  async set(tokens: import('../wire').Tokens | null): Promise<void> {
    // A session that ends (signed out, refused, the server removed) takes its Plex account with it.
    if (!tokens) await this.setPlexAccount(null);
    const sessions = this.all();
    if (JSON.stringify(sessions[this.id] ?? null) === JSON.stringify(tokens)) return;
    if (tokens) sessions[this.id] = tokens;
    else delete sessions[this.id];
    // Every resource reading credentials re-asks on a write, so an unchanged session is not rewritten.
    this.store.set('vela.server-sessions', JSON.stringify(sessions));
  }
  private accounts(): Record<string, string> {
    const raw = this.store.get(PLEX_ACCOUNTS);
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Plex accounts');
    return value;
  }
  /**
   * A directly linked Plex server's plex.tv account token, kept beside its session only to list and
   * switch Plex Home members. It never reaches the server; it goes with the session.
   */
  async plexAccount(): Promise<string | null> {
    const value = this.accounts()[this.id];
    return typeof value === 'string' && value ? value : null;
  }
  async setPlexAccount(token: string | null): Promise<void> {
    const accounts = this.accounts();
    if ((accounts[this.id] ?? null) === token) return;
    if (token) accounts[this.id] = token;
    else delete accounts[this.id];
    this.store.set(PLEX_ACCOUNTS, JSON.stringify(accounts));
  }
}
const PLEX_ACCOUNTS = 'vela.plex-accounts';
