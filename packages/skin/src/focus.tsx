import { forwardRef, useEffect, type ComponentRef } from 'react';
import { Platform, Pressable, type PressableProps } from 'react-native';
import { FOCUS_CSS } from './focus-style';

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

/** A widget's press target. Widgets draw their own focus looks (a filled button, a lit row); on
 * the web the shared :focus-visible ring backs them up, natively nothing is laid over them. */
export const FocusPressable = forwardRef<ComponentRef<typeof Pressable>, PressableProps>(function FocusPressable(props, ref) {
  useFocusStyles();
  return <Pressable {...props} ref={ref} />;
});
