// CSS `color-mix(in srgb, A p%, B q%)` folded to one hex colour once a style's tokens are filled,
// so web and native draw the same colour (React Native does not parse color-mix). Mixing follows
// CSS Color 5: missing percentages complete each other to 100%, alpha is premultiplied, and a
// total under 100% scales the result's alpha. A mix whose colours cannot be read here
// (currentColor, a named colour other than black, white and transparent) is left as written.

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

function fromHex(digits: string): Rgba | undefined {
  if (![3, 4, 6, 8].includes(digits.length)) return undefined;
  const full = digits.length <= 4 ? [...digits].map(d => d + d).join('') : digits;
  const byte = (at: number) => parseInt(full.slice(at, at + 2), 16);
  return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
}

function fromRgb(body: string): Rgba | undefined {
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
  const alpha = (p: string | undefined) => (p === undefined ? 1 : p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p));
  const out = { r: channel(parts[0]!), g: channel(parts[1]!), b: channel(parts[2]!), a: alpha(parts[3]) };
  return Object.values(out).every(Number.isFinite) ? out : undefined;
}

function parse(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase();
  if (NAMED[value]) return NAMED[value];
  const hex = /^#([0-9a-f]+)$/.exec(value);
  if (hex) return fromHex(hex[1]!);
  const rgb = /^rgba?\(([^()]*)\)$/.exec(value);
  return rgb ? fromRgb(rgb[1]!) : undefined;
}

function hex(c: Rgba): string {
  const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${byte(c.a * 255)}`;
}

/** One argument of a mix: a colour and its optional percentage. */
function argument(text: string): { colour: Rgba; pct?: number } | undefined {
  const m = /^(.*?)(?:\s+(\d*\.?\d+)%)?$/.exec(text.trim());
  const colour = m && parse(m[1]!);
  if (!colour) return undefined;
  return { colour, pct: m![2] === undefined ? undefined : Number(m![2]) };
}

function mix(first: string, second: string): string | undefined {
  const a = argument(first);
  const b = argument(second);
  if (!a || !b) return undefined;
  let p = a.pct ?? (b.pct === undefined ? 50 : 100 - b.pct);
  let q = b.pct ?? 100 - p;
  const total = p + q;
  if (total <= 0) return undefined;
  const scale = Math.min(1, total / 100);
  p /= total;
  q /= total;
  const alpha = a.colour.a * p + b.colour.a * q;
  // A fully transparent result keeps the visible colour's channels: a gradient that fades to it
  // (`color-mix(in srgb, $ui.page 0%, transparent)`) then fades without a grey fringe on native.
  const visible = [a, b].filter(x => x.colour.a > 0);
  const channel = (k: 'r' | 'g' | 'b') =>
    alpha > 0
      ? (a.colour[k] * a.colour.a * p + b.colour[k] * b.colour.a * q) / alpha
      : visible.reduce((sum, x) => sum + x.colour[k], 0) / Math.max(1, visible.length);
  return hex({ r: channel('r'), g: channel('g'), b: channel('b'), a: alpha * scale });
}

// An argument: anything without commas or parentheses, or one rgb()/rgba() inside it.
const ARG = String.raw`((?:[^,()]|rgba?\([^()]*\))+)`;
const MIX = new RegExp(String.raw`color-mix\(\s*in\s+srgb\s*,` + ARG + ',' + ARG + String.raw`\)`, 'gi');

/** Every `color-mix(in srgb, …)` in a style value whose colours are known, as a hex colour. */
export function mixColours(text: string): string {
  if (!text.includes('color-mix(')) return text;
  return text.replace(MIX, (whole, first: string, second: string) => mix(first, second) ?? whole);
}
