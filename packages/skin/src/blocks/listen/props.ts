// Reading a rich block's props (packages/protocol/rich-blocks.ts) and the small pure rules the
// Listen blocks share: lists from sources, cards from item: records, disc groups, playlist moves
// and how many rows draw at once.
import type { Card } from '@vela/core';
import { RICH_BLOCKS, type RichBlockName } from '../../../../protocol/rich-blocks';
import { deref, type RecordReader } from '../../screen/scope';

/** A boolean prop: a real boolean, or its text ("true", "false", "" for absent). */
export function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  const text = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw);
  if (text === 'true') return true;
  if (text === 'false') return false;
  return fallback;
}

/** A number prop within bounds. */
export function parseNumber(raw: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** An enum prop: one of its values, else the fallback. */
export function parseEnum<T extends string>(raw: unknown, values: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw.trim()) ? raw.trim() as T : fallback;
}

/** A prop's default as the registry gives it (text), or ''. */
export function propDefault(block: RichBlockName, prop: string): string {
  const spec = (RICH_BLOCKS[block].props as Record<string, { default?: string }>)[prop];
  return spec?.default ?? '';
}

/** A list prop: a list source's `items` (vela.* lists answer `{items, more, total?}`), or a list. */
export function listOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) return (raw as { items: unknown[] }).items;
  return [];
}

/** A card from an item: record's value (core's Card; anything without an id and a name is not one). */
export function asCard(value: unknown): Card | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Partial<Card>;
  return typeof v.id === 'string' && v.id && typeof v.name === 'string' && typeof v.kind === 'string' ? value as Card : undefined;
}

/** A list of strings (playlist entry ids), parallel to the tracks. */
export function stringsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(v => (typeof v === 'string' ? v : v == null ? '' : String(v))) : [];
}

export interface DiscGroup {
  /** The disc number; 0 when the tracks are not split by disc. */
  disc: number;
  /** Positions in the track list, in order. */
  indices: number[];
}

/** Tracks grouped by disc, in the list's order, when they span two discs or more; else one group. */
export function discGroups(tracks: readonly Pick<Card, 'media'>[]): DiscGroup[] {
  const all = tracks.map((_, i) => i);
  const discs = new Set(tracks.map(t => t.media?.disc ?? 0).filter(d => d > 0));
  if (discs.size < 2) return [{ disc: 0, indices: all }];
  const groups: DiscGroup[] = [];
  for (const i of all) {
    const disc = tracks[i]!.media?.disc ?? 0;
    const last = groups[groups.length - 1];
    if (last && last.disc === disc) last.indices.push(i);
    else groups.push({ disc, indices: [i] });
  }
  return groups;
}

/** A playlist move as the store takes it (playlists.moveEntry): the entry moved from position
 * `from` so that it ends at position `to`, after `afterEntryId` (null: first). Nothing when it
 * would not move. */
export function playlistMove(entryIds: readonly string[], from: number, to: number): { entryId: string; afterEntryId: string | null } | undefined {
  if (from === to || from < 0 || from >= entryIds.length || to < 0 || to >= entryIds.length) return undefined;
  const entryId = entryIds[from];
  if (!entryId) return undefined;
  const rest = entryIds.filter((_, i) => i !== from);
  return { entryId, afterEntryId: to === 0 ? null : rest[to - 1] ?? null };
}

/** Rows drawn with the first frame, and how many more each following frame adds. */
export const FIRST_ROWS = 60;
export const MORE_ROWS = 120;

/** How many rows to draw next frame (all of them once the list is short enough). */
export function nextRowCount(drawn: number, total: number): number {
  return Math.min(total, Math.max(drawn, FIRST_ROWS) + (drawn >= FIRST_ROWS ? MORE_ROWS : 0));
}

/** The tracks a trackTable's props name, with their playlist entry ids when given (kept parallel). */
export function tableTracks(rawTracks: unknown, rawEntryIds: unknown, read: RecordReader): { tracks: Card[]; entryIds: string[] } {
  const list = listOf(rawTracks);
  const ids = stringsOf(rawEntryIds);
  const tracks: Card[] = [], entryIds: string[] = [];
  list.forEach((entry, i) => {
    const card = asCard(deref(entry, read));
    if (!card) return;
    tracks.push(card);
    entryIds.push(ids[i] ?? '');
  });
  return { tracks, entryIds };
}

/** What the bar's queue and Sound buttons press: one side panel at a time. */
export function barPresses(which: 'queue' | 'sound', queueFlag: string, soundFlag: string, state: Record<string, string>): { action: 'toggle' | 'close'; flag: string }[] {
  const open = (flag: string) => state[flag] === 'true';
  const [own, other] = which === 'queue' ? [queueFlag, soundFlag] : [soundFlag, queueFlag];
  return [...(open(other) ? [{ action: 'close' as const, flag: other }] : []), { action: 'toggle' as const, flag: own }];
}
