// Scrub thumbnails (trickplay): where a moment's frame sits in a session's sprite sheets, and
// the sheets as images a renderer can draw without credentials. See the protocol reference,
// "Scrub thumbnails (trickplay)": a sheet is `cols` by `rows` thumbnails of `width` by `height`.
import type { TrickplayMetadata } from '../wire';

/** One moment's thumbnail: which sheet, and which cell of it. */
export interface TrickplayCell {
  sheet: number;
  column: number;
  row: number;
}

/** A thumbnail ready to draw: the whole sheet as an image, and the cell to show of it. */
export interface TrickplayFrame extends TrickplayCell {
  /** The sheet as a `data:` URI: no server address or credential reaches the renderer. */
  uri: string;
  /** The sheet's grid. */
  columns: number;
  rows: number;
  /** One thumbnail's pixel size (its shape: the sheet is `width * columns` across). */
  width: number;
  height: number;
}

/**
 * The cell showing title time `seconds`, or null where the offer has no real frame: before zero,
 * past its last slot, or beyond the contiguous coverage the server has generated so far.
 */
export function trickplayCell(offer: TrickplayMetadata, seconds: number): TrickplayCell | null {
  const { intervalMs, count, cols, rows, coverageUntilMs } = offer;
  if (!Number.isFinite(seconds) || seconds < 0 || !(intervalMs > 0) || !(cols > 0) || !(rows > 0)) return null;
  const slot = Math.floor((seconds * 1000) / intervalMs);
  if (slot >= count || slot * intervalMs >= coverageUntilMs) return null;
  const perSheet = cols * rows;
  return { sheet: Math.floor(slot / perSheet), column: slot % cols, row: Math.floor(slot / cols) % rows };
}

/** Whether two offers describe the same published sheets (the same bytes behind each index). */
export function sameTrickplay(a: TrickplayMetadata | undefined, b: TrickplayMetadata | undefined): boolean {
  return !!a && !!b && a.revision === b.revision && a.width === b.width && a.height === b.height &&
    a.intervalMs === b.intervalMs && a.cols === b.cols && a.rows === b.rows && a.count === b.count;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 of `bytes` (no line breaks), the same on every JavaScript engine. */
export function base64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  if (i < bytes.length) {
    const rest = bytes.length - i;
    const n = (bytes[i]! << 16) | (rest > 1 ? bytes[i + 1]! << 8 : 0);
    out += ALPHABET[n >> 18]! + ALPHABET[(n >> 12) & 63]! + (rest > 1 ? ALPHABET[(n >> 6) & 63]! : '=') + '=';
  }
  return out;
}

/** A sheet as an image URI. Only JPEG and PNG are drawn, by their bytes when the type is not given. */
export function sheetURI(bytes: Uint8Array, mimeType: string): string | null {
  const declared = mimeType.split(';')[0]!.trim().toLowerCase();
  const sniffed = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : '';
  const type = declared === 'image/jpeg' || declared === 'image/png' ? declared : !declared || declared === 'application/octet-stream' ? sniffed : '';
  if (!type || !bytes.length) return null;
  return `data:${type};base64,${base64(bytes)}`;
}

/** Jellyfin's per-width tile description (`TrickplayInfo`). */
interface JellyfinTrickplayInfo { Width?: number; Height?: number; TileWidth?: number; TileHeight?: number; ThumbnailCount?: number; Interval?: number }

const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * A Jellyfin item's `Trickplay` manifest as a Vela offer for one media source. Jellyfin keys it by
 * media source, then thumbnail width; some compatible servers nest the width first, so both are
 * read; a manifest naming a single source is that source's. The width nearest 320 is chosen
 * (sheets are drawn small). Jellyfin publishes complete sheets, so coverage is the whole run of
 * thumbnails. Null when the source has none.
 */
export function jellyfinTrickplay(manifest: unknown, sourceId: string | undefined): (TrickplayMetadata & { sourceId: string }) | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const found: { sourceId: string; info: JellyfinTrickplayInfo }[] = [];
  for (const [outer, inner] of Object.entries(manifest as Record<string, unknown>)) {
    if (!inner || typeof inner !== 'object') continue;
    for (const [key, info] of Object.entries(inner as Record<string, unknown>)) {
      if (!info || typeof info !== 'object' || !positiveInteger((info as JellyfinTrickplayInfo).Width)) continue;
      // Widths are numbers; whichever level is not one names the source.
      const source = /^\d+$/.test(outer) && !/^\d+$/.test(key) ? key : outer;
      found.push({ sourceId: source, info: info as JellyfinTrickplayInfo });
    }
  }
  const sources = new Set(found.map(entry => entry.sourceId));
  const mine = found.filter(entry => entry.sourceId === sourceId || sources.size === 1);
  const usable = mine.filter(({ info }) => positiveInteger(info.Width) && positiveInteger(info.Height) && positiveInteger(info.TileWidth) &&
    positiveInteger(info.TileHeight) && positiveInteger(info.ThumbnailCount) && positiveInteger(info.Interval));
  if (!usable.length) return null;
  const best = usable.reduce((a, b) => (Math.abs(b.info.Width! - 320) < Math.abs(a.info.Width! - 320) ? b : a));
  const { Width, Height, TileWidth, TileHeight, ThumbnailCount, Interval } = best.info as Required<JellyfinTrickplayInfo>;
  return {
    sourceId: best.sourceId, width: Width, height: Height, intervalMs: Interval, count: ThumbnailCount,
    cols: TileWidth, rows: TileHeight, coverageUntilMs: ThumbnailCount * Interval, revision: 0,
  };
}
