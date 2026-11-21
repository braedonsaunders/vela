import { useState } from 'react';
import { Platform, Pressable, Text, type ViewStyle } from 'react-native';

/** The main region on show: the named one, else the first visible `main` (a section layout keeps
 * earlier sections mounted but hidden). */
function mainOnShow(target?: string): HTMLElement | null {
  if (target) return document.getElementById(target);
  return Array.from(document.querySelectorAll<HTMLElement>('[role="main"]')).find(element => element.getClientRects().length > 0
    && !element.closest('[aria-hidden="true"]') && getComputedStyle(element).visibility !== 'hidden') ?? null;
}

/** The web page's first tab stop, drawn only while focused, that moves focus past the navigation.
 * Place it before the shell; without a target it finds the route's visible main region. */
export function SkipToContent({ target }: { target?: string }) {
  const [focused, setFocused] = useState(false);
  if (Platform.OS !== 'web') return null;
  return (
    <Pressable accessibilityRole="link" {...{ href: `#${target ?? 'main'}` }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={event => {
        const main = mainOnShow(target);
        if (!main) return;
        event.preventDefault?.();
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
        main.scrollIntoView?.({ block: 'start' });
      }}
      style={{
        position: 'fixed', left: 12, top: focused ? 8 : -80, zIndex: 10000, paddingVertical: 10,
        paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#161616',
      } as unknown as ViewStyle}>
      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Skip to content</Text>
    </Pressable>
  );
}
