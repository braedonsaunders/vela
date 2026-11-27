import { serverAddress, type ServerKind } from '../session/servers';
import { plexHeaders, type PlexDevice } from './plex/auth';
import { timeoutSignal } from '../protocol/timeout';

/** What an address answers before any credential is sent. */
export interface Probe {
  /** insecure: a secure page cannot read a plain-HTTP server (mixed content), so it was not asked. */
  state: 'found' | 'invalid' | 'unreachable' | 'unsupported' | 'insecure';
  kind: ServerKind | '';
  name: string;
  version: string;
  machineIdentifier?: string;
  /** The address a record would keep: origin plus base path, no user-info, query or fragment. */
  url: string;
}

const PROBE_MS = 6000;

/** Public reads with redirects refused, so an address is identified only by what it serves itself. No Vela or server
 * credential is sent; only a same-origin auth proxy's own cookie, which it needs to admit the request at all. */
async function read(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(url, { headers, redirect: 'error', credentials: 'same-origin', signal: timeoutSignal(PROBE_MS) });
    if (!response.ok) return undefined;
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}
const text = (value: unknown, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Which candidate addresses to try: an address without a scheme is tried over HTTPS first. */
function candidates(input: string): string[] {
  const value = input.trim();
  if (!value || value.length > 2048) return [];
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? [value] : [`https://${value}`, `http://${value}`];
}

/**
 * Identify a server by its public endpoints: Jellyfin and Emby `System/Info/Public`, Plex `/identity`,
 * Vela `/vela/v0/capabilities`. Every read is bounded; nothing here carries a credential. Ether also
 * answers in other servers' protocols, so its own endpoint decides first. It is offered (`found`)
 * only where Ether servers can be added (a standalone app); elsewhere it is `unsupported`.
 */
export async function probeServer(input: string, device: PlexDevice, pageSecure: boolean, ether = false): Promise<Probe> {
  const tried = candidates(input);
  let parsed = false, blocked = '';
  for (const candidate of tried) {
    let address: { origin: string; basePath: string };
    try { address = serverAddress(candidate, 'jellyfin'); } catch { continue; }
    parsed = true;
    // The browser refuses plain HTTP from an HTTPS page; say so instead of reporting silence.
    if (pageSecure && address.origin.startsWith('http:')) { blocked ||= address.origin + (address.basePath === '/' ? '' : address.basePath); continue; }
    const base = address.origin + (address.basePath === '/' ? '' : address.basePath);
    const [jellyfin, plex, vela] = await Promise.all([
      read(`${base}/System/Info/Public`, { Accept: 'application/json' }),
      address.basePath === '/' ? read(`${address.origin}/identity`, plexHeaders(device)) : Promise.resolve(undefined),
      address.basePath === '/' ? read(`${address.origin}/vela/v0/capabilities`, { Accept: 'application/json' }) : Promise.resolve(undefined),
    ]);
    const server = (vela?.server ?? undefined) as Record<string, unknown> | undefined;
    if (server && vela?.protocolVersion === 0) return { state: ether ? 'found' : 'unsupported', kind: 'ether', name: text(server.name), version: text(server.version, 40), url: address.origin };
    if (jellyfin && text(jellyfin.Id) && text(jellyfin.Version)) {
      // Jellyfin names itself; Emby's public info carries no Jellyfin product name.
      const kind: ServerKind = /jellyfin/i.test(text(jellyfin.ProductName)) ? 'jellyfin' : 'emby';
      return { state: 'found', kind, name: text(jellyfin.ServerName), version: text(jellyfin.Version, 40), url: base };
    }
    const identity = plex?.MediaContainer as Record<string, unknown> | undefined;
    const machine = plexMachine(identity?.machineIdentifier);
    if (machine) return { state: 'found', kind: 'plex', name: '', version: text(identity?.version, 40), url: address.origin, machineIdentifier: machine };
    // Any readable answer (even an error page) means the address is reachable but not a media server.
    if (await fetch(base, { method: 'HEAD', redirect: 'manual', credentials: 'same-origin', signal: timeoutSignal(PROBE_MS) }).then(() => true, () => false)) return { state: 'unsupported', kind: '', name: '', version: '', url: base };
  }
  if (blocked) return { state: 'insecure', kind: '', name: '', version: '', url: blocked };
  return { state: parsed ? 'unreachable' : 'invalid', kind: '', name: '', version: '', url: '' };
}

/** Identify a saved address without sending any Plex credentials. */
export async function probePlexMachine(origin: string, device: PlexDevice, secure: boolean): Promise<string | undefined> {
  if (secure && origin.startsWith('http:')) return undefined;
  const body = await read(`${origin}/identity`, plexHeaders(device));
  return plexMachine((body?.MediaContainer as { machineIdentifier?: unknown } | undefined)?.machineIdentifier);
}

function plexMachine(machine: unknown): string | undefined {
  return typeof machine === 'string' && machine.length > 0 && machine.length <= 128 && !/\s/.test(machine) ? machine : undefined;
}

/** Detect a Vela endpoint without sending this server's credentials. */
export async function probeEther(origin: string, timeoutMs = 3000): Promise<{ origin: string; id: string; name: string; plexAccountSignIn: boolean } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const response = await fetch(`${url.origin}/vela/v0/capabilities`, { headers: { Accept: 'application/json' }, credentials: 'same-origin', redirect: 'error', signal: controller.signal });
    if (response.status !== 200 || !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) return null;
    const value = await response.json();
    if (!value || typeof value !== 'object' || typeof value.protocolVersion !== 'number' || !value.server || typeof value.server.id !== 'string' || !value.server.id || typeof value.server.name !== 'string' || !value.server.name || !value.features || typeof value.features !== 'object' || Array.isArray(value.features)) return null;
    return { origin: url.origin, id: value.server.id, name: value.server.name, plexAccountSignIn: value.plexAccountSignIn === true };
  } catch { return null; } finally { clearTimeout(timer); }
}
