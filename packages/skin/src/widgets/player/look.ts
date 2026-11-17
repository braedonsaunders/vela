// Player typography and geometry follow the document; the video overlay uses
// a contrasting palette independent of the page behind other routes.
import { playerPalette } from './palette';
import { useMemo } from 'react';
import { Platform, type TextStyle } from 'react-native';
import { resolveUi } from '../../resolve/ui';
import { uiDefaults } from '../../resolve/ui-defaults';
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

/** Design sizes on a 1080-line TV, against the 1440 px desktop they are written for. */
const TV_SCALE = 1.4;
const TV_HEIGHT = 1080;

export function usePlayerLook(): PlayerLook {
  const { doc, env, viewport } = useHost();
  // A wide desktop window still uses pointer-sized controls, not remote/TV styling.
  const tv = Platform.isTV;
  const small = !tv && viewport.width < 640;
  return useMemo(() => {
    const ui = resolveUi(doc.document.ui);
    const colours = {} as Colours;
    for (const name of COLOUR_KEYS) colours[name] = colour(String(ui[name])) ?? uiDefaults[name];
    // Video has no page background: light-page inks disappear over black, and
    // translucent page surfaces disappear over bright footage. Keep the chrome
    // on a shared dark surface with opaque light inks, independently of the page.
    Object.assign(colours, playerPalette(colours));
    // A television is a fixed canvas seen from across the room: the chrome takes the same share
    // of it at any resolution (tvOS lays out 1080 points; Android TV 540 dp at 1080p).
    const scale = tv ? TV_SCALE * Math.min(1, viewport.height / TV_HEIGHT) : 1;
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
  }, [doc, tv, small, env.still, viewport.height]);
}
