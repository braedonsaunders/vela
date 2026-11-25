import type { Tokens } from '../../wire';
import { discoverPlexServers, plexAccount, plexHeaders, plexHomeUsers, switchPlexHomeUser, type PlexAccount, type PlexDevice, type PlexHomeUser } from './auth';
import { timeoutSignal } from '../../protocol/timeout';

/** A Plex Home member to sign in as, for the picker. */
export interface PlexProfileChoice { id: string; name: string; protected: boolean; avatarUrl?: string; restricted?: boolean }

/** The Home's members as the picker shows them: names, PIN protection and an https avatar only. */
export function plexProfileChoices(users: PlexHomeUser[]): PlexProfileChoice[] {
  return users.map(u => ({ id: u.uuid, name: u.title || u.username || 'Plex user', protected: !!u.protected,
    ...(u.thumb && /^https:\/\//.test(u.thumb) ? { avatarUrl: u.thumb } : {}), ...(u.restricted ? { restricted: true } : {}) }));
}

/** The viewer a plex.tv account signs in as. */
export function plexViewer(account: PlexAccount): Tokens['viewer'] {
  return { id: account.uuid || String(account.id), name: account.friendlyName || account.title || account.username, policyRevision: 'plex' };
}

/** A directly linked server's session: Plex Media Server tokens do not expire or refresh. */
export function plexServerTokens(accessToken: string, viewer: Tokens['viewer']): Tokens {
  return { accessToken, refreshToken: '', expiresAt: '9999-12-31T23:59:59Z', viewer };
}

/** Who can watch on this device: the Home's members, or none when the account is in no Home. */
export async function plexServerProfiles(device: PlexDevice, accountToken: string): Promise<PlexProfileChoice[]> {
  const users = await plexHomeUsers(device, accountToken);
  return users.length > 1 ? plexProfileChoices(users) : [];
}

/** The chosen member has no share of this server, so switching to them would sign this device out. */
export class PlexProfileWithoutServer extends Error {
  constructor() { super('This Plex Home profile does not have access to this server.'); this.name = 'PlexProfileWithoutServer'; }
}

/** The server turned the member's token down, so switching to them would sign this device out. */
export class PlexProfileRefusedByServer extends Error {
  constructor() { super('This server did not accept this Plex Home profile.'); this.name = 'PlexProfileRefusedByServer'; }
}

/**
 * Become another member of the Plex Home on one directly linked server. plex.tv issues the member's
 * account token, and this server's own token for them comes from their resources, matched by the
 * server's machine identifier (never by address: the record keeps its address). The server must
 * accept that token before it replaces the current session.
 */
export async function switchPlexServerProfile(device: PlexDevice, accountToken: string, profileId: string, pin: string | undefined, machineIdentifier: string, origin: string): Promise<{ tokens: Tokens; accountToken: string }> {
  if (!machineIdentifier) throw new Error('This Plex server has not identified itself yet. Try again.');
  const switched = await switchPlexHomeUser(device, accountToken, profileId, pin);
  const [resources, account] = await Promise.all([discoverPlexServers(device, switched.authToken), plexAccount(device, switched.authToken)]);
  const resource = resources.find(r => r.clientIdentifier === machineIdentifier && r.accessToken);
  if (!resource) throw new PlexProfileWithoutServer();
  const answer = await fetch(`${origin}/library/sections`, { headers: { ...plexHeaders(device), 'X-Plex-Token': resource.accessToken },
    redirect: 'error', credentials: 'omit', signal: timeoutSignal(10_000) }).catch(() => { throw new Error('This Plex server could not be reached. Try again.'); });
  if (answer.status === 401 || answer.status === 403) throw new PlexProfileRefusedByServer();
  if (!answer.ok) throw new Error('This Plex server could not switch profiles just now. Try again.');
  return { tokens: plexServerTokens(resource.accessToken, plexViewer(account)), accountToken: switched.authToken };
}
