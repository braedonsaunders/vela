// A route's first TV focus. A route that opens (a title page over home) puts focus on its primary
// action, the first `play` press it draws (Resume, Play), once that is drawn; otherwise the focus
// engine takes the top-left-most control on screen, which is the shell's logo. Once the viewer has
// focused anything in the route, nothing is moved for them any more.
import { createContext, useContext, useMemo } from 'react';
import { Platform } from 'react-native';
import type { Focusable } from './escape';

export interface RouteFocus {
  /** A press button of the route was drawn. */
  offer(target: Focusable, action: string): void;
  /** A press button of the route took focus. */
  focused(): void;
}

export const RouteFocusContext = createContext<RouteFocus | null>(null);

/** The route's first focus, for SkinRoute to provide (TV only; null elsewhere). */
export function useRouteFocus(): RouteFocus | null {
  return useMemo(() => (Platform.isTV ? firstFocus() : null), []);
}

export function useRouteFocusContext(): RouteFocus | null {
  return useContext(RouteFocusContext);
}

function firstFocus(): RouteFocus {
  let settled = false;
  return {
    offer(target, action) {
      if (settled || action !== 'play') return;
      settled = true;
      requestAnimationFrame(() => {
        if (target.requestTVFocus) target.requestTVFocus();
        else target.focus?.();
      });
    },
    focused() {
      settled = true;
    },
  };
}
