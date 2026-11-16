// CSS values as skin documents write them, turned into the numbers and strings React Native
// takes. Lengths in px, rem, em, ch, vw/vh (and the dynamic viewport units), percentages, and
// calc()/min()/max()/clamp() over them are evaluated here, against the viewport and the font
// size in force. Theme token names become their colours.
import { THEME } from './theme.generated';

export interface Viewport {
  width: number;
  height: number;
  /** Safe-area insets, for env(safe-area-inset-*). */
  insets: { top: number; right: number; bottom: number; left: number };
}

/** What a length is measured against: the font size in force, and which viewport axis a
 * percentage inside a mixed expression approximates (React Native cannot mix % with px). */
export interface Measure {
  viewport: Viewport;
  fontSize: number;
  axis: 'x' | 'y';
}

const ROOT_FONT = 16;

/** A theme token by name, or undefined. */
export function themeToken(name: string): string | undefined {
  return THEME[name];
}

/** `var(--name)` and bare token names (`ink.primary`) replaced by their values. */
export function withTokens(text: string): string {
  return text
    .replace(/var\(--([A-Za-z][\w.-]*)\)/g, (all, name: string) => THEME[name] ?? THEME[name.replace(/^x-/, '')] ?? all)
    .replace(/(^|[\s,(])([a-z][\w-]*(?:\.[\w-]+)+)(?=$|[\s,)])/g, (all, lead: string, name: string) => (THEME[name] ? lead + THEME[name] : all));
}

/** A length's value: a number of points, or a percentage of the parent. */
export type Length = number | `${number}%`;

