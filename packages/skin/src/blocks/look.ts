// Shared visual tokens, scaling, and colour helpers for renderer-19 layout blocks.
// Reads the active skin document's variables (`surface.page`, `surface.raised`, `ink.primary`,
// `ink.secondary`, `ink.quiet`, `AccentColor`, `cinematic.display`, `--vela-bar-top`) so blocks
// match the active skin while preserving exact pixel parity with the legacy Sports layout.
import { useMemo } from 'react';
import { Platform, type TextStyle } from 'react-native';
import { colour, PX } from '../css';
import { fontFace } from '../fonts';
import { useHost } from '../host';
import { THEME } from '../theme';
import { tvPixelScale } from '../tv-pixel-scale';

/** A colour with an opacity (0–1): turns `#rrggbb`, `#rrggbbaa`, `#rgb`, `rgb()` into `rgba(...)`. */
export function alpha(c: string, a: number): string {
  const pct = Math.max(0, Math.min(1, a));
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (hex) {
    const raw = hex[1]!;
    const full = raw.length <= 4 ? [...raw.slice(0, 3)].map(ch => ch + ch).join('') : raw.slice(0, 6);
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${pct})`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c.trim());
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${pct})`;
  return c;
}

/** Whether a surface colour is light (such as Index or Mochi). */
export function isLight(c: string): boolean {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!hex) return false;
  const raw = hex[1]!;
  const full = raw.length <= 4 ? [...raw.slice(0, 3)].map(ch => ch + ch).join('') : raw.slice(0, 6);
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export interface BlockLook {
  page: string;
  raised: string;
  ink: string;
  secondary: string;
  quiet: string;
  accent: string;
  line: string;
  cardFill: string;
  cardEdge: string;
  chipFill: string;
  live: string;
  light: boolean;
  small: boolean;
  tv: boolean;
  still: boolean;
  width: number;
  height: number;
  gutter: number;
  barTop: number;
  px(n: number): number;
  face(weight?: number, display?: boolean): TextStyle;
}

export function createScalePx(width: number, height: number, isTV = Platform.isTV, os = Platform.OS): (n: number) => number {
  const scale = isTV && os === 'android' ? tvPixelScale(width, height) : (isTV ? 1.25 : PX);
  return (n: number) => Math.round(n * scale * 2) / 2;
}

export function useBlockLook(): BlockLook {
  const host = useHost();
  const { width, height } = host.viewport;
  const { small, tv, still } = host.env;
  const vars = host.doc.variables;
  return useMemo(() => {
    const pick = (name: string, fallback: string) => colour(vars[name] ?? THEME[name] ?? fallback) ?? fallback;
    const page = pick('surface.page', '#090b0e');
    const raised = pick('surface.raised', '#15191e');
    const ink = pick('ink.primary', '#f5f1e9');
    const secondary = pick('ink.secondary', '#b6b8bb');
    const quiet = pick('ink.quiet', '#858d98');
    const accent = pick('AccentColor', '#dcb998');
    const light = isLight(page);
    const displayStack = vars['cinematic.display'] ?? THEME['cinematic.display'] ?? 'Georgia, serif';
    const bodyStack = 'system-ui, -apple-system, sans-serif';
    const px = createScalePx(width, height, Platform.isTV, Platform.OS);
    const barCss = parseFloat(vars['x-vela-bar-top'] ?? '');
    return {
      page,
      raised,
      ink,
      secondary,
      quiet,
      accent,
      light,
      small,
      tv,
      still,
      width,
      height,
      line: alpha(ink, light ? 0.12 : 0.1),
      cardFill: light ? alpha('#ffffff', 0.82) : alpha(raised, 0.86),
      cardEdge: alpha(ink, light ? 0.11 : 0.09),
      chipFill: alpha(ink, light ? 0.07 : 0.08),
      live: '#e5484d',
      gutter: small ? px(18) : Math.max(px(28), width * 0.04),
      barTop: barCss ? px(barCss) : 0,
      px,
      face: (weight = 400, display = false) => fontFace(display ? displayStack : bodyStack, String(weight), false),
    };
  }, [vars, width, height, small, tv, still]);
}
