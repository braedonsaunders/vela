// The binding scope of a screen or surface document (docs/plugin-screens.md: Bindings): the
// page's data as core holds it (ScreenPageState), the shared record pool read through a reader,
// local state, and the items the enclosing repeats and blocks are drawing, by their `as` name.
// Paths walk this data; a `{ "$record": key }` met along the way is followed through the reader,
// so the component drawing a hole subscribes to exactly the records it reads (the reader is
// core's useRecordReader()). A missing path reads undefined, which a hole draws as ''.
import type { RecordEntry } from '../../../protocol/screen';
import type { ScreenPageState } from '../../../core/src/screens/types';

/** Reads one record of the shared pool (core's tracked reader: reading subscribes). */
export type RecordReader = (key: string) => RecordEntry | undefined;

/** An item a repeat, shelf, grid, tabs or marquee draws: its value as written in the source (it
 * may be a record reference, followed when read) and its position. */
export interface Bound { value: unknown; index: number }

export interface ScreenScope {
  page: ScreenPageState;
  record: RecordReader;
  /** Local state: flags (`toggle`, `only`, `open`, `close`: 'true' while set) and tabs bound to state. */
  state: Record<string, string>;
  /** The enclosing items by alias (`as`). */
  items: Record<string, Bound>;
}

/** The constant lists skeletons repeat over (`env.range5`, `env.range6`). */
export const RANGES: Record<string, number[]> = { range5: [0, 1, 2, 3, 4], range6: [0, 1, 2, 3, 4, 5] };

export function isRecordRef(value: unknown): value is { $record: string } {
  return typeof value === 'object' && value !== null && typeof (value as { $record?: unknown }).$record === 'string';
}

/** A value with its record reference followed (once: a record's value is never itself a reference). */
export function deref(value: unknown, read: RecordReader): unknown {
  return isRecordRef(value) ? read(value.$record)?.value : value;
}

/** The record key of a value written as a reference, else ''. */
export function refKey(value: unknown): string {
  return isRecordRef(value) ? value.$record : '';
}

/**
 * Walk dot segments from a value: numeric indices, `length` of a list, `$key` (the record key of
 * the reference at that point), following references through `read` before each step.
 */
export function walk(start: unknown, segments: readonly string[], read: RecordReader): unknown {
  let value = start;
  for (const segment of segments) {
    if (segment === '$key') return refKey(value);
    value = deref(value, read);
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) {
      if (segment === 'length') { value = value.length; continue; }
      if (!/^\d+$/.test(segment)) return undefined;
      value = value[Number(segment)];
      continue;
    }
    if (typeof value !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** A value as a hole draws it: text and numbers as written, booleans as 'true'/'false', a list by
 * its length ('' when empty), an object as 'true' (a reference followed first), nothing as ''. */
export function text(value: unknown, read?: RecordReader): string {
  if (read) value = deref(value, read);
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.length ? String(value.length) : '';
  if (typeof value === 'object') return Object.keys(value).length ? 'true' : '';
  return '';
}

/** A screen document's image: only Vela's own same-origin URLs (Ether's proxied `$image`s and a
 * plugin's assets); anything else is refused, and the image's fallback draws instead. */
export function screenImageSrc(src: string): string {
  return /^\/vela\/v0\/[^\s\\]*$/.test(src) && !src.includes('..') ? src : '';
}
