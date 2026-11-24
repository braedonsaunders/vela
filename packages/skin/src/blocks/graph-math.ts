// Pure geometry and colour helpers for the `lineGraph` block (probability / time-series charts).
// Computes Catmull-Rom cubic Bézier paths clamped to [0, height], approximate polyline path length
// for draw-on motion, and WCAG contrast adjustment for team/series accents.

export interface ProbabilityPoint {
  readonly x?: number;
  readonly t?: number;
  readonly p?: number;
  readonly value?: number;
  readonly home?: number;
}

export interface SeriesPoint {
  x: number;
  y: number;
}

/** Normalizes a probability / series array into `[0..1]` `(x, y)` coordinates where `y = 0` is 100% (top). */
export function normalizeSeriesPoints(
  series: readonly unknown[],
  subject: 0 | 1 = 1,
): SeriesPoint[] {
  const valid: number[] = [];
  const rawX: (number | undefined)[] = [];
  for (const item of series) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      const p = item > 1 ? item / 100 : item;
      valid.push(Math.max(0, Math.min(1, subject === 0 ? 1 - p : p)));
      rawX.push(undefined);
    } else if (item && typeof item === 'object') {
      const obj = item as { p?: unknown; home?: unknown; value?: unknown; y?: unknown; x?: unknown; t?: unknown };
      const rawVal = typeof obj.p === 'number'
        ? obj.p
        : typeof obj.home === 'number'
          ? obj.home
          : typeof obj.value === 'number'
            ? obj.value
            : typeof obj.y === 'number'
              ? obj.y
              : undefined;
      if (rawVal !== undefined && Number.isFinite(rawVal)) {
        const p = rawVal > 1 ? rawVal / 100 : rawVal;
        valid.push(Math.max(0, Math.min(1, subject === 0 ? 1 - p : p)));
        const xVal = typeof obj.x === 'number' && Number.isFinite(obj.x)
          ? obj.x
          : typeof obj.t === 'number' && Number.isFinite(obj.t)
            ? obj.t
            : undefined;
        rawX.push(xVal !== undefined && xVal >= 0 && xVal <= 1 ? xVal : undefined);
      }
    }
  }
  const n = valid.length;
  if (!n) return [];
  // Matches `@vela/core`'s `seriesPoints`: if the first/last points don't span 0..1 or lack t, spread evenly when needed,
  // or use `t` directly when `t` is in `[0..1]`.
  const hasExplicitT = rawX.every((x): x is number => x !== undefined) && (n === 1 || rawX[n - 1]! > rawX[0]!);
  return valid.map((p, i) => ({
    x: hasExplicitT ? rawX[i]! : (n === 1 ? 0 : i / (n - 1)),
    y: 1 - p,
  }));
}

/**
 * A smooth line through a probability series in a width × height box: Catmull-Rom through the
 * points as cubic Béziers, clamped so it never overshoots the box. Also the area under it.
 */
export function probabilityPath(
  series: readonly unknown[],
  width: number,
  height: number,
  subject: 0 | 1 = 1,
): { line: string; area: string; end?: { x: number; y: number } } {
  const points = normalizeSeriesPoints(series, subject).map(p => ({ x: p.x * width, y: p.y * height }));
  if (!points.length) return { line: '', area: '' };
  const r = (n: number) => Math.round(n * 100) / 100;
  if (points.length === 1) {
    const p = points[0]!;
    return { line: `M${r(p.x)},${r(p.y)}`, area: '', end: p };
  }
  let line = `M${r(points[0]!.x)},${r(points[0]!.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const clampY = (y: number) => Math.min(height, Math.max(0, y));
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: clampY(p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: clampY(p2.y - (p3.y - p1.y) / 6) };
    line += ` C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(p2.x)},${r(p2.y)}`;
  }
  const last = points.at(-1)!;
  const first = points[0]!;
  return { line, area: `${line} L${r(last.x)},${height} L${r(first.x)},${height} Z`, end: last };
}

/** A path's drawn length, approximately (the polyline through its points), for the draw-on motion. */
export function pathLength(
  series: readonly unknown[],
  width: number,
  height: number,
  subject: 0 | 1 = 1,
): number {
  const points = normalizeSeriesPoints(series, subject).map(p => ({ x: p.x * width, y: p.y * height }));
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return Math.ceil(length * 1.08) + 4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** Ensures a series/side colour has readable contrast against a light or dark card surface. */
export function readableSeriesColor(
  side: { readonly color?: string; readonly altColor?: string } | undefined,
  lightSurface: boolean,
  fallback: string,
): string {
  const normalizeHex = (raw: string | undefined): string => {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
    if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed}`;
    return trimmed;
  };
  const primary = normalizeHex(side?.color);
  const alt = normalizeHex(side?.altColor);
  const candidates = [primary, alt].filter(Boolean);
  if (!candidates.length) return fallback;
  const readable = (c: string) => (lightSurface ? luminance(c) < 0.5 : luminance(c) > 0.12);
  const found = candidates.find(readable);
  if (found) return found;
  const base = candidates[0]!;
  const hex = /^#([0-9a-f]{6})$/i.exec(base);
  if (!hex) return fallback;
  const n = parseInt(hex[1]!, 16);
  const mix = (channel: number) => Math.round(lightSurface ? channel * 0.55 : channel + (255 - channel) * 0.48);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
