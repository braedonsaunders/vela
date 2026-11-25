// The viewer's streaming quality cap: one choice for an unmetered network (Wi-Fi, Ethernet) and one
// for a metered one (mobile data, a personal hotspot, Low Data Mode). The cap is declared to every
// server as the client's maxBitrate, maxWidth and maxHeight, so each honours it where it can: Plex
// keeps an original above it out of the plan, Jellyfin caps its streaming bitrate.
import type { ClientCapabilities } from './wire';

export type StreamingQuality = 'original' | '1080p' | '720p' | '480p';
export const STREAMING_QUALITIES: readonly StreamingQuality[] = ['original', '1080p', '720p', '480p'];

export interface StreamingLimit { maxWidth: number; maxHeight: number; /** Bits per second, video and audio. */ maxBitrate: number }

/** Each capped choice's box and total rate. */
export const STREAMING_LIMITS: Record<Exclude<StreamingQuality, 'original'>, StreamingLimit> = {
  '1080p': { maxWidth: 1920, maxHeight: 1080, maxBitrate: 10_000_000 },
  '720p': { maxWidth: 1280, maxHeight: 720, maxBitrate: 4_000_000 },
  '480p': { maxWidth: 854, maxHeight: 480, maxBitrate: 1_500_000 },
};

export interface StreamingSettings {
  /** On Wi-Fi or Ethernet. */
  wifi: StreamingQuality;
  /** On mobile data (any metered network). */
  mobile: StreamingQuality;
}

/** Wi-Fi keeps the original; mobile data streams at most 720p at 4 Mb/s. */
export const DEFAULT_STREAMING: StreamingSettings = { wifi: 'original', mobile: '720p' };

const quality = (value: unknown, fallback: StreamingQuality): StreamingQuality =>
  STREAMING_QUALITIES.includes(value as StreamingQuality) ? value as StreamingQuality : fallback;

/** Stored settings, read defensively: anything unknown is the default. */
export function streamingSettings(value: unknown): StreamingSettings {
  const stored = value && typeof value === 'object' ? value as Partial<Record<keyof StreamingSettings, unknown>> : {};
  return { wifi: quality(stored.wifi, DEFAULT_STREAMING.wifi), mobile: quality(stored.mobile, DEFAULT_STREAMING.mobile) };
}

/** The cap in force on this network, or null for the original. */
export function streamingLimit(settings: StreamingSettings, metered: boolean): StreamingLimit | null {
  const choice = metered ? settings.mobile : settings.wifi;
  return choice === 'original' ? null : STREAMING_LIMITS[choice];
}

const lower = (declared: number | undefined, cap: number) => declared && declared > 0 ? Math.min(declared, cap) : cap;

/** The client's declaration with the cap applied: never above what the device itself declared. */
export function cappedClient(client: ClientCapabilities, limit: StreamingLimit | null): ClientCapabilities {
  if (!limit) return client;
  return { ...client, maxWidth: lower(client.maxWidth, limit.maxWidth), maxHeight: lower(client.maxHeight, limit.maxHeight),
    maxBitrate: lower(client.maxBitrate, limit.maxBitrate) };
}

/**
 * Whether a file fits the client's streaming cap. A declared maxBitrate is the viewer's cap (no
 * player declares one), and the box declared with it is part of the cap; a device's decoder size
 * alone does not refuse an original here. `bitrate` is in bits per second; unknown fits.
 */
export function withinStreamingCap(file: { bitrate?: number; width?: number; height?: number }, client: Pick<ClientCapabilities, 'maxBitrate' | 'maxWidth' | 'maxHeight'>): boolean {
  if (!client.maxBitrate) return true;
  if (file.bitrate && file.bitrate > client.maxBitrate) return false;
  if (client.maxHeight && file.height && file.height > client.maxHeight) return false;
  if (client.maxWidth && file.width && file.width > client.maxWidth) return false;
  return true;
}
