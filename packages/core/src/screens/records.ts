// The shared record pool: every page and surface reads the same `event:`, `entity:`, `item:`,
// `channel:` and `p:` records. A newer revision wins; an unchanged record keeps its identity.
// Records live outside the store's state with listeners per key, so a pushed goal notifies only
// the readers of that game, not every selector in the app.
import type { RecordEntry, RecordRef } from '../wire';
import type { RecordPool } from './types';

export const isRecordRef = (value: unknown): value is RecordRef =>
  !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as RecordRef).$record === 'string';

const validEntry = (entry: unknown): entry is RecordEntry =>
  !!entry && typeof entry === 'object' && typeof (entry as RecordEntry).rev === 'number' && Number.isFinite((entry as RecordEntry).rev) && 'value' in (entry as object);

/** Fold `incoming` into `pool`: a key is taken when it is new or its rev is higher; the same rev, a
 * lower one, or an equal value under a higher rev change nothing. Returns `pool` itself and no
 * keys when nothing changed. */
export function mergeRecords(pool: RecordPool, incoming: unknown): { pool: RecordPool; changed: string[] } {
  if (!incoming || typeof incoming !== 'object') return { pool, changed: [] };
  let next: RecordPool | undefined;
  const changed: string[] = [];
  for (const [key, entry] of Object.entries(incoming as Record<string, unknown>)) {
    if (!key || !validEntry(entry)) continue;
    const known = (next ?? pool)[key];
    if (known && entry.rev <= known.rev) continue;
    if (known && sameJSON(known.value, entry.value)) continue;
    next ??= { ...pool };
    next[key] = { rev: entry.rev, value: entry.value };
    changed.push(key);
  }
  return { pool: next ?? pool, changed };
}

function sameJSON(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** Every record key `value` refers to, following references into the pool (a row's `entity` ref
 * inside an event record), each key once. */
export function recordRefs(value: unknown, read: (key: string) => RecordEntry | undefined, into = new Set<string>()): Set<string> {
  const stack: unknown[] = [value];
  let budget = 100_000;
  while (stack.length && budget-- > 0) {
    const item = stack.pop();
    if (!item || typeof item !== 'object') continue;
    if (isRecordRef(item)) {
      if (into.has(item.$record)) continue;
      into.add(item.$record);
      const entry = read(item.$record);
      if (entry) stack.push(entry.value);
      continue;
    }
    if (Array.isArray(item)) { for (const child of item) stack.push(child); continue; }
    for (const child of Object.values(item)) stack.push(child);
  }
  return into;
}

/** `value` with `path` (dot segments, numeric indices) set to `next`, copying only along the path. */
export function setPath(value: unknown, path: string, next: unknown): unknown {
  const segments = path.split('.').filter(Boolean);
  const put = (current: unknown, at: number): unknown => {
    if (at === segments.length) return next;
    const segment = segments[at]!;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const copy = [...current];
      copy[Number(segment)] = put(current[Number(segment)], at + 1);
      return copy;
    }
    const base = current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {};
    return { ...base, [segment]: put(base[segment], at + 1) };
  };
  return put(value, 0);
}

type Listener = () => void;

export class RecordStore {
  private records: RecordPool = {};
  private readonly listeners = new Map<string, Set<Listener>>();

  get = (key: string): RecordEntry | undefined => this.records[key];

  /** The whole pool as an immutable snapshot (a new object whenever anything changed). */
  pool(): RecordPool { return this.records; }

  /** Merge pushed or read records; listeners of the changed keys hear it. Returns the changed keys. */
  merge(incoming: unknown): string[] {
    const { pool, changed } = mergeRecords(this.records, incoming);
    if (!changed.length) return changed;
    this.records = pool;
    this.notify(changed);
    return changed;
  }

  /** Set one record as given, whatever its rev (an optimistic patch, or undoing one). */
  put(key: string, entry: RecordEntry | undefined): void {
    if (this.records[key] === entry) return;
    const next = { ...this.records };
    if (entry) next[key] = entry; else delete next[key];
    this.records = next;
    this.notify([key]);
  }

  subscribe(key: string, listener: Listener): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, set = new Set());
    set.add(listener);
    return () => {
      const known = this.listeners.get(key);
      if (!known?.delete(listener)) return;
      if (!known.size) this.listeners.delete(key);
    };
  }

  /** One listener for several keys; it hears each change once. */
  subscribeKeys(keys: Iterable<string>, listener: Listener): () => void {
    const stops = [...new Set(keys)].map(key => this.subscribe(key, listener));
    return () => { for (const stop of stops) stop(); };
  }

  /** Keys some view reads now (they are never released). */
  watched(): Set<string> { return new Set(this.listeners.keys()); }

  /** Forget every record not in `keep` and not watched by a view. */
  release(keep: ReadonlySet<string>): string[] {
    const gone = Object.keys(this.records).filter(key => !keep.has(key) && !this.listeners.has(key));
    if (!gone.length) return gone;
    const next = { ...this.records };
    for (const key of gone) delete next[key];
    this.records = next;
    return gone;
  }

  clear(): void {
    const keys = Object.keys(this.records);
    this.records = {};
    this.notify(keys);
  }

  private notify(keys: readonly string[]): void {
    const heard = new Set<Listener>();
    for (const key of keys) for (const listener of this.listeners.get(key) ?? []) heard.add(listener);
    for (const listener of heard) listener();
  }
}

/** Every https href Ether rewrote from a `$link` envelope ({href, host}) reachable from `value`,
 * following record references: the only hrefs `openLink` may open. */
export function linkHrefs(value: unknown, read: (key: string) => RecordEntry | undefined): Set<string> {
  const hrefs = new Set<string>();
  const seen = new Set<string>();
  const stack: unknown[] = [value];
  let budget = 100_000;
  while (stack.length && budget-- > 0) {
    const item = stack.pop();
    if (!item || typeof item !== 'object') continue;
    if (isRecordRef(item)) {
      if (seen.has(item.$record)) continue;
      seen.add(item.$record);
      const entry = read(item.$record);
      if (entry) stack.push(entry.value);
      continue;
    }
    if (Array.isArray(item)) { for (const child of item) stack.push(child); continue; }
    const link = item as { href?: unknown; host?: unknown };
    if (typeof link.href === 'string' && typeof link.host === 'string' && Object.keys(item).length === 2) {
      try {
        const url = new URL(link.href);
        if (url.protocol === 'https:' && !url.username && !url.password && url.host === link.host) hrefs.add(link.href);
      } catch { /* not a URL: never a link */ }
      continue;
    }
    for (const child of Object.values(item)) stack.push(child);
  }
  return hrefs;
}
