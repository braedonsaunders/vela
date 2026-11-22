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
  /** The provider cap behind it, so the words can name the channel when its name arrives later. */
  cap?: ConnectionCap;
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

/** The cap's headline: the channel's provider when the channel's name is known, else the provider's. */
export function capTitle(cap: ConnectionCap, channel: string): string {
  if (channel && cap.max > 0) return msg(cap.max === 1 ? 'multiview.capOne' : 'multiview.capMany', { channel, max: cap.max });
  if (channel) return msg('multiview.capUnknown', { channel });
  if (cap.provider && cap.max > 0) return msg(cap.max === 1 ? 'multiview.capProviderOne' : 'multiview.capProviderMany', { provider: cap.provider, max: cap.max });
  return msg('multiview.capAnonymous');
}

/** A refusal's headline with the channel's name as it is known now (the lineup may arrive after it). */
export function refusalTitle(refusal: TileRefusal, channel: string): string {
  return refusal.cap ? capTitle(refusal.cap, channel) : refusal.title;
}

/** The tile's words for a refusal; `channel` is the channel's name. */
export function tileRefusal(error: unknown, channel: string): TileRefusal {
  const cap = connectionCap(error);
  if (cap) {
    const title = capTitle(cap, channel);
    const detail = cap.provider && cap.max > 0
      ? msg('multiview.capDetailProvider', { provider: cap.provider, inUse: cap.inUse, max: cap.max })
      : msg('multiview.capDetail');
    return { title, detail, retry: false, code: 'provider_connection_cap', cap };
  }
  const refusal = startRefusal(error, msg('multiview.unavailable'));
  const retry = error instanceof VelaError && error.detail.retry?.allowed === true;
  return { title: refusal.message || msg('multiview.unavailable'), detail: msg(retry ? 'multiview.retryDetail' : 'multiview.swapDetail'), retry, code: refusal.code };
}
