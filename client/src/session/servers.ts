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

/** The Ether server is implicit, so old installs continue using the existing session. */
export class ServerRegistry {
  constructor(private readonly store: SecretStore, private readonly etherOrigin: string) {}
  read(): Registry {
    const ether: ServerRecord = { id: 'ether', name: 'Vela', kind: 'ether', origin: this.etherOrigin, basePath: '/' };
    const raw = this.store.get(registryKey);
    if (!raw) return { selectedId: ether.id, servers: [ether] };
    const parsed = JSON.parse(raw) as Registry;
    if (!parsed || !Array.isArray(parsed.servers) || typeof parsed.selectedId !== 'string') throw new Error('Invalid server registry');
    const servers = [ether];
    for (const item of parsed.servers) {
      if (!item || item.id === 'ether') continue;
      if (!/^[a-f0-9-]{36}$/.test(item.id) || !['jellyfin', 'emby', 'plex'].includes(item.kind) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100) throw new Error('Invalid server record');
      const address = serverAddress(item.origin + (item.basePath === '/' ? '' : item.basePath), item.kind);
      if (address.origin !== item.origin || address.basePath !== item.basePath || servers.some(s => s.id === item.id)) throw new Error('Invalid server record');
      servers.push({ id: item.id, name: item.name, kind: item.kind, ...address });
    }
    return { selectedId: servers.some(s => s.id === parsed.selectedId) ? parsed.selectedId : 'ether', servers };
  }
  private write(value: Registry): void { this.store.set(registryKey, JSON.stringify(value)); }
  get(id: string): ServerRecord {
    const record = this.read().servers.find(s => s.id === id);
    if (!record) throw new Error('Server not found');
    return record;
  }
  /** The record for this address, added once; a server reached again keeps its ID and session. */
  add(kind: Exclude<ServerKind, 'ether'>, name: string, url: string): ServerRecord {
    if (!['jellyfin', 'emby', 'plex'].includes(kind) || !name.trim() || name.length > 100) throw new Error('Invalid server');
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
  remove(id: string): void {
    if (id === 'ether') throw new Error('Cannot remove the default server');
    const current = this.read();
    if (!current.servers.some(s => s.id === id)) throw new Error('Server not found');
    this.write({ selectedId: current.selectedId === id ? 'ether' : current.selectedId, servers: current.servers.filter(s => s.id !== id) });
  }
}

/** Per-server credentials share one declared secret; the original Ether key remains intact. */
export class ServerCredentials {
  constructor(private readonly store: SecretStore, readonly device: import('../../wire/v0/types').Device,
    readonly refreshKey: () => string, private readonly id: string) {}
  private all(): Record<string, import('../../wire/v0/types').Tokens> {
    const raw = this.store.get('vela.server-sessions');
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid server sessions');
    return value;
  }
  async get(): Promise<import('../../wire/v0/types').Tokens | null> {
    const value = this.all()[this.id];
    return value ?? null;
  }
  async set(tokens: import('../../wire/v0/types').Tokens | null): Promise<void> {
    const sessions = this.all();
    if (JSON.stringify(sessions[this.id] ?? null) === JSON.stringify(tokens)) return;
    if (tokens) sessions[this.id] = tokens;
    else delete sessions[this.id];
    // Every resource reading credentials re-asks on a write, so an unchanged session is not rewritten.
    this.store.set('vela.server-sessions', JSON.stringify(sessions));
  }
}
