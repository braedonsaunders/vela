// The look of the foundation's own surfaces (Connect a server, the server list): style rows
// written as documents write them, with `$ui.<name>` read from the active document's `ui` block,
// translated by the same style matrix as document nodes. Every document's look reaches these
// surfaces through its `ui` values, as it reaches the Vela base's routes.
import { useMemo } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';
import { resolveUi, uiValue } from '../../../../../client/src/skin/ui';
import type { UiTokens } from '../../../../../client/src/skin/ui-defaults';
import { animation } from '../../motion';
import { measure, useHost } from '../../host';
import { boxStyle, fontSizeOf, textStyle, type Css } from '../../translate';

export interface Look {
  ui: UiTokens;
  still: boolean;
  box(rows: Css): ViewStyle;
  /** A box's style and the effects drawn beside it (a native backdrop blur). */
  layer(rows: Css): { style: ViewStyle; blur?: number };
  /** Text rows over the document's sans face in its ink. */
  text(rows: Css): TextStyle;
  /** A motion preset of the document (the Vela base's `velaEnter60`, `velaPulse0`, …) as an
   * animation style for an Animated view; under reduced motion its still alternative, or none. */
  motion(name: string, index?: number, stagger?: { step: number; cap: number }): ViewStyle;
}

const ROOT_FONT = 16;

export function useLook(): Look {
  const host = useHost();
  const { doc, viewport, env } = host;
  return useMemo(() => {
    const ui = resolveUi(doc.document.ui);
    const tokens = (rows: Css): Css =>
      Object.fromEntries(
        Object.entries(rows).map(([row, value]) => [
          row,
          value.replace(/\$ui\.([A-Za-z]+)/g, (_, name: string) => uiValue(ui, name)),
        ]),
      );
    const m = measure(viewport, ROOT_FONT);
    return {
      ui,
      still: env.still,
      box: rows => boxStyle(tokens(rows), m).style as ViewStyle,
      layer: rows => {
        const { style, fx } = boxStyle(tokens(rows), m);
        return { style: style as ViewStyle, blur: fx.backdropBlur };
      },
      text: rows => {
        const filled = tokens({ 'font-family': '$ui.font', color: '$ui.ink', ...rows });
        const fontSize = fontSizeOf(filled['font-size'], ROOT_FONT, m);
        return textStyle(filled, measure(viewport, fontSize)).style;
      },
      motion: (name, index = 0, stagger) =>
        (animation(doc.motion[name], doc.keyframes, env.still, index, stagger) ?? {}) as ViewStyle,
    };
  }, [doc, viewport, env.still]);
}
