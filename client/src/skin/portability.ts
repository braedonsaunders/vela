// Which of a skin document's style rows draw the same on every platform (docs/rn-migration.md,
// "Style matrix"). Unsupported rows are refused by the checker; approximated rows draw close to
// their meaning on native and are noted. Supported, mapped and web-only rows pass silently.
import type { SkinDocument } from '../../wire/v0/skin';

export interface PortabilityFinding {
  level: 'error' | 'warning';
  /** Where the row is: the slot, route or template, then the path of keys to the style. */
  at: string;
  row: string;
  value: string;
  message: string;
}

/** Keys of a node whose value is one style (a set of rows). */
const STYLE_KEYS = new Set([
  'style', 'small', 'wide', 'hover', 'focus', 'groupHover', 'groupFocus', 'active', 'disabledStyle', 'inner',
]);
/** Keys of a node whose value maps viewport widths to styles. */
const STYLE_MAP_KEYS = new Set(['below', 'above']);

/** Commas that separate a list (several shadows), not those inside a function's parentheses. */
function topLevelCommas(text: string): number {
  let depth = 0;
  let commas = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) commas++;
  }
  return commas;
}

/** Where a style sits: whether its node is a direct child of a vertical scroll box. */
interface Place {
  inScroll: boolean;
}

/** Why a row is refused on native, or null. Sticky pins only a direct child of a route's root
 *  (the page's scroll content, whose scroll view the renderer owns) or of a vertical scroll box. */
function unsupported(row: string, value: string, place: Place): string | null {
  if (row === '-webkit-text-stroke') return 'text stroke has no native equivalent; use one text-shadow';
  if (row === 'position' && /^(fixed|static)$/.test(value)) return `position: ${value} has no native equivalent`;
  if (row === 'position' && value === 'sticky' && !place.inScroll) {
    return 'position: sticky only pins a direct child of a route root or of a vertical scroll box';
  }
  if (row === 'box-sizing' && value === 'content-box') return 'native layout is always border-box';
  if (row === 'display' && /^(block|inline|inline-block|inline-flex|contents|table)$/.test(value)) {
    return `display: ${value} has no native equivalent (flex or none)`;
  }
  if (row === 'text-shadow' && topLevelCommas(value) > 0) return 'native draws one text shadow';
  if (row === 'mask-image' && value.includes('url(')) return 'an image mask has no native equivalent';
  if (/^grid-(row|column|template-rows|template-areas|area)/.test(row)) {
    return 'grid placement has no native equivalent';
  }
  return null;
}

/** How a row is approximated on native, or null. */
function approximated(row: string, value: string): string | null {
  if (row === 'position' && value === 'sticky') {
    return 'native pins it at the top of its scroll box or page (a non-zero top is ignored)';
  }
  if (row === 'backdrop-filter') return 'native blurs behind (expo-blur) and drops other filter functions';
  if (row === 'mask-image') return 'native masks with a gradient view';
  if (row === 'display' && value === 'grid') return 'native lays a grid out as wrapped flex rows';
  if (row === 'grid-template-columns') return 'native lays a grid out as wrapped flex rows of computed widths';
  if (row === 'filter') return 'native drops filter functions the platform lacks';
  if (row === 'corner-shape') return 'native draws a squircle only on Apple platforms';
  if (row === 'scroll-snap-type' || row === 'scroll-snap-align') return 'native snaps only items of a fixed width';
  return null;
}

function checkStyle(style: Record<string, unknown>, at: string, place: Place, out: PortabilityFinding[]): void {
  for (const [row, raw] of Object.entries(style)) {
    const value = String(raw).trim();
    const refused = unsupported(row, value, place);
    if (refused) {
      out.push({ level: 'error', at, row, value, message: refused });
      continue;
    }
    const close = approximated(row, value);
    if (close) out.push({ level: 'warning', at, row, value, message: close });
  }
}

type NodeLike = Record<string, unknown>;

function isNode(value: unknown): value is NodeLike {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as NodeLike).type === 'string';
}

/** A box whose base style scrolls vertically (its direct children may stick). */
function scrollsVertically(node: NodeLike): boolean {
  const style = (node.style ?? {}) as Record<string, unknown>;
  const overflow = String(style['overflow-y'] ?? style.overflow ?? '').trim();
  return /^(auto|scroll)$/.test(overflow);
}

/** A node's own styles (its style, variants and states), then its children and repeated item.
 *  `scrolls`: the node is a vertical scroll box for its children (a page's root always is). */
function walkNode(
  node: NodeLike,
  at: string,
  place: Place,
  out: PortabilityFinding[],
  scrolls = scrollsVertically(node),
): void {
  for (const [key, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue;
    const path = `${at}.${key}`;
    if (STYLE_KEYS.has(key)) {
      checkStyle(value as Record<string, unknown>, path, place, out);
    } else if (STYLE_MAP_KEYS.has(key)) {
      for (const [width, style] of Object.entries(value as Record<string, unknown>)) {
        if (!style || typeof style !== 'object') continue;
        checkStyle(style as Record<string, unknown>, `${path}.${width}`, place, out);
      }
    } else if (key === 'states' && Array.isArray(value)) {
      value.forEach((state, i) => {
        walkNode({ type: 'state', ...(state as NodeLike) }, `${path}[${i}]`, place, out);
      });
    } else if (key === 'children' && Array.isArray(value)) {
      const childPlace = { inScroll: scrolls };
      value.forEach((child, i) => {
        if (isNode(child)) walkNode(child, `${path}[${i}]`, childPlace, out);
      });
    } else if (key === 'item' && isNode(value)) {
      // A repeat draws no box: its item sits where the repeat does.
      walkNode(value, path, place, out);
    }
  }
}

/** Each tree of a table (slots, routes or templates). A route's or home's root is the page's
 *  content inside its scroll view, so the root's direct children may stick. */
function walkTrees(trees: Record<string, unknown> | undefined, at: string, out: PortabilityFinding[]): void {
  for (const [name, root] of Object.entries(trees ?? {})) {
    if (!isNode(root)) continue;
    const pageRoot = at === 'routes' || (at === 'slots' && name === 'home');
    walkNode(root, `${at}.${name}`, { inScroll: false }, out, pageRoot || scrollsVertically(root));
  }
}

/** Every unsupported and approximated row the document writes (not the base it inherits). */
export function portabilityReport(doc: SkinDocument): PortabilityFinding[] {
  const out: PortabilityFinding[] = [];
  walkTrees(doc.slots, 'slots', out);
  walkTrees(doc.routes, 'routes', out);
  walkTrees(doc.templates, 'templates', out);
  return out;
}
