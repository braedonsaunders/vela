import type { Device, PlexAccountSignIn, PlexHomeProfile, PlexHomeSignInRequest, Tokens } from '../../wire';
import { timeoutSignal } from '../../protocol/timeout';

/** Exchange only after a chosen Plex identity has been proven and Ether advertises support.
 * The account token is sent once in a JSON body, never stored as a Vela session or URL. */
export async function exchangePlexAccount(origin: string, plexToken: string, device: Device, idempotencyKey: string): Promise<Tokens> {
  return plexRequest(origin, '/auth/plex', { plexToken, device, idempotencyKey }, false) as Promise<Tokens>;
}

/** Ask a capable Ether to return either the only eligible viewer or an opaque profile challenge. */
export async function beginPlexHomeSignIn(origin: string, plexToken: string, device: Device, idempotencyKey: string): Promise<PlexAccountSignIn> {
  return plexRequest(origin, '/auth/plex', { plexToken, selectProfile: true, device, idempotencyKey }, true);
}

/** Complete a bounded profile challenge without sending the Plex account token a second time. */
export async function selectPlexHomeProfile(origin: string, request: PlexHomeSignInRequest): Promise<Tokens> {
  return plexRequest(origin, '/auth/plex/profile', request, false) as Promise<Tokens>;
}

async function plexRequest(origin: string, path: string, body: object, allowSelection: boolean): Promise<PlexAccountSignIn> {
  const response = await fetch(`${origin}/vela/v0${path}`, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: timeoutSignal(15000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Do not echo upstream bodies: neither a Plex credential nor an internal diagnostic is UI text.
    if (response.status === 403) throw new Error(path.endsWith('/profile') ? 'This Plex Home profile is not available on this server.' : 'Ask the server owner to share this server with your Plex account.');
    if (response.status === 401) throw new Error(path.endsWith('/profile') ? 'That Plex Home PIN was not accepted.' : 'This Plex account could not sign in to Ether. Link Plex again.');
    if (response.status === 429) throw new Error('Too many sign-in attempts. Wait before trying again.');
    if (response.status === 503) throw new Error('Plex is temporarily unavailable. Wait before trying again.');
    throw new Error('Ether could not complete Plex sign-in. Please try again.');
  }
  const value = await response.json() as PlexAccountSignIn;
  if (allowSelection && validSelection(value)) {
    return { ...value, profiles: value.profiles.map(profile => {
      const { avatarUrl, ...rest } = profile;
      const avatar = profileAvatar(origin, avatarUrl);
      return avatar ? { ...rest, avatarUrl: avatar } : rest;
    }) };
  }
  const tokens = value as Tokens;
  if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken ||
      typeof tokens.expiresAt !== 'string' || !Number.isFinite(Date.parse(tokens.expiresAt)) || !tokens.viewer || typeof tokens.viewer.id !== 'string' || !tokens.viewer.id ||
      typeof tokens.viewer.name !== 'string' || typeof tokens.viewer.policyRevision !== 'string') {
    throw new Error('Ether returned an invalid sign-in response.');
  }
  return tokens;
}

function validSelection(value: PlexAccountSignIn): value is import('../../wire').PlexHomeSelection {
  const candidate = value as { selectionToken?: unknown; expiresAt?: unknown; profiles?: unknown };
  if (typeof candidate.selectionToken !== 'string' || !candidate.selectionToken || candidate.selectionToken.length > 512
    || typeof candidate.expiresAt !== 'string' || !Number.isFinite(Date.parse(candidate.expiresAt)) || !Array.isArray(candidate.profiles)
    || candidate.profiles.length < 2 || candidate.profiles.length > 32) return false;
  return candidate.profiles.every((profile: PlexHomeProfile) => profile && typeof profile.id === 'string' && !!profile.id
    && typeof profile.name === 'string' && !!profile.name.trim() && profile.name.length <= 80 && typeof profile.protected === 'boolean'
    && (profile.restricted === undefined || typeof profile.restricted === 'boolean'));
}

/**
 * A Plex Home avatar as Ether serves it: a sealed, short-lived image path on the same server
 * (/vela/v0/images/plexavatar-…), usually relative. It resolves against the server's origin; any
 * other URL is dropped (the profile shows initials) rather than invalidating the whole selection.
 */
export function profileAvatar(origin: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2048) return undefined;
  try {
    const server = new URL(origin);
    const url = new URL(value, `${server.origin}/`);
    return url.origin === server.origin && url.pathname.startsWith('/vela/v0/images/') && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
