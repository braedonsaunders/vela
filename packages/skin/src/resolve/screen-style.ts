// Styles of screen documents (docs/plugin-screens.md: Node language changes, Theming): any style
// value may hold a hole, and each hole's text is validated once filled, so data can size and colour
// things but never write CSS: a hole draws a length, a percentage, a number or a colour, else a
// harmless default. Token arithmetic (min, max, calc over px and numbers) is folded once; a
// color-mix() over a bound colour is folded when drawn, cached by its filled text.
import type { Accessor } from '../vocabulary';
import { compileTemplate, type HoleScope, type Template } from '../screen/holes';
import { parseColour } from '../screen/colour';
import { mixColours } from './colour-mix';

const COLOUR_ROWS = /colou?r$|^background-image$|^border$|^border-(top|bottom|left|right)?-?color$|^box-shadow$|^text-shadow$|^outline$/;
const LENGTH = /^-?\d*\.?\d+(px|%|vw|vh|deg|em|rem)?$/;

/** A filled hole's text in a style: a length, percentage, number or colour; anything else draws as
 * `transparent` (a colour row) or `0` (any other row). */
export function styleHole(row: string, value: string): string {
  const v = value.trim();
  if (LENGTH.test(v)) return v;
  if (parseColour(v)) return v;
  return COLOUR_ROWS.test(row) ? 'transparent' : '0';
}

/** A number with an optional px unit. */
interface Quantity { n: number; px: boolean }

/** Evaluate + - * / over px lengths and plain numbers; undefined for anything else (vw, %, words). */
function evaluate(expression: string): Quantity | undefined {
  const tokens = expression.match(/-?\d*\.?\d+(?:px)?|[()+\-*/,]|[a-z]+\(|\S+/gi);
  if (!tokens) return undefined;
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const call = (name: string): Quantity | undefined => {
    const args: (Quantity | undefined)[] = [sum()];
    while (peek() === ',') { next(); args.push(sum()); }
    if (next() !== ')' || args.some(a => !a)) return undefined;
    const values = args as Quantity[];
    const px = values.some(v => v.px);
    if (px && values.some(v => !v.px && v.n !== 0)) return undefined;
    const ns = values.map(v => v.n);
    if (name === 'calc') return values.length === 1 ? values[0] : undefined;
    return { n: name === 'min' ? Math.min(...ns) : Math.max(...ns), px };
  };
  function primary(): Quantity | undefined {
    const token = next();
    if (token === undefined) return undefined;
    if (token === '(') { const v = sum(); return next() === ')' ? v : undefined; }
    const fn = /^(calc|min|max)\($/i.exec(token);
    if (fn) return call(fn[1]!.toLowerCase());
    const m = /^(-?\d*\.?\d+)(px)?$/.exec(token);
    return m ? { n: Number(m[1]), px: !!m[2] } : undefined;
  }
  function product(): Quantity | undefined {
    let v = primary();
    while (v && (peek() === '*' || peek() === '/')) {
      const op = next();
      const r = primary();
      if (!r || (v.px && r.px) || (op === '/' && r.px)) return undefined;
      v = { n: op === '*' ? v.n * r.n : v.n / r.n, px: v.px || r.px };
    }
    return v;
  }
  function sum(): Quantity | undefined {
    let v = product();
    while (v && (peek() === '+' || peek() === '-')) {
      const op = next();
      const r = product();
      if (!r || v.px !== r.px) return undefined;
      v = { n: op === '+' ? v.n + r.n : v.n - r.n, px: v.px };
    }
    return v;
  }
  const value = sum();
  return at === tokens.length ? value : undefined;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** calc()/min()/max() over px and numbers folded to one length, innermost first; others left as written. */
export function fold(text: string): string {
  let out = text;
  for (let pass = 0; pass < 8; pass++) {
    const next = out.replace(/(calc|min|max)\(([^()]*)\)/gi, (whole, name: string) => {
      const v = evaluate(whole);
      return v && Number.isFinite(v.n) ? `${round(v.n)}${v.px ? 'px' : ''}` : whole.replace(/^(calc|min|max)\(/i, `${name}\u0000`);
    });
    if (next === out) break;
    out = next;
  }
  return out.replace(/\u0000/g, '(');
}

const mixes = new Map<string, string>();
/** color-mix() folded at draw time for a bound colour, cached by the filled text. */
function mixed(text: string): string {
  const hit = mixes.get(text);
  if (hit !== undefined) return hit;
  const value = mixColours(text);
  mixes.set(text, value);
  if (mixes.size > 512) mixes.delete(mixes.keys().next().value!);
  return value;
}

/**
 * Lengths that draw on whole and half points on every platform, as the built-in Sports screen drew
 * them: with `scale` points per CSS px (1 on the web and phones, 1.25 on Apple TV, the
 * Android TV pixel scale), each `<n>px` becomes the length that the renderer's scaling turns into
 * round(n x scale x 2) / 2 points.
 */
export function halfPoints(text: string, scale = 1, step = 0.5): string {
  return text.replace(/(^|[^\w.#-])(-?\d*\.?\d+)px\b/g, (_, lead: string, n: string) => {
    const points = Math.round(Number(n) * scale / step) * step;
    return `${lead}${Math.round((points / scale) * 10_000) / 10_000}px`;
  });
}

/**
 * A unitless line height beside a font size in px, as the length it makes, on half points: the
 * hard-coded screens set lineHeight = px(size x 1.25), so 11.5px text has a 14.5 point line, not 14.375.
 */
export function lineHeightPoints(fontSize: string | undefined, lineHeight: string | undefined, scale = 1, step = 0.5): string | undefined {
  const size = /^(\d*\.?\d+)px$/.exec(fontSize?.trim() ?? '');
  if (!size || !lineHeight || !/^\d*\.?\d+$/.test(lineHeight.trim())) return undefined;
  const points = Math.round(Number(size[1]) * Number(lineHeight) * scale / step) * step;
  return `${Math.round((points / scale) * 10_000) / 10_000}px`;
}

/** A screen document's style row, tokens already substituted: holes compiled and validated as filled. */
export function screenStyleRow(row: string, text: string, scope: HoleScope, scale = 1, step = 0.5): Template {
  const template = compileTemplate(text, scope, (hole: Accessor): Accessor => (c, e) => styleHole(row, hole(c, e)));
  // Each length rounds, and so does what folding makes of them (min($ui.radiusPanel * 0.6, 22px) is
  // 17px, as look.px rounded each radius); a border's computed width stays as computed (Crest's
  // max(1.5, size * 0.05) was never rounded).
  const raw = /^(border(?!-radius)|inset$|outline)/.test(row);
  const round = (t: string) => (raw ? fold(halfPoints(t, scale, step)) : halfPoints(fold(halfPoints(t, scale, step)), scale, step));
  if (typeof template === 'string') return mixColours(round(template));
  const parts = template.parts.map(p => (typeof p === 'string' ? round(p) : p));
  if (!text.includes('color-mix(')) return { parts };
  const whole: Accessor = (c, e) => mixed(parts.map(p => (typeof p === 'string' ? p : p(c, e))).join(''));
  return { parts: [whole] };
}
