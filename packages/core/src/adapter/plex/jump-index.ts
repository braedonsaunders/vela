// Plex's `/library/sections/{id}/firstCharacter` parser: turns `Directory` entries into
// cumulative start offsets in the server's own title-sort order. Never re-sorts or invents
// letters; if any entry's size is malformed, returns empty so ordinary paging stands undisturbed.
import type { LibraryJumpBucket } from '../../models';

export interface PlexFirstCharacterEntry {
  key?: unknown;
  title?: unknown;
  size?: unknown;
}

function parseSize(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const value = Number(trimmed);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  return undefined;
}

function parseText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Parses Plex `firstCharacter` `Directory` entries into non-empty buckets with cumulative offsets. */
export function parsePlexJumpIndex(entries: unknown): LibraryJumpBucket[] {
  if (!Array.isArray(entries)) return [];
  const buckets: LibraryJumpBucket[] = [];
  let offset = 0;
  for (const item of entries) {
    if (!item || typeof item !== 'object') return [];
    const entry = item as PlexFirstCharacterEntry;
    const count = parseSize(entry.size);
    if (count === undefined) return [];
    if (count === 0) continue;
    const title = parseText(entry.title);
    const key = parseText(entry.key) || title;
    const label = title || key;
    if (!key || !label) return [];
    buckets.push({ key, label, count, startOffset: offset });
    offset += count;
  }
  return buckets;
}
