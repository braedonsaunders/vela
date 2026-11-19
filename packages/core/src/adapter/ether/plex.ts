import type { Device, Tokens } from '../../wire';
import { timeoutSignal } from '../../protocol/timeout';

/** Exchange only after a chosen Plex identity has been proven and Ether advertises support.
 * The account token is sent once in a JSON body, never stored as a Vela session or URL. */
export async function exchangePlexAccount(origin: string, plexToken: string, device: Device, idempotencyKey: string): Promise<Tokens> {
  const response = await fetch(`${origin}/vela/v0/auth/plex`, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: timeoutSignal(15000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ plexToken, device, idempotencyKey }),
  });
  if (!response.ok) {
    // Do not echo upstream bodies: neither a Plex credential nor an internal diagnostic is UI text.
    if (response.status === 403) throw new Error('Ask the server owner to share this server with your Plex account.');
    if (response.status === 401) throw new Error('This Plex account could not sign in to Ether. Link Plex again.');
    if (response.status === 429) throw new Error('Too many sign-in attempts. Wait before trying again.');
    if (response.status === 503) throw new Error('Plex is temporarily unavailable. Wait before trying again.');
    throw new Error('Ether could not complete Plex sign-in. Please try again.');
  }
  const tokens = await response.json() as Tokens;
  if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken ||
      typeof tokens.expiresAt !== 'string' || !Number.isFinite(Date.parse(tokens.expiresAt)) || !tokens.viewer || typeof tokens.viewer.id !== 'string' || !tokens.viewer.id ||
      typeof tokens.viewer.name !== 'string' || typeof tokens.viewer.policyRevision !== 'string') {
    throw new Error('Ether returned an invalid sign-in response.');
  }
  return tokens;
}
