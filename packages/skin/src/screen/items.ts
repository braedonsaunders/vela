// The items a screen document's repeat, shelf, grid, tabs or marquee draws (docs/plugin-screens.md:
// Node language changes): the list at `over`, from `skip`, without the `exclude`d record, newest
// last up to the picture's time with `asOf`, at most `limit`; each drawn in a context that binds it
// by its alias. A skin repeat (no `items`) reads the app's vocabulary as before.
import type { ScreenPageState } from '../../../core/src/screens/types';
import { collection, itemKey as vocabularyKey, type Ctx, type Env } from '../vocabulary';
import { timeOf, type Template, type Value } from './holes';
import { deref, refKey, walk, type Bound, type RecordReader, type RecordSource } from './scope';

/** A screen collection, compiled (resolve.ts). */
export interface Items {
  over: Value;
  /** The path as written (`src.hero.events`), for reports. */
  path: string;
  as: string;
  skip: number;
  limit: number;
  exclude?: Template;
  key?: Template;
  asOf?: { at: string[]; time: Template };
}

const fillT = (t: Template, c: Ctx, e: Env): string =>
  typeof t === 'string' ? t : t.parts.map(p => (typeof p === 'string' ? p : p(c, e))).join('');

/** The root context of a page or surface: its data, the record reader and its local state. */
export function screenRoot(page: ScreenPageState, record: RecordReader, state: Record<string, string> = {}, source?: RecordSource): Ctx {
  return { index: 0, screen: { page, record, state, items: {}, ...(source ? { source } : {}) } };
}

/** A context that binds `value` as `as` at `index`. */
export function bind(c: Ctx, as: string, value: unknown, index: number): Ctx {
  if (!c.screen) return { ...c, index };
  const bound: Bound = { value, index };
  return { ...c, index, screen: { ...c.screen, items: { ...c.screen.items, [as]: bound } } };
}

/** A tabs option's context: its item (none for the "all" option) and what its chip draws (`{$tab.*}`). */
export function tabCtx(c: Ctx, as: string, value: unknown, index: number, tab: { label: string; count: string; on: boolean }): Ctx {
  const withItem = bind(c, as, value, index);
  return bind(withItem, '$tab', { label: tab.label, count: tab.count, on: tab.on }, index);
}

/** The items drawn, each in its own context. */
export function screenItems(items: Items, c: Ctx, e: Env): Ctx[] {
  if (!c.screen) return [];
  const read = c.screen.record;
  const list = deref(items.over(c, e), read);
  if (!Array.isArray(list)) return [];
  let entries = list.slice(Math.max(0, items.skip));
  const excluded = items.exclude ? fillT(items.exclude, c, e) : '';
  if (excluded) entries = entries.filter(v => refKey(v) !== excluded);
  if (items.asOf) {
    const time = timeOf(fillT(items.asOf.time, c, e));
    const timed = entries.map(v => ({ v, t: timeOf(walk(v, items.asOf!.at, read)) }));
    // Items without times (an older plugin) are the live state: drawn unfiltered.
    if (Number.isFinite(time) && timed.some(x => Number.isFinite(x.t))) {
      entries = timed.filter(x => Number.isFinite(x.t) && x.t <= time).sort((a, b) => a.t - b.t).map(x => x.v);
    }
    // Newest last: a limit keeps the newest.
    entries = entries.slice(Math.max(0, entries.length - items.limit));
  } else {
    entries = entries.slice(0, items.limit);
  }
  return entries.map((v, i) => bind(c, items.as, v, i));
}

/** An item's identity: its `key` template, else its record key, else its position. */
export function screenItemKey(items: Items, c: Ctx, e: Env): string {
  if (items.key) {
    const key = fillT(items.key, c, e);
    if (key) return key;
  }
  const bound = c.screen?.items[items.as];
  return refKey(bound?.value) || String(c.index);
}

/** A repeat's items, screen or skin (render.tsx calls this for every repeat). */
export function items(node: { over: string; limit: number; items?: Items }, c: Ctx, e: Env): Ctx[] {
  return node.items ? screenItems(node.items, c, e) : collection(node.over, c, e, node.limit);
}

/** A repeat item's React key, screen or skin. */
export function itemKey(node: { over: string; items?: Items }, c: Ctx, e: Env): string {
  return node.items ? screenItemKey(node.items, c, e) : vocabularyKey(c, node.over);
}
