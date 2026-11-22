// The Sports screen's and game page's palette, type and sizes, derived from the active document's
// `ui` block (as the guide's look is), so every skin draws Sports in its own colours, faces and
// corners. Lengths are CSS px scaled for the screen: a quarter larger on a TV, read across a room.
import { useMemo } from 'react';
import { Platform, useWindowDimensions, type TextStyle } from 'react-native';
import { resolveUi } from '../../resolve/ui';
import type { UiTokens } from '../../resolve/ui-defaults';
import { fontFace } from '../../fonts';
import { useOptionalHost } from '../../host';
import { tvPixelScale } from '../../tv-pixel-scale';
import { PX } from '../../css';
import { alpha, mix } from './colour';
import { readableInk } from '../guide/contrast';
import { barOffset } from './bar';

export interface SportsLook {
  ui: UiTokens;
  page: string;
  raised: string;
  ink: string;
  inkSecondary: string;
  inkQuiet: string;
  inkInverse: string;
  accent: string;
  onAccent: string;
  live: string;
  liveInk: string;
  /** Cards and panels on the page. */
  card: string;
  cardHover: string;
  edge: string;
  hairline: string;
  chip: string;
  /** The focus ring and its halo. */
  ring: string;
  halo: string;
  gold: string;
  radiusCard: number;
  radiusPanel: number;
  radiusControl: number;
  tv: boolean;
  small: boolean;
  width: number;
  /** CSS px to points. */
  px(n: number): number;
  /** The page's side gutter, in points. */
  gutter: number;
  /** Room at the top for a shell whose bar floats over the page (traits.barMask), in points. */
  barTop: number;
  font(weight: number): TextStyle;
  display(): TextStyle;
  /** Numbers that keep their width as they change (scores, clocks). */
  digits: TextStyle;
  still: boolean;
}

export function sportsLook(ui: UiTokens, width: number, height: number, still: boolean, barCss = 0): SportsLook {
  const scale = Platform.isTV && Platform.OS === 'android' ? tvPixelScale(width, height) : PX;
  const px = (n: number) => Math.round(n * scale * 2) / 2;
  const small = width < 640;
  return {
    ui,
    page: ui.page,
    raised: ui.raised,
    ink: ui.ink,
    inkSecondary: ui.inkSecondary,
    inkQuiet: ui.inkQuiet,
    inkInverse: ui.inkInverse,
    accent: ui.accent,
    onAccent: ui.onAccent,
    live: ui.live,
    liveInk: readableInk(ui.live, '#ffffff', '#111111'),
    card: mix(ui.page, ui.raised, 0.92),
    cardHover: mix(ui.raised, ui.ink, 0.06),
    edge: ui.glassEdge,
    hairline: alpha(ui.ink, 0.08),
    chip: ui.control,
    ring: ui.accent,
    halo: ui.focusHalo,
    gold: '#f5c451',
    radiusCard: Math.min(px(ui.radiusCard), px(18)),
    radiusPanel: Math.min(px(ui.radiusPanel * 0.6), px(22)),
    radiusControl: Math.min(ui.radiusControl, 999),
    tv: Platform.isTV || width >= 1600,
    small,
    width,
    px,
    gutter: small ? px(18) : Math.max(px(28), width * 0.04),
    barTop: barCss ? px(barCss) : 0,
    font: weight => fontFace(ui.font, String(weight), false),
    display: () => fontFace(ui.fontDisplay, '400', false),
    digits: { fontVariant: ['tabular-nums'] },
    still,
  };
}

export function useSportsLook(): SportsLook {
  const host = useOptionalHost();
  const window = useWindowDimensions();
  const block = host?.doc.document.ui;
  const width = host?.viewport.width ?? window.width;
  const height = host?.viewport.height ?? window.height;
  const still = host?.env.still ?? false;
  const shell = host?.doc.document.slots?.shell;
  const insetTop = host?.viewport.insets.top ?? 0;
  const bar = useMemo(() => barOffset(shell, width < 640, insetTop), [shell, width, insetTop]);
  return useMemo(() => sportsLook(resolveUi(block), width, height, still, bar), [block, width, height, still, bar]);
}
