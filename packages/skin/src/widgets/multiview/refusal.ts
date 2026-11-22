// Why a tile could not play, in words for the tile that failed. The provider connection cap is typed
// (HTTP 409, class capacity, code provider_connection_cap, details {provider, max, inUse}); the other
// tiles keep playing.
import { msg, startRefusal, VelaError } from '@vela/core';

export interface TileRefusal {
  /** The headline on the tile. */
  title: string;
  /** A second line: what the viewer can do. */
  detail: string;
  /** The server allows asking again (a transient refusal); a cap does not lift by itself. */
  retry: boolean;
  code: string;
}

export interface ConnectionCap { provider: string; max: number; inUse: number }

/** The provider-cap details of a refusal, when it is one. */
export function connectionCap(error: unknown): ConnectionCap | null {
  if (!(error instanceof VelaError) || error.detail.code !== 'provider_connection_cap') return null;
  const details = (error.detail as { details?: Partial<ConnectionCap> }).details ?? {};
  const max = Number(details.max);
  return {
    provider: typeof details.provider === 'string' ? details.provider : '',
    max: Number.isFinite(max) && max > 0 ? max : 0,
    inUse: Number.isFinite(Number(details.inUse)) ? Number(details.inUse) : 0,
  };
}

/** The tile's words for a refusal; `channel` is the channel's name. */
export function tileRefusal(error: unknown, channel: string): TileRefusal {
  const cap = connectionCap(error);
  if (cap) {
    const title = cap.max > 0
      ? msg(cap.max === 1 ? 'multiview.capOne' : 'multiview.capMany', { channel, max: cap.max })
      : msg('multiview.capUnknown', { channel });
    const detail = cap.provider && cap.max > 0
      ? msg('multiview.capDetailProvider', { provider: cap.provider, inUse: cap.inUse, max: cap.max })
      : msg('multiview.capDetail');
    return { title, detail, retry: false, code: 'provider_connection_cap' };
  }
  const refusal = startRefusal(error, msg('multiview.unavailable'));
  const retry = error instanceof VelaError && error.detail.retry?.allowed === true;
  return { title: refusal.message || msg('multiview.unavailable'), detail: msg(retry ? 'multiview.retryDetail' : 'multiview.swapDetail'), retry, code: refusal.code };
}
