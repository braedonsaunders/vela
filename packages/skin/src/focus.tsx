import { forwardRef, useEffect, useState, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, type PressableProps, type ViewStyle } from 'react-native';
import { isFocusVisible } from './focus-visible';
import { FOCUS_CSS, focusStyle } from './focus-style';

/** Install once per document; keyboard focus is independent of any skin's authored look. */
export function useFocusStyles() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('vela-focus')) return;
    const style = document.createElement('style');
    style.id = 'vela-focus';
    style.textContent = FOCUS_CSS;
    document.head.appendChild(style);
  }, []);
}

/** The native counterpart to :focus-visible, shared by widget press targets. */
export const FocusPressable = forwardRef<ComponentRef<typeof Pressable>, PressableProps>(function FocusPressable(props, ref) {
  useFocusStyles();
  const [focused, setFocused] = useState(false);
  const { style, onFocus, onBlur, ...rest } = props;
  return <Pressable {...rest} ref={ref}
    onFocus={event => {
      if (props.focusable !== false) setFocused(isFocusVisible(event.currentTarget));
      onFocus?.(event);
    }}
    onBlur={event => { setFocused(false); onBlur?.(event); }}
    style={state => {
      const own = typeof style === 'function' ? style(state) : style;
      const flat = StyleSheet.flatten(own);
      return [own, focused && Platform.OS !== 'web' ? focusStyle(flat?.transform) as ViewStyle : null];
    }}
  />;
});
