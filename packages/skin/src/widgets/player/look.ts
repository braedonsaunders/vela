// The chrome's look, from the document's `ui` block (docs/skin-schema.md): the colours, the two
// font stacks and the radii the Vela base styles itself with. A document that leaves a key out
// reads Cinematic's value, so every document gets a coherent chrome in its own colours.
import { useMemo } from 'react';
import { Platform, type TextStyle } from 'react-native';
import { resolveUi } from '../../../../../client/src/skin/ui';
import { uiDefaults } from '../../../../../client/src/skin/ui-defaults';
import { colour } from '../../css';
import { fontFace } from '../../fonts';
import { useHost } from '../../host';

type Colours = {
  -readonly [K in keyof typeof uiDefaults as (typeof uiDefaults)[K] extends string ? K : never]: string;
};

export interface PlayerLook extends Omit<Colours, 'font' | 'fontDisplay'> {
  radiusControl: number;
  radiusPanel: number;
  /** Phones: tighter gutters, no volume slider, full-width panels. */
  small: boolean;
  /** Television: larger type and targets, focus instead of hover. */
  tv: boolean;
  /** Reduced motion: no slides, no spin. */
  still: boolean;
  /** Distance from the screen's edges. */
  gutter: number;
  /** A design size (as drawn at 1440 px) in points for this screen. */
  size(px: number): number;
  /** Body text at a size and weight, in the document's text face. */
  text(px: number, weight?: number, color?: string): TextStyle;
  /** Display text (headings, the bitrate) in the document's display face. */
  display(px: number, color?: string): TextStyle;
}

const COLOUR_KEYS = Object.keys(uiDefaults).filter(
  k => typeof uiDefaults[k as keyof typeof uiDefaults] === 'string' && k !== 'font' && k !== 'fontDisplay',
) as (keyof Colours)[];

export function usePlayerLook(): PlayerLook {
  const { doc, env, viewport } = useHost();
  const tv = Platform.isTV || env.tv;
  const small = !tv && viewport.width < 640;
  return useMemo(() => {
    const ui = resolveUi(doc.document.ui);
    const colours = {} as Colours;
    for (const name of COLOUR_KEYS) colours[name] = colour(String(ui[name])) ?? uiDefaults[name];
    const scale = tv ? 1.4 : 1;
    const size = (px: number) => Math.round(px * scale);
    const text = (px: number, weight = 400, color = colours.ink): TextStyle => ({
      ...fontFace(ui.font, String(weight), false),
      fontSize: size(px),
      color,
    });
    const display = (px: number, color = colours.ink): TextStyle => ({
      ...fontFace(ui.fontDisplay, '400', false),
      fontSize: size(px),
      color,
    });
    return {
      ...colours,
      radiusControl: ui.radiusControl,
      radiusPanel: ui.radiusPanel,
      small,
      tv,
      still: env.still,
      gutter: small ? 16 : size(40),
      size,
      text,
      display,
    };
  }, [doc, tv, small, env.still]);
}
