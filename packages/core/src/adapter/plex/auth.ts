/** plex.tv account credentials never enter a PMS request. Store returned secrets in the SecretStore. */
export interface PlexPin { id: number; code: string; expiresAt: string; authToken?: string }
export interface PlexResource { name: string; clientIdentifier: string; accessToken: string; owned: boolean;
  connections: { uri: string; local: boolean; relay: boolean; protocol: string }[] }
import type { Device } from '../../wire';

/** This device as Plex names it: the client identifier, the name shown in Plex's devices and
 * dashboard, and the platform and device Plex picks a client profile (and so transcodes) from. */
export type PlexDevice = Pick<Device, 'id' | 'name' | 'platform' | 'appVersion'>;

/** Vela's platform names (`Device.platform`) as Plex's own clients report them. */
const PLEX_PLATFORMS: Record<string, { platform: string; device: string }> = {
  ios: { platform: 'iOS', device: 'iPhone' },
  ipados: { platform: 'iOS', device: 'iPad' },
  tvos: { platform: 'tvOS', device: 'Apple TV' },
  android: { platform: 'Android', device: 'Android' },
  androidtv: { platform: 'Android', device: 'Android TV' },
  macos: { platform: 'macOS', device: 'Mac' },
  windows: { platform: 'Windows', device: 'Windows' },
  linux: { platform: 'Linux', device: 'Linux' },
  web: { platform: 'Web', device: 'Browser' },
};

export function plexHeaders(device: PlexDevice): Record<string, string> {
  if (!device.id) throw new Error('A stable Plex client identifier is required');
  const known = PLEX_PLATFORMS[device.platform] ?? PLEX_PLATFORMS.web!;
  return { Accept: 'application/json', 'X-Plex-Product': 'Vela', 'X-Plex-Version': device.appVersion || '0',
    'X-Plex-Client-Identifier': device.id, 'X-Plex-Platform': known.platform, 'X-Plex-Device': known.device,
    'X-Plex-Device-Name': device.name || 'Vela' };
}
async function cloud<T>(path: string, device: PlexDevice, method = 'GET', accountToken?: string): Promise<T> {
  const url = new URL(path, 'https://plex.tv');
  if (url.origin !== 'https://plex.tv' || !url.pathname.startsWith('/api/v2/')) throw new Error('Invalid Plex account endpoint');
  const response = await fetch(url.href, { method, cache: 'no-store', redirect: 'error', credentials: 'omit',
    headers: { ...plexHeaders(device), ...(accountToken ? { 'X-Plex-Token': accountToken } : {}) } });
  if (!response.ok) throw new Error(response.status === 429 ? 'Too many Plex sign-in attempts. Wait before trying again.' : 'Plex is temporarily unavailable. Wait before trying again.');
  return response.json() as Promise<T>;
}
export function createPlexPin(device: PlexDevice, strong = false): Promise<PlexPin> {
  // Short PINs can be entered on plex.tv/link on another device; browser authorization uses a
  // strong PIN that is never typed by the viewer.
  return cloud(`/api/v2/pins?strong=${strong}`, device, 'POST');
}
export function plexAuthUrl(clientIdentifier: string, code: string): string {
  const query = new URLSearchParams({ clientID: clientIdentifier, code, 'context[device][product]': 'Vela' });
  return `https://app.plex.tv/auth/#!?${query}`;
}
export function pollPlexPin(device: PlexDevice, pin: Pick<PlexPin, 'id' | 'code'>): Promise<PlexPin> {
  return cloud(`/api/v2/pins/${encodeURIComponent(pin.id)}?code=${encodeURIComponent(pin.code)}`, device);
}
export async function discoverPlexServers(device: PlexDevice, accountToken: string): Promise<PlexResource[]> {
  const resources = await cloud<(PlexResource & { provides: string })[]>('/api/v2/resources?includeHttps=1&includeRelay=1', device, 'GET', accountToken);
  return resources.filter(r => r.provides.split(',').includes('server')).map(r => ({ ...r, connections: r.connections.filter(c => {
    try { const u = new URL(c.uri); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash; } catch { return false; }
  }).sort((a, b) => Number(b.protocol === 'https') - Number(a.protocol === 'https') || Number(a.relay) - Number(b.relay)) }));
}
export interface PlexAccount { id: number; uuid?: string; username: string; title?: string; friendlyName?: string }
export function plexAccount(device: PlexDevice, accountToken: string): Promise<PlexAccount> {
  return cloud('/api/v2/user', device, 'GET', accountToken);
}
