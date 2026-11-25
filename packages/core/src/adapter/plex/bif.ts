// Plex scrub thumbnails: a part's media index (`/library/parts/{id}/indexes/sd`) is a BIF file, Roku's
// trickplay format. Pure functions over its bytes; the adapter reads the header, then the table, then
// one frame at a time by byte range.
//
// Layout (integers little-endian): an 8-byte magic, a version at 8, the image count at 12, a timestamp
// multiplier at 16 (milliseconds per unit; 0 means 1000), reserved to 64; then count + 1 entries of
// (timestamp u32, byte offset u32), the last a sentinel whose offset ends the final image; then the
// JPEG images back to back. Entries carry their own times, so an index may be sparse (Ether's grows
// while a session streams).
import type * as V from '../../wire';

export const BIF_HEADER_BYTES = 64;
const ENTRY_BYTES = 8;
const MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
/** More entries than this is not a thumbnail index (a frame a second for over a day). */
const MAX_FRAMES = 100_000;
/** The spacing assumed when an index has a single frame. */
const DEFAULT_INTERVAL_MS = 10_000;

export interface BifHeader {
  count: number;
  /** Milliseconds per timestamp unit. */
  multiplierMs: number;
}

/** One indexed image: the title time it shows and its bytes' range in the file (end exclusive). */
export interface BifFrame {
  atMs: number;
  start: number;
  end: number;
}

const u32 = (bytes: Uint8Array, at: number) => (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

/** The header of a BIF file (its first 64 bytes, or more), or null when the bytes are not one. */
export function bifHeader(bytes: Uint8Array): BifHeader | null {
  if (bytes.length < BIF_HEADER_BYTES || MAGIC.some((byte, i) => bytes[i] !== byte)) return null;
  const count = u32(bytes, 12);
  if (count < 1 || count > MAX_FRAMES) return null;
  const multiplier = u32(bytes, 16);
  return { count, multiplierMs: multiplier || 1000 };
}

/** The byte range of the index table that follows the header (end exclusive). */
export function bifTableRange(header: BifHeader): { start: number; end: number } {
  return { start: BIF_HEADER_BYTES, end: BIF_HEADER_BYTES + (header.count + 1) * ENTRY_BYTES };
}

/**
 * The frames an index table lists, in time order: `table` is the table's bytes (see bifTableRange).
 * An entry whose image is empty or runs backwards is left out; null when the table is cut short.
 */
export function bifFrames(header: BifHeader, table: Uint8Array): BifFrame[] | null {
  const { start, end } = bifTableRange(header);
  if (table.length < end - start) return null;
  const frames: BifFrame[] = [];
  const imagesStart = end;
  for (let i = 0; i < header.count; i++) {
    const at = u32(table, i * ENTRY_BYTES);
    const from = u32(table, i * ENTRY_BYTES + 4);
    const to = u32(table, (i + 1) * ENTRY_BYTES + 4);
    if (at === 0xffffffff || from < imagesStart || to <= from) continue;
    frames.push({ atMs: at * header.multiplierMs, start: from, end: to });
  }
  frames.sort((a, b) => a.atMs - b.atMs);
  // Two images at one time: the first stands.
  return frames.filter((frame, i) => i === 0 || frame.atMs !== frames[i - 1]!.atMs);
}

/** The usual spacing between frames: the commonest gap, or 10 seconds for a single frame. */
export function bifInterval(frames: readonly BifFrame[]): number {
  const gaps = new Map<number, number>();
  for (let i = 1; i < frames.length; i++) {
    const gap = Math.round(frames[i]!.atMs - frames[i - 1]!.atMs);
    if (gap > 0) gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
  }
  let best = 0, seen = 0;
  for (const [gap, n] of gaps) if (n > seen || (n === seen && gap < best)) { best = gap; seen = n; }
  return best > 0 ? best : DEFAULT_INTERVAL_MS;
}

/**
 * The frame for slot `slot` of an offer spaced `intervalMs` apart: the latest frame at or before the
 * slot's end, unless it is more than a slot older than the slot's start (a gap in a sparse index).
 */
export function bifFrameAt(frames: readonly BifFrame[], intervalMs: number, slot: number): BifFrame | null {
  if (!Number.isInteger(slot) || slot < 0 || !(intervalMs > 0)) return null;
  const from = slot * intervalMs, until = from + intervalMs;
  let lo = 0, hi = frames.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.atMs < until) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0) return null;
  const frame = frames[found]!;
  return from - frame.atMs > intervalMs ? null : frame;
}

/** How far from title time zero the index has a frame for every slot, in milliseconds. */
export function bifCoverage(frames: readonly BifFrame[], intervalMs: number): number {
  if (!frames.length || frames[0]!.atMs >= intervalMs) return 0;
  let last = frames[0]!.atMs;
  for (let i = 1; i < frames.length && frames[i]!.atMs - last <= intervalMs; i++) last = frames[i]!.atMs;
  return last + intervalMs;
}

/**
 * A scrub thumbnail offer for an index: one image per sheet (`cols` and `rows` 1), so a sheet index
 * is a slot. `durationMs` is the title's, when known; else the index's own extent.
 */
export function bifOffer(frames: readonly BifFrame[], size: { width: number; height: number }, durationMs: number | undefined, revision: number): V.TrickplayMetadata | null {
  if (!frames.length || !(size.width > 0) || !(size.height > 0)) return null;
  const intervalMs = bifInterval(frames);
  const extent = durationMs && durationMs > 0 ? durationMs : frames[frames.length - 1]!.atMs + intervalMs;
  const count = Math.ceil(extent / intervalMs);
  return { width: Math.round(size.width), height: Math.round(size.height), intervalMs, count, cols: 1, rows: 1,
    coverageUntilMs: Math.min(bifCoverage(frames, intervalMs), count * intervalMs), revision };
}

/** A JPEG image's pixel size from its frame header, or null. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    // Markers without a length: the restart markers, TEM.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    // Start of frame (any coding but DHT, JPG and DAC, which share the range).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= bytes.length) return null;
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}
