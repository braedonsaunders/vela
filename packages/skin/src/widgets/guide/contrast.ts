interface Rgb { r: number; g: number; b: number }

function rgb(colour: string): Rgb | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? hex.split('').map(x => x + x).join('') : hex;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

function luminance(colour: string): number {
  const c = rgb(colour);
  if (!c) return 0;
  const channel = (value: number) => {
    const x = value / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function readableInk(background: string, light: string, dark: string): string {
  const bg = luminance(background);
  const ratio = (colour: string) => {
    const ink = luminance(colour);
    return (Math.max(bg, ink) + 0.05) / (Math.min(bg, ink) + 0.05);
  };
  return ratio(light) >= ratio(dark) ? light : dark;
}
