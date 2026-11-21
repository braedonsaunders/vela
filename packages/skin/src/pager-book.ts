// Each row pager's ends (whether the row is scrolled to its start and end), kept by row id outside
// the host. Only the nodes that read them (a row's arrows: `pager.*` bindings) redraw when a row
// reports: in the host's environment they redrew the row's whole route (15 000 components on a
// web arrow press, two seconds of a TV's JS thread when a section was shown again). Row ids are
// already unique across routes: the renderer's scroll views are kept by row id the same way.

export interface PagerState { atStart: boolean; atEnd: boolean }

const states = new Map<string, PagerState>();
const listeners = new Map<string, Set<() => void>>();

/** A row's ends, as last reported; none before its first report. */
export function pagerState(rowId: string): PagerState | undefined {
  return states.get(rowId);
}

/** A row reports its ends; only a change reaches the row's readers. */
export function reportPager(rowId: string, state: PagerState): void {
  const held = states.get(rowId);
  if (held?.atStart === state.atStart && held.atEnd === state.atEnd) return;
  states.set(rowId, { atStart: state.atStart, atEnd: state.atEnd });
  listeners.get(rowId)?.forEach(listener => listener());
}

/** Calls `listener` when the row's ends change. Returns the unsubscribe. */
export function subscribePager(rowId: string, listener: () => void): () => void {
  let set = listeners.get(rowId);
  if (!set) listeners.set(rowId, set = new Set());
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (!set!.size) listeners.delete(rowId);
  };
}

const PAGER_READS = new WeakSet<object>();
/** Mark a binding as reading pager state, so the renderer knows which nodes depend on it. */
export function pagerBinding<T extends object>(read: T): T {
  PAGER_READS.add(read);
  return read;
}

const dependents = new WeakMap<object, boolean>();
/** Whether a node's own fields (not its children or repeated item) read pager state. */
export function readsPager(node: object): boolean {
  const known = dependents.get(node);
  if (known !== undefined) return known;
  const seen = new Set<object>();
  const visit = (value: unknown, key: string): boolean => {
    if (key === 'children' || key === 'item') return false;
    if (typeof value === 'function') return PAGER_READS.has(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(item => visit(item, ''));
    return Object.entries(value).some(([name, item]) => visit(item, name));
  };
  const reads = visit(node, '');
  dependents.set(node, reads);
  return reads;
}
