import { useEffect, useRef, type ElementRef } from 'react';
import { Platform, TextInput } from 'react-native';
import { focusTarget } from '../../escape';
import { shouldRefocusSearch } from './focus-policy';

/** Every skin's search field participates in the same header search action. */
export function useSearchFocus() {
  const input = useRef<ElementRef<typeof TextInput>>(null);
  useEffect(() => {
    let frame = 0;
    let requested = -Infinity;
    const unregister = focusTarget('vela-search')({ focus: () => {
      const target = input.current;
      const now = Date.now();
      const focused = !!target?.isFocused();
      const refocus = shouldRefocusSearch(focused, requested, now);
      requested = now;
      if (Platform.OS === 'android' && !Platform.isTV && target && refocus) {
        // Android may have focused the field during a slide without opening its IME.
        target.blur();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { if (input.current === target) target.focus(); });
      } else if (!focused) target?.focus();
    } });
    return () => { cancelAnimationFrame(frame); unregister?.(); };
  }, []);
  return input;
}
