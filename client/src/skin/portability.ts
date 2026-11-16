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

/** Why a row is refused on native, or null. */
function unsupported(row: string, value: string): string | null {
  if (row === '-webkit-text-stroke') return 'text stroke has no native equivalent; use one text-shadow';
  if (row === 'position' && /^(fixed|sticky|static)$/.test(value)) return `position: ${value} has no native equivalent`;
  if (row === 'box-sizing' && value === 'content-box') return 'native layout is always border-box';
  if (row === 'display' && /^(block|inline|inline-block|inline-flex|contents|table)$/.test(value)) {
    return `display: ${value} has no native equivalent (flex or none)`;
  }
  if (row === 'text-shadow' && topLevelCommas(value) > 0) return 'native draws one text shadow';
  if (row === 'mask-image' && value.includes('url(')) return 'an image mask has no native equivalent';
  if (/^grid-(row|column|template-rows|template-areas|area)/.test(row)) return 'grid placement has no native equivalent';
  return null;
}

/** How a row is approximated on native, or null. */
function approximated(row: string, value: string): string | null {
  if (row === 'backdrop-filter') return 'native blurs behind (expo-blur) and drops other filter functions';
  if (row === 'mask-image') return 'native masks with a gradient view';
  if (row === 'display' && value === 'grid') return 'native lays a grid out as wrapped flex rows';
  if (row === 'grid-template-columns') return 'native lays a grid out as wrapped flex rows of computed widths';
  if (row === 'filter') return 'native drops filter functions the platform lacks';
  if (row === 'corner-shape') return 'native draws a squircle only on Apple platforms';
  if (row === 'scroll-snap-type' || row === 'scroll-snap-align') return 'native snaps only items of a fixed width';
  return null;
}

function checkStyle(style: Record<string, unknown>, at: string, out: PortabilityFinding[]): void {
  for (const [row, raw] of Object.entries(style)) {
    const value = String(raw).trim();
    const refused = unsupported(row, value);
    if (refused) {
      out.push({ level: 'error', at, row, value, message: refused });
      continue;
    }
    const close = approximated(row, value);
    if (close) out.push({ level: 'warning', at, row, value, message: close });
  }
}

function walk(value: unknown, at: string, out: PortabilityFinding[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${at}[${i}]`, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = `${at}.${key}`;
    if (STYLE_KEYS.has(key) && child && typeof child === 'object') {
      checkStyle(child as Record<string, unknown>, path, out);
    } else if (STYLE_MAP_KEYS.has(key) && child && typeof child === 'object') {
      for (const [width, style] of Object.entries(child as Record<string, unknown>)) {
        if (style && typeof style === 'object') checkStyle(style as Record<string, unknown>, `${path}.${width}`, out);
      }
    } else {
      walk(child, path, out);
    }
  }
}

/** Every unsupported and approximated row the document writes (not the base it inherits). */
export function portabilityReport(doc: SkinDocument): PortabilityFinding[] {
  const out: PortabilityFinding[] = [];
  walk(doc.slots, 'slots', out);
  walk(doc.routes, 'routes', out);
  walk(doc.templates, 'templates', out);
  return out;
}