/** Split on whitespace and commas outside parentheses. */
export function splitTop(text: string, separator: 'space' | 'comma'): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    const splits = depth === 0 && (separator === 'comma' ? ch === ',' : /\s/.test(ch));
    if (splits) {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** One unit's size in points. Percentages are handled by the caller. */
function unitPoints(unit: string, m: Measure): number | undefined {
  const { width, height } = m.viewport;
  switch (unit) {
    case '':
    case 'px': return 1;
    case 'rem': return ROOT_FONT;
    case 'em': return m.fontSize;
    case 'ch': return m.fontSize * 0.5;
    case 'ex': return m.fontSize * 0.5;
    case 'vw': case 'svw': case 'lvw': case 'dvw': return width / 100;
    case 'vh': case 'svh': case 'lvh': case 'dvh': return height / 100;
    case 'vmin': return Math.min(width, height) / 100;
    case 'vmax': return Math.max(width, height) / 100;
    default: return undefined;
  }
}

/** A tiny evaluator for the expressions documents use: + - * / over lengths and numbers,
 * with calc, min, max, clamp and env(safe-area-inset-*). A percentage is resolved against the
 * viewport axis, an approximation used only inside mixed expressions. */
function evaluate(expression: string, m: Measure): number | undefined {
  const tokens = expression.match(/env\(safe-area-inset-(?:top|right|bottom|left)(?:,[^)]*)?\)|-?\d*\.?\d+(?:e-?\d+)?[a-z%]*|[a-z-]+\(|[()+\-*/,]/gi);
  if (!tokens) return undefined;
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const percentBase = m.axis === 'x' ? m.viewport.width : m.viewport.height;

  function primary(): number | undefined {
    const token = next();
    if (token === undefined) return undefined;
    if (token === '(') { const v = sum(); next(); return v; }
    if (token === '-') { const v = primary(); return v === undefined ? undefined : -v; }
    const inset = /^env\(safe-area-inset-(top|right|bottom|left)/.exec(token);
    if (inset) return m.viewport.insets[inset[1] as keyof Viewport['insets']];
    const call = /^(calc|min|max|clamp)\($/i.exec(token);
    if (call) {
      const args: (number | undefined)[] = [sum()];
      while (peek() === ',') { next(); args.push(sum()); }
      next();
      if (args.some(a => a === undefined)) return undefined;
      const values = args as number[];
      switch (call[1].toLowerCase()) {
        case 'calc': return values[0];
        case 'min': return Math.min(...values);
        case 'max': return Math.max(...values);
        default: return Math.min(Math.max(values[0], values[1]), values[2]);
      }
    }
    const number = /^(-?\d*\.?\d+(?:e-?\d+)?)([a-z%]*)$/i.exec(token);
    if (!number) return undefined;
    const value = Number(number[1]);
    if (number[2] === '%') return (value / 100) * percentBase;
    const unit = unitPoints(number[2].toLowerCase(), m);
    return unit === undefined ? undefined : value * unit;
  }
  function product(): number | undefined {
    let v = primary();
    while (v !== undefined && (peek() === '*' || peek() === '/')) {
      const op = next();
      const r = primary();
      if (r === undefined) return undefined;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function sum(): number | undefined {
    let v = product();
    while (v !== undefined && (peek() === '+' || peek() === '-')) {
      const op = next();
      const r = product();
      if (r === undefined) return undefined;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const value = sum();
  return at === tokens.length ? value : undefined;
}

/** A length, or undefined when the value is not one (`auto`, keywords, garbage). A plain
 * percentage stays a percentage; anything else is evaluated to points. */
export function length(raw: string, m: Measure): Length | undefined {
  const text = raw.trim();
  const percent = /^(-?\d*\.?\d+)%$/.exec(text);
  if (percent) return `${Number(percent[1])}%`;
  const value = evaluate(text, m);
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value * 100) / 100;
}

/** A length in points; a percentage resolves against the given base. */
export function points(raw: string, m: Measure, base = 0): number | undefined {
  const value = length(raw, m);
  if (value === undefined) return undefined;
  return typeof value === 'number' ? value : (parseFloat(value) / 100) * base;
}

/** Every length inside free text (a shadow, a gradient) rewritten in px, for the CSS strings
 * React Native parses itself, which take px and percentages only. */
export function pxText(text: string, m: Measure): string {
  const withExpressions = text.replace(/(calc|min|max|clamp)\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, expr => {
    const v = evaluate(expr, m);
    return v === undefined ? expr : `${Math.round(v * 100) / 100}px`;
  });
  return withExpressions.replace(/(-?\d*\.?\d+)(rem|em|ch|vw|vh|dvh|svh|lvh|vmin|vmax)\b/g, (_, n: string, unit: string) =>
    `${Math.round(Number(n) * (unitPoints(unit, m) ?? 1) * 100) / 100}px`);
}

/** A colour React Native accepts, or undefined. Token names and var() become their values. */
export function colour(raw: string): string | undefined {
  const text = withTokens(raw.trim());
  if (!text || text === 'none') return undefined;
  if (/^currentColor$/i.test(text)) return undefined;
  if (/^(color-mix|oklch|oklab|lab|lch)\(/i.test(text)) return undefined;
  return text;
}

/** Stops and direction of a linear-gradient, for masks drawn with expo-linear-gradient. */
export interface LinearGradient {
  colors: string[];
  locations: number[];
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export function linearGradient(raw: string): LinearGradient | undefined {
  const match = /^linear-gradient\((.*)\)$/i.exec(withTokens(raw.trim()));
  if (!match) return undefined;
  const parts = splitTop(match[1], 'comma');
  let angle = 180;
  if (parts.length && /^(-?\d*\.?\d+deg|to\s)/.test(parts[0])) {
    const first = parts.shift()!;
    const sides: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
    angle = first.endsWith('deg') ? parseFloat(first) : sides[first] ?? 180;
  }
  const colors: string[] = [];
  const stops: (number | undefined)[] = [];
  for (const part of parts) {
    const pieces = splitTop(part, 'space');
    const pct = pieces.find(p => p.endsWith('%'));
    const c = pieces.find(p => !p.endsWith('%'));
    if (!c) continue;
    colors.push(c === 'black' ? '#000' : c);
    stops.push(pct === undefined ? undefined : parseFloat(pct) / 100);
  }
  if (colors.length < 2) return undefined;
  const locations = stops.map((s, i) => s ?? i / (stops.length - 1));
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians) / 2;
  const dy = -Math.cos(radians) / 2;
  return { colors, locations, start: { x: 0.5 - dx, y: 0.5 - dy }, end: { x: 0.5 + dx, y: 0.5 + dy } };
}
