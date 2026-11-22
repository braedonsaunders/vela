// Colour arithmetic for the Sports look: a colour at an opacity, and part way to another.
interface Rgba { r: number; g: number; b: number; a: number }

function parse(colour: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(colour.trim());
  if (hex) {
    const h = hex[1]!;
    const full = h.length <= 4 ? h.split('').map(x => x + x).join('') : h;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(colour.trim());
  if (fn) {
    const [r = 0, g = 0, b = 0, a = 1] = fn[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }
  return null;
}

const text = (c: Rgba) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 1000) / 1000})`;

/** The colour at an opacity (multiplied with its own). A colour it cannot read stays as written. */
export function alpha(colour: string, amount: number): string {
  const c = parse(colour);
  return c ? text({ ...c, a: c.a * amount }) : colour;
}

/** Part way (0..1) from one colour to another. */
export function mix(from: string, to: string, amount: number): string {
  const a = parse(from), b = parse(to);
  if (!a || !b) return from;
  const at = (x: number, y: number) => x + (y - x) * amount;
  return text({ r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b), a: at(a.a, b.a) });
}
