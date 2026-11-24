// Colour arithmetic for screen documents' colour pipes (docs/plugin-screens.md: Bindings): the
// relative luminance of a colour, a colour part way to another, and one at an opacity, with the
// rules the built-in Sports screen used (pixel parity).

export interface Rgba { r: number; g: number; b: number; a: number }

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
};

/** Hue (degrees), saturation and lightness (0..1) to RGB channels. */
function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** A colour as RGBA: hex (3, 4, 6 or 8 digits), rgb()/rgba(), hsl()/hsla(), white, black or transparent. */
export function parseColour(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase();
  if (NAMED[value]) return NAMED[value];
  const hex = /^#([0-9a-f]+)$/.exec(value);
  if (hex) {
    const digits = hex[1]!;
    if (![3, 4, 6, 8].includes(digits.length)) return undefined;
    const full = digits.length <= 4 ? [...digits].map(d => d + d).join('') : digits;
    const byte = (at: number) => parseInt(full.slice(at, at + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(value);
  if (!fn) return undefined;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  let channels: [number, number, number];
  if (fn[1]!.startsWith('rgb')) {
    const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    channels = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)];
  } else {
    const pct = (p: string) => parseFloat(p) / 100;
    channels = fromHsl(parseFloat(parts[0]!), pct(parts[1]!), pct(parts[2]!));
  }
  const out = { r: channels[0], g: channels[1], b: channels[2], a: alpha };
  return Object.values(out).every(Number.isFinite) ? out : undefined;
}

const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** #rrggbb, or #rrggbbaa when not opaque. */
export function hexColour(c: Rgba): string {
  const alpha = Math.min(1, Math.max(0, c.a));
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${alpha >= 1 ? '' : byte(alpha * 255)}`;
}

/** WCAG relative luminance of a #rrggbb colour; 0.5 for anything else (as Sports' luminance()). */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

const rgbaText = (c: Rgba) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 1000) / 1000})`;

/** The colour at an opacity (multiplied with its own); a colour it cannot read stays as written. */
export function withAlpha(colour: string, amount: number): string {
  const c = parseColour(colour);
  return c ? rgbaText({ ...c, a: c.a * Math.min(1, Math.max(0, amount)) }) : colour;
}

/** Part way (0..1) from one colour to another (Sports' mix()). */
export function towards(from: string, to: string, amount: number): string {
  const a = parseColour(from), b = parseColour(to);
  if (!a || !b) return from;
  const at = (x: number, y: number) => x + (y - x) * amount;
  return rgbaText({ r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b), a: at(a.a, b.a) });
}

/** A side's fill dark enough to carry white text: its colour, else its alternate, else a navy (Sports' heroTint). */
export function tint(colour: string, altColour: string): string {
  const pick = [colour, altColour].find(c => c && luminance(c) < 0.45);
  return pick || colour || '#1d2a44';
}

/** A crest's fill: the colour, or a hue hashed from the name so that crests still differ (Sports' crestColor). */
export function crest(colour: string, name: string): string {
  if (colour) return colour;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 45%, 34%)`;
}

/** A data colour lifted until it reads on the page: a navy on a dark page is lightened (Sports' readableTeam). */
export function readable(colour: string, page: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour || '#7aa2ff';
  const dark = luminance(page) < 0.4;
  const l = luminance(colour);
  if (dark && l < 0.12) return towards(colour, '#ffffff', Math.min(0.6, 0.12 + (0.12 - l) * 3.4));
  if (!dark && l > 0.6) return towards(colour, '#000000', 0.35);
  return colour;
}
