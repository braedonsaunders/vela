import { probeEther } from '../probe';
import { exchangePlexAccount } from '../ether/plex';
import type { Device, Tokens } from '../../wire';
import { createPlexPin, pollPlexPin, discoverPlexServers, plexAccount, plexHeaders, plexHomeUsers, switchPlexHomeUser, type PlexHomeUser, type PlexResource } from './auth';
import { timeoutSignal } from '../../protocol/timeout';

/** A discovered server as the viewer chooses it: names and connection kinds only. */
export type PlexConnectionKind = 'relay' | 'secure-direct' | 'secure' | 'local' | 'remote';
export interface PlexChoice { id: string; name: string; owned: boolean; connection: PlexConnectionKind; recommended: boolean }
export type PlexLinkState = 'waiting' | 'profiles' | 'linked' | 'expired' | 'failed';
/** A Plex Home member to sign in as, for the picker. */
export interface PlexProfileChoice { id: string; name: string; protected: boolean; avatarUrl?: string; restricted?: boolean }

const secure = (uri: string) => uri.startsWith('https://');
const direct = (uri: string) => { try { return new URL(uri).hostname.endsWith('.plex.direct'); } catch { return false; } };
const kind = (c: PlexResource['connections'][number]): PlexConnectionKind =>
  c.relay ? 'relay' : secure(c.uri) ? (direct(c.uri) ? 'secure-direct' : 'secure') : c.local ? 'local' : 'remote';

/**
 * plex.tv PIN linking (plex.tv/link) and server discovery. The account token lives only here,
 * in memory, for the duration of one link; only the chosen server's own token is ever stored.
 */
export class PlexLink {
  private pin?: { id: number; code: string; expiresAt: string };
  private account?: { token: string; viewer: Tokens['viewer'] };
  private resources: PlexResource[] = [];
  private exchangeKeys = new Map<string, string>();
  /** A Plex Home's members, between the PIN's approval and the viewer's choice of who signs in. */
  private home?: { token: string; users: PlexHomeUser[] };
  constructor(private readonly clientIdentifier: string) {}

