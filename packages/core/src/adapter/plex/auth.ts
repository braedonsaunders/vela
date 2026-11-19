/** plex.tv account credentials never enter a PMS request. Store returned secrets in the SecretStore. */
export interface PlexPin { id: number; code: string; expiresAt: string; authToken?: string }
export interface PlexResource { name: string; clientIdentifier: string; accessToken: string; owned: boolean;
  connections: { uri: string; local: boolean; relay: boolean; protocol: string }[] }
export function plexHeaders(clientIdentifier: string): Record<string, string> {
  if (!clientIdentifier) throw new Error('A stable Plex client identifier is required');
  return { Accept: 'application/json', 'X-Plex-Product': 'Vela', 'X-Plex-Version': '0.1',
    'X-Plex-Client-Identifier': clientIdentifier, 'X-Plex-Platform': 'Web', 'X-Plex-Device-Name': 'Vela' };
}
async function cloud<T>(path: string, clientIdentifier: string, method = 'GET', accountToken?: string): Promise<T> {
  const url = new URL(path, 'https://plex.tv');
  if (url.origin !== 'https://plex.tv' || !url.pathname.startsWith('/api/v2/')) throw new Error('Invalid Plex account endpoint');
  const response = await fetch(url.href, { method, cache: 'no-store', redirect: 'error', credentials: 'omit',
    headers: { ...plexHeaders(clientIdentifier), ...(accountToken ? { 'X-Plex-Token': accountToken } : {}) } });
  if (!response.ok) throw new Error(`Plex account request failed (${response.status})`);
  return response.json() as Promise<T>;
}
export function createPlexPin(clientIdentifier: string): Promise<PlexPin> {
  // Short PINs can be entered on plex.tv/link on another device.
  return cloud('/api/v2/pins?strong=false', clientIdentifier, 'POST');
}
export function pollPlexPin(clientIdentifier: string, pin: Pick<PlexPin, 'id' | 'code'>): Promise<PlexPin> {
  return cloud(`/api/v2/pins/${encodeURIComponent(pin.id)}?code=${encodeURIComponent(pin.code)}`, clientIdentifier);
}
export async function discoverPlexServers(clientIdentifier: string, accountToken: string): Promise<PlexResource[]> {
  const resources = await cloud<(PlexResource & { provides: string })[]>('/api/v2/resources?includeHttps=1&includeRelay=1', clientIdentifier, 'GET', accountToken);
  return resources.filter(r => r.provides.split(',').includes('server')).map(r => ({ ...r, connections: r.connections.filter(c => {
    try { const u = new URL(c.uri); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash; } catch { return false; }
  }).sort((a, b) => Number(b.protocol === 'https') - Number(a.protocol === 'https') || Number(a.relay) - Number(b.relay)) }));
}
export interface PlexAccount { id: number; uuid?: string; username: string; title?: string; friendlyName?: string }
export function plexAccount(clientIdentifier: string, accountToken: string): Promise<PlexAccount> {
  return cloud('/api/v2/user', clientIdentifier, 'GET', accountToken);
}
