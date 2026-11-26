// A route's first TV focus. A route that opens (a title page over home) puts focus on its primary
// action (Resume, Play), or its first piece of content (a season, an extra). Otherwise the focus
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
import { openingFocusPriority, takesOpeningFocus } from './route-focus-policy';
import { viewerScrolledSince } from './opening-scroll';

export interface RouteFocus {
  /** A press button of the route was drawn. */
  offer(target: Focusable, action: string, titlePrimary?: boolean): void;
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

/** The route's first focus for directional clients; native touch leaves focus to the viewer. */
export function useRouteFocus(enabled = Platform.isTV): RouteFocus | null {
  if (Platform.isTV && enabled) listen();
  return useMemo(() => (enabled ? firstFocus() : null), [enabled]);
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

/** A remote press, or on the web a wheel, touch, press or scrolling key: the viewer has taken over
 * the opening page, so its first focus is not asked for again (nor the page pulled back up). */
function viewerMovedSince(opened: number): boolean {
  return pressedSince(opened) || viewerScrolledSince(opened);
}

function move(target: Focusable, opened: number): void {
  if (Platform.OS === 'web') {
    // Browser focus normally scrolls the opening Resume/Play control toward the centre. Keep the
    // detail artwork and title at the top while still placing keyboard focus on the action; a
    // page the viewer has already moved (wheel, trackpad, touch, scrolling keys) is left where
    // they put it.
    (target as Focusable & { focus?(options?: FocusOptions): void }).focus?.({ preventScroll: true });
    requestAnimationFrame(() => {
      if (viewerScrolledSince(opened)) return;
      const active = document.activeElement;
      const route = active?.closest('[role="dialog"], main');
      if (!route) return;
      for (const element of Array.from(route.querySelectorAll<HTMLElement>('*'))) {
        if (element.scrollTop) element.scrollTop = 0;
      }
    });
  } else if (target.requestTVFocus) target.requestTVFocus();
  else target.focus?.();
}

function firstFocus(): RouteFocus {
  const opened = Date.now();
  const deadline = opened + OPENING_MS;
  let settled = false;
  let priority = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const open = () => !settled && Date.now() < deadline;
  const settle = () => {
    settled = true;
    clearTimeout(fallback);
    clearTimeout(retry);
  };
  const focus = (target: Focusable, rank: number) => {
    if (!open() || !takesOpeningFocus(rank, priority, viewerMovedSince(opened))) return;
    priority = rank;
    clearTimeout(retry);
    move(target, opened);
    // A route that opens with a motion (the title card fades and rises in) cannot take focus while
    // it is still all but transparent: the engine refuses it and falls back to whatever it likes
    // (the card's close button). Asked again once the motion has settled, unless the viewer has
    // pressed something meanwhile.
    retry = setTimeout(() => {
      if (!viewerMovedSince(opened)) move(target, opened);
    }, SETTLED_MS);
  };
  // Measured once laid out; a control off the first screen is passed over.
  const tryFocus = (target: Focusable, rank: number, titlePrimary: boolean) => {
    requestAnimationFrame(() => {
      if (titlePrimary && Platform.isTV) focus(target, rank);
      else onFirstScreen(target, visible => { if (visible) focus(target, rank); });
    });
  };
  return {
    offer(target, action, titlePrimary = false) {
      const rank = openingFocusPriority(action, titlePrimary);
      if (!open() || rank <= priority) return;
      if (action === 'play' || titlePrimary) {
        tryFocus(target, rank, titlePrimary);
        return;
      }
      if (fallback) return;
      fallback = setTimeout(() => tryFocus(target, rank, false), PRIMARY_WAIT_MS);
    },
    focused() {
      if (pressedSince(opened)) settle();
    },
  };
}
