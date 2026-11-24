// Focus bands and row guides for renderer-19 layout blocks (`sections`, `shelf`, `table`).
// On TV, horizontal shelves and section children remember their focused child via `TVFocusGuideView`
// with `autoFocus`, while long tables (`focusRows`) offer focusable rows so a remote steps row-by-row.
import { createElement, useCallback, useState, type ReactNode } from 'react';
import { Platform, Pressable, TVFocusGuideView, View, type ViewStyle } from 'react-native';
import { hasFocusableChild } from './layout-math';
import { alpha, type BlockLook } from './look';

export { hasFocusableChild };

/**
 * Wraps a horizontal row or section band in a `TVFocusGuideView` on TV so vertical directional
 * navigation enters the shelf's last-focused child rather than jumping to the nearest coordinate.
 */
export function FocusBand({ style, children }: { style?: ViewStyle; children: ReactNode }) {
  if (!Platform.isTV || !TVFocusGuideView) return createElement(View, { style }, children);
  return createElement(TVFocusGuideView, { autoFocus: true, style }, children);
}

/**
 * A focusable row inside a long table (`focusRows` threshold exceeded on TV) so the user can step
 * down a long table row-by-row with the directional remote without the header jumping off-screen.
 */
export function FocusableTableRow({
  look,
  style,
  label,
  children,
}: {
  look: BlockLook;
  style?: ViewStyle;
  label?: string;
  children: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  if (!Platform.isTV) return createElement(View, { style }, children);
  const { px } = look;
  return createElement(
    Pressable,
    {
      accessibilityLabel: label,
      onFocus,
      onBlur,
      style: [
        style,
        focused
          ? {
              backgroundColor: alpha(look.ink, 0.08),
              borderRadius: px(7),
            }
          : null,
      ],
    },
    children,
  );
}
