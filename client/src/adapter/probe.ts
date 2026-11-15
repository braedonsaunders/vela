import { serverAddress, type ServerKind } from '../session/servers';
import { plexHeaders } from './plex/auth';

/** What an address answers before any credential is sent. */
export interface Probe {
  /** insecure: a secure page cannot read a plain-HTTP server (mixed content), so it was not asked. */
  state: 'found' | 'invalid' | 'unreachable' | 'unsupported' | 'insecure';
  kind: ServerKind | '';
  name: string;
  version: string;
  /** The address a record would keep: origin plus base path, no user-info, query or fragment. */
  url: string;
}

const PROBE_MS = 6000;

/** Public, credential-free reads with redirects refused, so an address is identified only by what it serves itself. */
async function read(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(url, { headers, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(PROBE_MS) });
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
 * Vela `/vela/v0/capabilities`. Every read is bounded; nothing here carries a credential.
 */
export async function probeServer(input: string, clientIdentifier: string, pageSecure: boolean): Promise<Probe> {
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
      address.basePath === '/' ? read(`${address.origin}/identity`, plexHeaders(clientIdentifier)) : Promise.resolve(undefined),
      address.basePath === '/' ? read(`${address.origin}/vela/v0/capabilities`, { Accept: 'application/json' }) : Promise.resolve(undefined),
    ]);
    if (jellyfin && text(jellyfin.Id) && text(jellyfin.Version)) {
      // Jellyfin names itself; Emby's public info carries no Jellyfin product name.
      const kind: ServerKind = /jellyfin/i.test(text(jellyfin.ProductName)) ? 'jellyfin' : 'emby';
      return { state: 'found', kind, name: text(jellyfin.ServerName), version: text(jellyfin.Version, 40), url: base };
    }
    const identity = plex?.MediaContainer as Record<string, unknown> | undefined;
    if (identity && text(identity.machineIdentifier)) return { state: 'found', kind: 'plex', name: '', version: text(identity.version, 40), url: address.origin };
    const server = (vela?.server ?? undefined) as Record<string, unknown> | undefined;
    if (server && vela?.protocolVersion === 0) return { state: 'unsupported', kind: 'ether', name: text(server.name), version: text(server.version, 40), url: address.origin };
    // Any readable answer (even an error page) means the address is reachable but not a media server.
    if (await fetch(base, { method: 'HEAD', redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(PROBE_MS) }).then(() => true, () => false)) return { state: 'unsupported', kind: '', name: '', version: '', url: base };
  }
  if (blocked) return { state: 'insecure', kind: '', name: '', version: '', url: blocked };
  return { state: parsed ? 'unreachable' : 'invalid', kind: '', name: '', version: '', url: '' };
}
