// Vela's own sources as records (docs/experiences.md: "Sources for Vela's own pages"): the pure
// half of the local answers. Core's models (cards, rows, the audio queue) become `{$record}` values
// and the records they point at; a document's source arguments are filled from the page's params
// and context; action arguments are read in their declared types. No store, no adapter here.
import type { Card, Row } from '../models';
import type { AudioQueue } from '../audio/queue';
import type * as P from '../../../protocol/vela-sources';
import type { RecordRef, SourceSpec } from '../../../protocol/screen';

/** Records to write: key -> value (core keeps the revs). */
export type LocalRecords = Record<string, unknown>;

/** A local answer for one source: its value and the records it references, or an error code. */
export type LocalAnswer = { value: unknown; records?: LocalRecords } | { error: string };

export const ref = (key: string): RecordRef => ({ $record: key });
/** The record key of a title id (an `item:` key is kept as it is). */
export const itemKey = (id: string): string => (id.startsWith('item:') ? id : `item:${id}`);
/** A title id from an id or an `item:` key. */
export const itemId = (value: string): string => (value.startsWith('item:') ? value.slice(5) : value);

/** A card as its `item:` record holds it: the card itself, without a list's own entry identity. */
export function cardValue(card: Card): Card {
  if (card.entryId === undefined) return card;
  const { entryId: _entry, ...rest } = card;
  return rest;
}

/**
 * The card an `item:` record holds, or undefined when the value is not one. Records Vela wrote are
 * cards already; this guards against a malformed value (a record from elsewhere) reaching an engine.
 */
export function cardOf(value: unknown): Card | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const card = value as Partial<Card>;
  if (typeof card.id !== 'string' || !card.id || typeof card.name !== 'string' || typeof card.kind !== 'string') return undefined;
  return value as Card;
}

/** Cards as a list value (`items` are references) and the records it needs. */
export function cardList(cards: readonly Card[], more: boolean, total?: number): { value: P.ListValue; records: LocalRecords } {
  const records: LocalRecords = {};
  const items: RecordRef[] = [];
  for (const card of cards) {
    const key = itemKey(card.id);
    records[key] = cardValue(card);
    items.push(ref(key));
  }
  return { value: { items, more, ...(typeof total === 'number' ? { total } : {}) }, records };
}

/** Rows as a rows value. */
export function rowsValue(rows: readonly Row[]): { value: P.RowsValue; records: LocalRecords } {
  const records: LocalRecords = {};
  const value: P.RowsValue = {
    rows: rows.map(row => {
      const list = cardList(row.items, !!row.nextCursor && row.continuation === 'more');
      Object.assign(records, list.records);
      return {
        id: row.id,
        ...(row.key ? { key: row.key } : {}),
        name: row.name,
        purpose: String(row.purpose ?? ''),
        layout: String(row.layout ?? 'standard'),
        presentation: row.presentation ?? '',
        ...(row.role ? { role: row.role } : {}),
        items: list.value.items,
        more: list.value.more,
        ...(row.surface ? { surface: row.surface } : {}),
        ...(row.plugin ? { plugin: row.plugin } : {}),
      };
    }),
  };
  return { value, records };
}

/** The `queue:current` record and the item records it reaches. */
export function queueRecord(queue: AudioQueue | null): { value: P.QueueRecord; records: LocalRecords } {
  const records: LocalRecords = {};
  const at = (index: number) => {
    const card = queue?.items[index];
    if (!card) return undefined;
    const key = itemKey(card.id);
    records[key] = cardValue(card);
    return ref(key);
  };
  if (!queue || !queue.order.length) {
    return { value: { items: [], at: -1, current: null, queued: [], next: [], autoplay: [], shuffle: !!queue?.shuffle, repeat: queue?.repeat ?? 'off', source: null }, records };
  }
  const items = queue.order.map(index => at(index)!).filter(Boolean);
  const after = queue.order.slice(queue.at + 1);
  const queuedSet = new Set(queue.queued ?? []);
  const autoplayFrom = queue.autoplay?.from ?? Number.POSITIVE_INFINITY;
  const queued: RecordRef[] = [], next: RecordRef[] = [], autoplay: RecordRef[] = [];
  after.forEach((index, offset) => {
    const item = at(index);
    if (!item) return;
    const position = queue.at + 1 + offset;
    if (queuedSet.has(index)) queued.push(item);
    else if (position >= autoplayFrom) autoplay.push(item);
    else next.push(item);
  });
  // Repeat all: the source plays again from its start after the last item.
  if (queue.repeat === 'all') for (const index of queue.order.slice(0, queue.at)) { const item = at(index); if (item) next.push(item); }
  const playing = queue.order[queue.at];
  return {
    value: {
      items, at: queue.at, current: playing === undefined ? null : at(playing) ?? null, queued, next, autoplay,
      shuffle: queue.shuffle, repeat: queue.repeat,
      source: queue.source ? { id: queue.source.id, name: queue.source.name, kind: queue.source.kind ?? 'title' } : null,
    },
    records,
  };
}

