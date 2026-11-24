// Shared visual tokens, scaling, and colour helpers for renderer-19 layout blocks.
// Reads the active skin document's `ui` tokens (`resolveUi(host.doc.document.ui)`) and floating shell
// bar offset (`barOffset`) so blocks match the active skin, measured as the built-in Sports screen
// was (pixel parity).
import { useMemo } from 'react';
import { Platform, useWindowDimensions, type TextStyle } from 'react-native';
import { PX } from '../css';
import { fontFace } from '../fonts';
import { useOptionalHost } from '../host';
import { resolveUi } from '../resolve/ui';
import type { UiTokens } from '../resolve/ui-defaults';
import { tvPixelScale } from '../tv-pixel-scale';
import { barOffset } from './bar';

export { barOffset } from './bar';

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

/** Mixes two `#rrggbb` colours (`weight` 0..1 of `b`). */
export function mix(a: string, b: string, weight: number): string {
  const pa = /^#([0-9a-f]{6})$/i.exec(a.trim());
  const pb = /^#([0-9a-f]{6})$/i.exec(b.trim());
  if (!pa || !pb) return a;
  const na = parseInt(pa[1]!, 16);
  const nb = parseInt(pb[1]!, 16);
  const t = Math.max(0, Math.min(1, weight));
  const ch = (shift: number) => Math.round(((na >> shift) & 255) * (1 - t) + ((nb >> shift) & 255) * t);
  return `#${[ch(16), ch(8), ch(0)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
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
  ui: UiTokens;
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
  const scale = isTV && os === 'android' ? tvPixelScale(width, height) : PX;
  return (n: number) => Math.round(n * scale * 2) / 2;
}

export function useBlockLook(): BlockLook {
  const host = useOptionalHost();
  const window = useWindowDimensions();
  const block = host?.doc.document.ui;
  const width = host?.viewport.width ?? window.width;
  const height = host?.viewport.height ?? window.height;
  const still = host?.env.still ?? false;
  const shell = host?.doc.document.slots?.shell;
  const insetTop = host?.viewport.insets.top ?? 0;
  const small = width < 640;
  const barCss = useMemo(() => barOffset(shell, small, insetTop), [shell, small, insetTop]);
  return useMemo(() => {
    const ui = resolveUi(block);
    const light = isLight(ui.page);
    const px = createScalePx(width, height, Platform.isTV, Platform.OS);
    const tv = Platform.isTV || width >= 1600;
    return {
      ui,
      page: ui.page,
      raised: ui.raised,
      ink: ui.ink,
      secondary: ui.inkSecondary,
      quiet: ui.inkQuiet,
      accent: ui.accent,
      light,
      small,
      tv,
      still,
      width,
      height,
      line: alpha(ui.ink, 0.08),
      cardFill: mix(ui.page, ui.raised, 0.92),
      cardEdge: ui.glassEdge,
      chipFill: alpha(ui.ink, 0.07),
      live: ui.live,
      gutter: small ? px(18) : Math.max(px(28), width * 0.04),
      barTop: barCss ? px(barCss) : 0,
      px,
      face: (weight = 400, display = false) => fontFace(display ? ui.fontDisplay : ui.font, String(weight), false),
    };
  }, [block, width, height, small, still, barCss]);
}
