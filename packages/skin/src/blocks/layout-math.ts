// Pure layout, streaming, ordering, and tab-selection helpers for renderer-19 layout blocks.
// Tested without a React renderer via `bun:test`.

export type ParsedItemWidth =
  | { kind: 'auto' }
  | { kind: 'fixed'; width: number }
  | { kind: 'percent'; percent: number }
  | { kind: 'fit'; min: number; max: number };

const ROOT_FONT = 16;

function parseCssLength(raw: string, px: (n: number) => number, availableWidth = 0): number | undefined {
  const text = raw.trim();
  const m = /^(-?\d*\.?\d+)(px|rem|em|vw|%)?$/i.exec(text);
  if (!m) return undefined;
  const val = Number(m[1]);
  if (!Number.isFinite(val)) return undefined;
  const unit = (m[2] ?? 'px').toLowerCase();
  if (unit === 'px' || unit === '') return px(val);
  if (unit === 'rem' || unit === 'em') return px(val * ROOT_FONT);
  if (unit === 'vw' || unit === '%') return (val / 100) * availableWidth;
  return undefined;
}

/**
 * Parses a shelf `itemWidth` string:
 * - `undefined` / `""` / `"auto"` -> `{ kind: 'auto' }` (items size themselves)
 * - `"286px"` -> `{ kind: 'fixed', width: px(286) }`
 * - `"100%"` -> `{ kind: 'percent', percent: 100 }`
 * - `"fit 320px..640px"` -> `{ kind: 'fit', min: px(320), max: px(640) }`
 */
export function parseItemWidth(
  raw: string | undefined,
  px: (n: number) => number,
  availableWidth = 0,
): ParsedItemWidth {
  if (!raw || !raw.trim() || raw.trim().toLowerCase() === 'auto') return { kind: 'auto' };
  const text = raw.trim();
  const fitMatch = /^fit\s+([^\s.]+)\s*\.\.\s*([^\s]+)$/i.exec(text);
  if (fitMatch) {
    const min = parseCssLength(fitMatch[1]!, px, availableWidth) ?? px(320);
    const max = parseCssLength(fitMatch[2]!, px, availableWidth) ?? px(640);
    return { kind: 'fit', min: Math.min(min, max), max: Math.max(min, max) };
  }
  const pctMatch = /^(-?\d*\.?\d+)%$/.exec(text);
  if (pctMatch) {
    return { kind: 'percent', percent: Number(pctMatch[1]) };
  }
  const fixed = parseCssLength(text, px, availableWidth);
  return fixed !== undefined ? { kind: 'fixed', width: fixed } : { kind: 'auto' };
}

/**
 * Resolves the concrete point width of a shelf item given its parsed `itemWidth`,
 * the available inner width (`viewportWidth - gutter * 2`), and an optional measured
 * content natural width (used when `itemWidth` is `fit min..max`).
 * Returns `undefined` when `itemWidth` is `auto` (the item sizes itself).
 */
export function resolveShelfItemWidth(
  parsed: ParsedItemWidth,
  availableInnerWidth: number,
  naturalContentWidth?: number,
): number | undefined {
  if (parsed.kind === 'auto') return undefined;
  const cap = availableInnerWidth > 0 ? availableInnerWidth : Infinity;
  if (parsed.kind === 'fixed') return parsed.width;
  if (parsed.kind === 'percent') {
    return availableInnerWidth > 0 ? Math.round((parsed.percent / 100) * availableInnerWidth) : 286;
  }
  const high = Math.min(cap, parsed.max);
  const low = Math.min(parsed.min, high);
  const natural = naturalContentWidth ?? parsed.min;
  return Math.round(Math.max(low, Math.min(high, natural)));
}

/** Parses a CSS gap or height value (`"14px"`, `"26px"`, `"1rem"`) into scaled points. */
export function parsePoints(raw: string | undefined, px: (n: number) => number, fallback: number): number {
  if (!raw) return fallback;
  return parseCssLength(raw, px) ?? fallback;
}

export const FIRST_SECTIONS = 3;

/** Computes the initial and next streamed section counts so the first frame mounts at most `FIRST_SECTIONS`. */
export function initialStreamedCount(total: number, first = FIRST_SECTIONS): number {
  return Math.min(Math.max(0, total), first);
}

export function nextStreamedCount(mounted: number, total: number, first = FIRST_SECTIONS): number {
  if (total <= first) return Math.max(0, total);
  if (mounted >= total) return total;
  return Math.max(first, mounted + 1);
}

/**
 * Applies `stableOrder` to a list of items: records the first-seen index of each key in `seen`
 * and sorts items by their first-seen order so toggling a property (e.g. `favorite`) does not
 * reshuffle the shelf under a TV remote while mounted.
 */
export function applyStableOrder<T>(
  items: readonly T[],
  keyOf: (item: T, index: number) => string,
  seen: Map<string, number>,
): T[] {
  items.forEach((item, index) => {
    const k = keyOf(item, index);
    if (!seen.has(k)) seen.set(k, seen.size);
  });
  return [...items].sort((a, b) => {
    const ka = keyOf(a, 0);
    const kb = keyOf(b, 0);
    return (seen.get(ka) ?? 0) - (seen.get(kb) ?? 0);
  });
}

export interface TabBindingState {
  paramValue?: string;
  stateFlagActive?: (flag: string) => boolean;
  defaultValue?: string;
  hasAllOption: boolean;
  optionValues: readonly string[];
}

/**
 * Resolves the currently selected tab value for a `tabs` block:
 * - For `bind.param`: uses `paramValue` if non-empty; otherwise `defaultValue` if non-empty;
 *   otherwise `""` when `all` is present, or the first option's value when `all` is absent.
 * - For `bind.state`: uses whichever option value's flag (`${statePrefix}:${val}` or `val`) is active,
 *   falling back to `defaultValue` or `""`.
 */
export function resolveActiveTabValue(state: TabBindingState): string {
  const { paramValue, defaultValue, hasAllOption, optionValues } = state;
  if (paramValue !== undefined && paramValue !== '') return paramValue;
  if (defaultValue !== undefined && defaultValue !== '') return defaultValue;
  if (hasAllOption) return '';
  return optionValues[0] ?? '';
}

/** Chunks a flat array of items into rows of `columns` items each for row-virtualised `grid` rendering. */
export function chunkGridRows<T>(items: readonly T[], columns: number): T[][] {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols));
  }
  return rows;
}