  async start(): Promise<{ code: string; expiresAt: string }> {
    this.cancel();
    const pin = await createPlexPin(this.clientIdentifier);
    if (!Number.isInteger(pin.id) || typeof pin.code !== 'string' || !pin.code || !Number.isFinite(Date.parse(pin.expiresAt))) throw new Error('Plex returned an invalid link code');
    this.pin = { id: pin.id, code: pin.code, expiresAt: pin.expiresAt };
    return { code: pin.code, expiresAt: pin.expiresAt };
  }
  /** `at` is the foundation's clock; the data module keeps none. */
  async poll(code: string, at: number): Promise<PlexLinkState> {
    if (this.account && this.pin?.code === code) return 'linked';
    if (this.home && this.pin?.code === code) return 'profiles';
    const pin = this.pin;
    if (!pin || pin.code !== code) return 'failed';
    if (at >= Date.parse(pin.expiresAt)) { this.cancel(); return 'expired'; }
    let result;
    try { result = await pollPlexPin(this.clientIdentifier, pin); }
    catch (error) {
      // plex.tv forgets an expired PIN.
      if (error instanceof Error && /\(404\)/.test(error.message)) { this.cancel(); return 'expired'; }
      throw error;
    }
    if (this.pin !== pin) return 'failed';
    if (!result.authToken) return 'waiting';
    // A Plex Home asks who is watching first: each member sees the servers shared with them.
    const users = await plexHomeUsers(this.clientIdentifier, result.authToken).catch(() => []);
    if (this.pin !== pin) return 'failed';
    if (users.length > 1) { this.home = { token: result.authToken, users }; return 'profiles'; }
    await this.become(result.authToken);
    return this.pin === pin ? 'linked' : 'failed';
  }
  /** The Home's members, while the viewer chooses one. */
  profiles(code: string): PlexProfileChoice[] {
    if (!this.home || this.pin?.code !== code) return [];
    return this.home.users.map(u => ({ id: u.uuid, name: u.title || u.username || 'Plex user', protected: !!u.protected,
      ...(u.thumb && /^https:\/\//.test(u.thumb) ? { avatarUrl: u.thumb } : {}), ...(u.restricted ? { restricted: true } : {}) }));
  }
  /** Sign in as one member of the Home (with their PIN if they keep one): their servers, their token. */
  async chooseProfile(code: string, id: string, pin?: string): Promise<PlexLinkState> {
    const home = this.home, link = this.pin;
    const user = home?.users.find(u => u.uuid === id);
    if (!home || !link || link.code !== code || !user) throw new Error('Link Plex again to choose a profile');
    const switched = await switchPlexHomeUser(this.clientIdentifier, home.token, id, pin);
    if (this.home !== home || this.pin !== link) return 'failed';
    await this.become(switched.authToken);
    if (this.pin !== link) return 'failed';
    this.home = undefined;
    return 'linked';
  }
  private async become(token: string): Promise<void> {
    const pin = this.pin;
    const [resources, account] = await Promise.all([discoverPlexServers(this.clientIdentifier, token), plexAccount(this.clientIdentifier, token)]);
    if (this.pin !== pin) return;
    this.resources = resources.filter(r => r.accessToken && r.clientIdentifier && r.connections.length);
    this.account = { token, viewer: { id: account.uuid || String(account.id), name: account.friendlyName || account.title || account.username, policyRevision: 'plex' } };
  }
  /** Refresh the newly linked account's view: plex.tv can lag the PIN approval. */
  async refreshServers(code: string): Promise<void> {
    const account = this.account;
    if (!account || this.pin?.code !== code) return;
    const resources = await discoverPlexServers(this.clientIdentifier, account.token);
    if (this.account === account && this.pin?.code === code) {
      this.resources = resources.filter(r => r.accessToken && r.clientIdentifier && r.connections.length);
    }
  }
  async hasEtherServer(code: string, pageSecure: boolean): Promise<boolean> {
    if (!this.account || this.pin?.code !== code) return false;
    const origins = [...new Set(this.resources.flatMap(r => this.reachable(r, pageSecure).map(c => new URL(c.uri).origin)))];
    const found = await Promise.all(origins.map(origin => probeEther(origin)));
    return found.some(Boolean);
  }
  servers(code: string, pageSecure: boolean): PlexChoice[] {
    if (!this.account || this.pin?.code !== code) return [];
    const usable = this.resources.map(r => ({ r, connections: this.reachable(r, pageSecure) })).filter(x => x.connections.length);
    const pick = usable.find(x => x.r.owned && secure(x.connections[0].uri) && !x.connections[0].relay) ?? usable[0];
    return usable.map(x => ({ id: x.r.clientIdentifier, name: x.r.name, owned: x.r.owned, connection: kind(x.connections[0]), recommended: x === pick }));
  }
  /** A secure page cannot read plain-HTTP servers. plex.direct HTTPS first, relays last. */
  private reachable(resource: PlexResource, pageSecure: boolean) {
    const rank = (c: PlexResource['connections'][number]) => c.relay ? 4 : secure(c.uri) && direct(c.uri) ? 0 : c.local ? 1 : secure(c.uri) ? 2 : 3;
    return resource.connections.filter(c => !pageSecure || secure(c.uri)).sort((a, b) => rank(a) - rank(b));
  }
  /**
   * The chosen server's first connection that proves it is that server: its own `/identity`
   * must name the resource's machine identifier, read with redirects refused.
   */
  async choose(code: string, id: string, pageSecure: boolean, signIn: { device: Device; idempotencyKey: string }): Promise<{ kind: 'ether' | 'plex'; name: string; origin: string; origins: string[]; tokens: Tokens | null; note?: string }> {
    const resource = this.resources.find(r => r.clientIdentifier === id);
    const account = this.account;
    if (!account || this.pin?.code !== code || !resource) throw new Error('Link Plex again to choose a server');
    for (const connection of this.reachable(resource, pageSecure)) {
      const origin = new URL(connection.uri).origin;
      try {
        const response = await fetch(`${origin}/identity`, { headers: { ...plexHeaders(this.clientIdentifier), 'X-Plex-Token': resource.accessToken },
          redirect: 'error', credentials: 'omit', signal: timeoutSignal(6000) });
        if (!response.ok) continue;
        const body = await response.json() as { MediaContainer?: { machineIdentifier?: string } };
        if (body.MediaContainer?.machineIdentifier !== resource.clientIdentifier) continue;
      } catch { continue; }
      const ether = await probeEther(origin);
      if (this.account !== account || this.pin?.code !== code) throw new Error('Link Plex again to choose a server');
      const exchangeKey = this.exchangeKeys.get(id) ?? signIn.idempotencyKey;
      this.exchangeKeys.set(id, exchangeKey);
      if (ether && !ether.plexAccountSignIn) {
        // Older Ether is still a usable server. Keep the verified choice, but never treat the
        // Plex resource/account token as an Ether session; continue with its own sign-in methods.
        this.cancel();
        return { kind: 'ether', name: ether.name || resource.name || 'Ether', origin,
          origins: [origin], tokens: null, note: 'Plex sign-in needs Ether 0.3.16 or later' };
      }
      const tokens: Tokens = ether
        ? await exchangePlexAccount(origin, account.token, signIn.device, exchangeKey)
        : { accessToken: resource.accessToken, refreshToken: '', expiresAt: '9999-12-31T23:59:59Z', viewer: account.viewer };
      if (this.account !== account || this.pin?.code !== code) throw new Error('Link Plex again to choose a server');
      this.cancel();
      // Every address this server publishes, so a record added by one of them is recognised as this server.
      const origins = resource.connections.flatMap(c => { try { return [new URL(c.uri).origin]; } catch { return []; } });
      return { kind: ether ? 'ether' : 'plex', name: ether?.name || resource.name || 'Plex', origin, origins, tokens };
    }
    throw new Error('This Plex server could not be reached from here');
  }
  cancel(): void { this.pin = undefined; this.account = undefined; this.home = undefined; this.resources = []; this.exchangeKeys.clear(); }
}
