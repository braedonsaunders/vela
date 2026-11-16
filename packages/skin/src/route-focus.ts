// A route's first TV focus. A route that opens (a title page over home) puts focus on its primary
// action, the first `play` press drawn on its first screen (Resume, Play); a route without one (a
// series page) on its first piece of content there (a season, an extra). Otherwise the focus
// engine takes the top-left-most control on screen, which is the shell's logo.
//
// Only while the route opens: once anything in it takes focus (a press, a widget, the search
// field) or the opening window passes, nothing is moved for the viewer any more. Content drawn
// later (search results, more rows) never takes focus by itself. A control below the first screen
// is never chosen, so a route always opens at its top.
import { createContext, useContext, useMemo } from 'react';
import { Dimensions, Platform } from 'react-native';
import type { Focusable } from './escape';

export interface RouteFocus {
  /** A press button of the route was drawn. */
  offer(target: Focusable, action: string): void;
  /** Something in the route took focus. */
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

/** How long a route counts as opening (a title's details arrive within it). */
const OPENING_MS = 5000;
/** How long a drawn route waits for a play press before settling for its first content press. */
const PRIMARY_WAIT_MS = 500;
/** Presses that open a route's content, its first focus when it has no play press. */
const CONTENT = new Set(['select', 'playExtra']);

interface Measurable {
  measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void;
}

/** Answers whether the control lies on the first screen, in full. */
function onFirstScreen(target: Focusable, answer: (visible: boolean) => void): void {
  const measurable = target as Measurable;
  if (!measurable.measureInWindow) {
    answer(true);
    return;
  }
  measurable.measureInWindow((_x, y, _width, height) => {
    answer(height > 0 && y >= 0 && y + height <= Dimensions.get('window').height);
  });
}

function firstFocus(): RouteFocus {
  const deadline = Date.now() + OPENING_MS;
  let settled = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const open = () => !settled && Date.now() < deadline;
  const settle = () => {
    settled = true;
    clearTimeout(fallback);
  };
  const focus = (target: Focusable) => {
    if (!open()) return;
    settle();
    if (target.requestTVFocus) target.requestTVFocus();
    else target.focus?.();
  };
  // Measured once laid out; a control off the first screen is passed over.
  const tryFocus = (target: Focusable) => {
    requestAnimationFrame(() => onFirstScreen(target, visible => {
      if (visible) focus(target);
    }));
  };
  return {
    offer(target, action) {
      if (!open()) return;
      if (action === 'play') {
        tryFocus(target);
        return;
      }
      if (fallback || !CONTENT.has(action)) return;
      fallback = setTimeout(() => tryFocus(target), PRIMARY_WAIT_MS);
    },
    focused: settle,
  };
}
