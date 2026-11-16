// A route's first TV focus. A route that opens (a title page over home) puts focus on its primary
// action, the first `play` press it draws (Resume, Play), once that is drawn; a route without one
// (a series page) on its first piece of content (a season, an extra, a cast card). Routes of forms
// (sign-in) have neither and are left to the focus engine. Otherwise the focus engine takes the
// top-left-most control on screen, which is the shell's logo. Once the viewer has focused anything
// in the route, nothing is moved for them any more.
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

/** How long a drawn route waits for a play press before settling for its first press. */
const PRIMARY_WAIT_MS = 500;
/** Presses that open a route's content, its first focus when it has no play press. */
const CONTENT = new Set(['select', 'playExtra']);

function firstFocus(): RouteFocus {
  let settled = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const focus = (target: Focusable) => {
    settled = true;
    clearTimeout(fallback);
    requestAnimationFrame(() => {
      if (target.requestTVFocus) target.requestTVFocus();
      else target.focus?.();
    });
  };
  return {
    offer(target, action) {
      if (settled) return;
      if (action === 'play') {
        focus(target);
        return;
      }
      if (fallback || !CONTENT.has(action)) return;
      fallback = setTimeout(() => {
        if (!settled) focus(target);
      }, PRIMARY_WAIT_MS);
    },
    focused() {
      settled = true;
      clearTimeout(fallback);
    },
  };
}
