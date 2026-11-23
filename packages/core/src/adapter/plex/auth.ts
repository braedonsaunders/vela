/** plex.tv account credentials never enter a PMS request. Store returned secrets in the SecretStore. */
export interface PlexPin { id: number; code: string; expiresAt: string; authToken?: string }
export interface PlexResource { name: string; clientIdentifier: string; accessToken: string; owned: boolean;
  connections: { uri: string; local: boolean; relay: boolean; protocol: string }[] }
export function plexHeaders(clientIdentifier: string): Record<string, string> {
  if (!clientIdentifier) throw new Error('A stable Plex client identifier is required');
  return { Accept: 'application/json', 'X-Plex-Product': 'Vela', 'X-Plex-Version': '0.1',
    'X-Plex-Client-Identifier': clientIdentifier, 'X-Plex-Platform': 'Web', 'X-Plex-Device-Name': 'Vela' };
}
async function cloud<T>(path: string, clientIdentifier: string, method = 'GET', accountToken?: string, refused?: string): Promise<T> {
  const url = new URL(path, 'https://plex.tv');
  if (url.origin !== 'https://plex.tv' || !url.pathname.startsWith('/api/v2/')) throw new Error('Invalid Plex account endpoint');
  const response = await fetch(url.href, { method, cache: 'no-store', redirect: 'error', credentials: 'omit',
    headers: { ...plexHeaders(clientIdentifier), ...(accountToken ? { 'X-Plex-Token': accountToken } : {}) } });
  if (!response.ok) throw new Error(response.status === 429 ? 'Too many Plex sign-in attempts. Wait before trying again.'
    : refused && [401, 403, 422].includes(response.status) ? refused : 'Plex is temporarily unavailable. Wait before trying again.');
  return response.json() as Promise<T>;
}
export function createPlexPin(clientIdentifier: string, strong = false): Promise<PlexPin> {
  // Short PINs can be entered on plex.tv/link on another device; browser authorization uses a
  // strong PIN that is never typed by the viewer.
  return cloud(`/api/v2/pins?strong=${strong}`, clientIdentifier, 'POST');
}
export function plexAuthUrl(clientIdentifier: string, code: string): string {
  const query = new URLSearchParams({ clientID: clientIdentifier, code, 'context[device][product]': 'Vela' });
  return `https://app.plex.tv/auth/#!?${query}`;
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

/** A Plex Home member as plex.tv lists them (GET /api/v2/home/users). */
export interface PlexHomeUser { id: number; uuid: string; title: string; username?: string; thumb?: string; protected?: boolean; admin?: boolean; restricted?: boolean; guest?: boolean }
/** The members of the account's Plex Home; an account outside a Home has only itself (or none). */
export async function plexHomeUsers(clientIdentifier: string, accountToken: string): Promise<PlexHomeUser[]> {
  const body = await cloud<{ users?: PlexHomeUser[] } | PlexHomeUser[]>('/api/v2/home/users', clientIdentifier, 'GET', accountToken);
  return (Array.isArray(body) ? body : body.users ?? []).filter(u => u && typeof u.uuid === 'string' && !!u.uuid && !u.guest);
}
/** Become another member of the Home: plex.tv answers with that member's own account token. */
export async function switchPlexHomeUser(clientIdentifier: string, accountToken: string, uuid: string, pin?: string): Promise<PlexAccount & { authToken: string }> {
  const query = pin ? `?pin=${encodeURIComponent(pin)}` : '';
  const user = await cloud<PlexAccount & { authToken?: string; authenticationToken?: string }>(`/api/v2/home/users/${encodeURIComponent(uuid)}/switch${query}`, clientIdentifier, 'POST', accountToken,
    pin ? 'That Plex Home PIN was not accepted.' : 'This Plex Home profile needs its PIN.');
  const authToken = user.authToken ?? user.authenticationToken;
  if (typeof authToken !== 'string' || !authToken) throw new Error('Plex did not switch to this profile');
  return { ...user, authToken };
}
