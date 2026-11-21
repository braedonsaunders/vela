// A navigation row kept to one line (`fit: 'nav'`, docs/skin-schema.md): from the measured
// extents of a hidden copy of the row, which draws every item and the More control, decide which
// destinations leave the row for its More menu. The copy never depends on the answer, so
// measuring cannot oscillate; only the room (the row's parent's width) and the items' own sizes
// change it.
import type { CssT, RNode } from './resolve';

/** One measured item of the copy, left to right: a destination's section key (`home`, a library
 * id, `live`), `more` for the More control, or null for anything else the row keeps (Search). */
export interface FitItem { key: string | null; x: number; width: number }

/** Sub-pixel layout (clamp()ed type) must not push out a tab that fits. */
const SLACK = 1;

/** The section keys of the destinations that do not fit `room`, given the copy's items and its own
 * width (its padding is what lies before the first item and after the last). Destinations leave
 * from the end, last first; the first destination (Home) always stays. Empty when all fit without
 * the More control. */
export function navOverflow(room: number, rowWidth: number, items: FitItem[]): string[] {
  // An item drawn at no width (display: none) is not laid out in the row.
  items = items.filter(item => item.width > 0);
  if (!items.length || room <= 0) return [];
  const first = items[0]!, last = items[items.length - 1]!;
  const padding = first.x + Math.max(0, rowWidth - (last.x + last.width));
  const gaps = items.slice(1).map((item, i) => item.x - (items[i]!.x + items[i]!.width));
  const gap = gaps.length ? Math.max(0, Math.min(...gaps)) : 0;
  const span = (shown: FitItem[]) => padding + shown.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, shown.length - 1);
  const destinations = items.filter(item => item.key !== null && item.key !== 'more');
  if (span(items.filter(item => item.key !== 'more')) <= room + SLACK) return [];
  const kept = items.filter(item => item.key === null || item.key === 'more');
  let shown = 1;
  while (shown < destinations.length && span([...kept, ...destinations.slice(0, shown + 1)]) <= room + SLACK) shown++;
  return destinations.slice(shown).map(item => item.key!);
}

/** Whether two answers are the same (the renderer re-draws the shell only on a change). */
export function sameOverflow(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/** Rows that tie a row's width to its parent's, or clip or scroll it: the measuring copy drops them,
 * so it lays out at its natural width (every item side by side) wherever it is drawn. */
const ROOMY = ['flex', 'flex-grow', 'flex-basis', 'width', 'min-width', 'max-width', 'overflow', 'overflow-x', 'overflow-y', 'mask-image', 'position', 'top', 'right', 'bottom', 'left', 'inset'];
function natural(style: CssT): CssT {
  const out: CssT = { ...style, 'flex-shrink': '0' };
  for (const row of ROOMY) delete out[row];
  return out;
}

/** The row as its hidden copy draws it: always, at its natural width, without motion or a name. */
export function measureCopy(node: Extract<RNode, { kind: 'box' }>): Extract<RNode, { kind: 'box' }> {
  return {
    ...node, fit: undefined, when: [], motion: undefined, role: undefined, label: undefined, testId: undefined, id: undefined,
    escape: undefined, returnFocus: undefined, press: undefined,
    base: { style: natural(node.base.style) },
    states: node.states.map(state => ({ when: state.when, layer: { style: natural(state.layer.style) } })),
  };
}

/** The section key a row item stands for: a library's id where it is drawn for one (`dest`), else
 * by what it presses (its own press or the first one drawn inside it): `home`, `live` or the library;
 * `more` for the row's More control, or null for the rest (Search, the profile). */
export function fitKey(node: RNode, press: { action: string; arg: string } | undefined, dest?: string): string | null {
  if (node.navMore) return 'more';
  if (dest) return dest;
  if (press?.action === 'home') return 'home';
  if (press?.action === 'live') return 'live';
  if (press?.action === 'library' && press.arg) return press.arg;
  return null;
}
