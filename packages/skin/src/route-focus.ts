// A route's first TV focus. A route that opens (a title page over home) puts focus on its primary
// action, the first `play` press drawn on its first screen (Resume, Play); a route without one (a
// series page) on its first piece of content there (a season, an extra). Otherwise the focus
// engine takes the top-left-most control on screen, which is the shell's logo.
//
// Only while the route opens: once the viewer has moved focus to anything in it (a press, a widget,
// the search field) or the opening window passes, nothing is moved for them any more. Focus the
// engine gives on its own (the first control on screen, a hero's carousel dot) does not count. Content drawn
// later (search results, more rows) never takes focus by itself. A control that starts below the
// first screen is never chosen, so a route always opens at its top.
import { createContext, useContext, useMemo } from 'react';
import { Dimensions, Platform, TVEventHandler } from 'react-native';
import type { Focusable } from './escape';

export interface RouteFocus {
  /** A press button of the route was drawn. */
  offer(target: Focusable, action: string): void;
  /** Something in the route took focus. */
  focused(): void;
}

export const RouteFocusContext = createContext<RouteFocus | null>(null);

/** When the viewer last pressed or swiped on the remote (focus changes are not theirs). */
let lastViewerPress = 0;
let listening = false;
function listen(): void {
  if (listening || typeof TVEventHandler?.addListener !== 'function') return;
  listening = true;
  TVEventHandler.addListener(event => {
    if (event.eventType !== 'focus' && event.eventType !== 'blur') lastViewerPress = Date.now();
  });
}

/** The route's first focus, for SkinRoute to provide (TV only; null elsewhere). */
export function useRouteFocus(): RouteFocus | null {
  if (Platform.isTV) listen();
  return useMemo(() => (Platform.isTV ? firstFocus() : null), []);
}

export function useRouteFocusContext(): RouteFocus | null {
  return useContext(RouteFocusContext);
}

/** How long a route counts as opening (a title's details arrive within it). */
const OPENING_MS = 5000;
/** How long a drawn route waits for a play press before settling for its first content press. */
const PRIMARY_WAIT_MS = 500;
/** The press that opened a route reaches the remote listener just after the route mounts (its
 * key-up follows the press); presses this soon after opening are that one, not the viewer's next. */
const OPENING_PRESS_MS = 400;
/** When a route's opening motion has settled (velaOpen, the longest, runs 640 ms). */
const SETTLED_MS = 700;
/** Presses that open a route's content, its first focus when it has no play press; on a plugin
 * screen also its navigation and plugin presses, and (`stop`) a reading stop, in document order. */
const CONTENT = new Set(['select', 'playExtra', 'navigate', 'plugin', 'setParam', 'stop']);

interface Measurable {
  measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void;
}

/** Answers whether the control starts on the first screen. Only its top counts: a control still
 * rising into place (a hero's entrance) measures lower than it will stand. */
function onFirstScreen(target: Focusable, answer: (visible: boolean) => void): void {
  const measurable = target as Measurable;
  if (!measurable.measureInWindow) {
    answer(true);
    return;
  }
  measurable.measureInWindow((_x, y, _width, height) => {
    answer(height > 0 && y < Dimensions.get('window').height);
  });
}

/** Whether the viewer has pressed or swiped on the remote since `time` (TV; never elsewhere). */
export function viewerPressedSince(time: number): boolean {
  if (Platform.isTV) listen();
  return lastViewerPress > time;
}

/** Whether the viewer has pressed or swiped since a route opened (not the press that opened it). */
function pressedSince(opened: number): boolean {
  return lastViewerPress > opened + OPENING_PRESS_MS;
}

function move(target: Focusable): void {
  if (target.requestTVFocus) target.requestTVFocus();
  else target.focus?.();
}

function firstFocus(): RouteFocus {
  const opened = Date.now();
  const deadline = opened + OPENING_MS;
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
    move(target);
    // A route that opens with a motion (the title card fades and rises in) cannot take focus while
    // it is still all but transparent: the engine refuses it and falls back to whatever it likes
    // (the card's close button). Asked again once the motion has settled, unless the viewer has
    // pressed something meanwhile.
    setTimeout(() => {
      if (!pressedSince(opened)) move(target);
    }, SETTLED_MS);
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
    focused() {
      if (pressedSince(opened)) settle();
    },
  };
}