/** What `nowPlaying:current` is made from (the audio store's state). */
export interface NowPlayingInput {
  queue: AudioQueue | null;
  phase: P.NowPlayingRecord['phase'];
  positionSeconds: number;
  durationSeconds: number;
  rate: number;
  volume: number;
  muted: boolean;
  error: string;
  sleep: { mode: string; endsAt: number };
}

/** The `nowPlaying:current` record: whole seconds, so it changes about once a second while playing. */
export function nowPlayingRecord(audio: NowPlayingInput): { value: P.NowPlayingRecord; records: LocalRecords } {
  const records: LocalRecords = {};
  const index = audio.queue?.order[audio.queue.at];
  const card = index === undefined ? undefined : audio.queue?.items[index];
  if (card) records[itemKey(card.id)] = cardValue(card);
  const duration = Math.max(0, Math.round(audio.durationSeconds || 0));
  const position = Math.max(0, Math.floor(audio.positionSeconds || 0));
  return {
    value: {
      item: card ? ref(itemKey(card.id)) : null,
      phase: audio.phase,
      playing: audio.phase === 'playing' || audio.phase === 'buffering' || audio.phase === 'loading',
      position: duration > 0 ? Math.min(position, duration) : position,
      duration,
      progress: duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0,
      rate: audio.rate,
      volume: audio.volume,
      muted: audio.muted,
      error: audio.error,
      sleep: { mode: audio.sleep.mode, endsAt: audio.sleep.endsAt },
    },
    records,
  };
}

// Arguments

/** Where a source's holes are filled from: the page's params and a surface's context. */
export interface LocalScope { params: Record<string, string>; context?: Record<string, string> }

/**
 * A source's arguments as strings, its `{param.x}` and `{context.x}` holes filled (an unknown hole
 * reads ''). Values that are not text (a number written as JSON) are given as text.
 */
export function sourceArgs(spec: SourceSpec, scope: LocalScope): Record<string, string> {
  const { from: _from, lazy: _lazy, deps: _deps, ...args } = spec;
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(args)) {
    if (raw === undefined || raw === null) continue;
    const text = typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : '';
    out[name] = text.replace(/\{(param|context)\.([A-Za-z0-9_.-]+)\}/g, (_hole, kind: string, key: string) =>
      (kind === 'param' ? scope.params[key] : scope.context?.[key]) ?? '');
  }
  return out;
}

/** A bool argument: true/false (also 1/0, yes/no); undefined when absent or unreadable. */
export function boolArg(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes' || text === 'on') return true;
  if (text === 'false' || text === '0' || text === 'no' || text === 'off') return false;
  return undefined;
}

/** An int argument, or undefined. */
export function intArg(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

export function textArg(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** The missing required arguments of a source or action spec ('' values count as missing). */
export function missingArgs(spec: { args: Record<string, P.VelaArgSpec> }, args: Record<string, unknown>): string[] {
  return Object.entries(spec.args).filter(([name, arg]) => arg.required && textArg(args[name]) === '' && typeof args[name] !== 'boolean').map(([name]) => name);
}

/** `index=titleId,…` pairs (the import's ambiguous choices). */
export function pairsArg(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of textArg(value).split(',')) {
    const [key, ...rest] = pair.split('=');
    const k = key?.trim(), v = rest.join('=').trim();
    if (k && v) out[k] = itemId(v);
  }
  return out;
}

/** Comma-separated whole numbers (the import's excluded indices). */
export function intsArg(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(intArg).filter((n): n is number => n !== undefined);
  return textArg(value).split(',').map(intArg).filter((n): n is number => n !== undefined);
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * A lyrics line as documents read it: its time and text, and the server's word timing, translation
 * and romanisation when it sent them (anything malformed is left out, never guessed).
 */
export function lyricsLine(line: unknown): P.LyricsLine | undefined {
  if (!line || typeof line !== 'object') return undefined;
  const raw = line as Record<string, unknown>;
  if (typeof raw.text !== 'string') return undefined;
  const out: P.LyricsLine = { startMs: finite(raw.startMs) ? raw.startMs : -1, text: raw.text };
  if (finite(raw.endMs)) out.endMs = raw.endMs;
  if (Array.isArray(raw.words)) {
    const words = raw.words.flatMap(word => {
      const w = word as Record<string, unknown> | null;
      if (!w || typeof w.text !== 'string' || !finite(w.startMs)) return [];
      return [{ startMs: w.startMs, ...(finite(w.endMs) ? { endMs: w.endMs } : {}), text: w.text }];
    });
    if (words.length) out.words = words;
  }
  if (typeof raw.translation === 'string' && raw.translation) out.translation = raw.translation;
  const romanised = typeof raw.romanised === 'string' ? raw.romanised : typeof raw.romanized === 'string' ? raw.romanized : '';
  if (romanised) out.romanised = romanised;
  return out;
}
