import { openScopeFlags, pressTakesFocus, successor } from './escape-policy';
import { ScreenActive } from './screen-active';
// Escape on a document's menus (docs/skin-schema.md, `escape`): Escape anywhere on the page, or
// Back on a TV remote or Android (Menu on tvOS), clears the open flags of the innermost node that
// names them and returns focus to its `returnFocus` element, else to the press button that opened
// the flag. On TV an open scope takes focus when it opens and keeps it until it closes.
// Press buttons register here by element id, so focus can be moved to one by id (Escape's
// returnFocus, and a press's `focus`).
import { createContext, createElement, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Platform } from 'react-native';
import { useHost } from './host';
import { selectEnv } from './host-source';
import { holdBack } from './menu-key';
import { restoreRouteFocus, returnFocusTarget } from './route-focus-policy';
import { viewerPressedSince } from './route-focus';

/** A press button that can take focus: a DOM element on the web, a native view on TV. */
export interface Focusable {
  focus?(): void;
  requestTVFocus?(): void;
}

interface Scope {
  /** How many escape nodes enclose this one: the innermost open scope wins. */
  level: number;
  /** Registration order, which breaks ties between siblings: the later one is drawn over. */
  order: number;
  /** Clears the scope's open flags and returns focus; answers whether any flag was open. */
  escape(): boolean;
  isOpen(): boolean;
}

const scopes = new Set<Scope>();
const targets = new Map<string, { view: Focusable; reveal?: (view: Focusable, full: boolean) => void }>();
const openers = new Map<string, Focusable>();
/** Press buttons that are drawn now, by what they do (`action:arg`), and the one pressed last (the
 * opener of the route on top). A row that refreshes while a route is over it (Continue Watching
 * after playback) draws its cards anew; the opener is then found again by what it does. */
const mounted = new Map<Focusable, string>();
interface Pressed { target: Focusable; does: string }
let lastPressed: Pressed | null = null;
const Level = createContext(0);
let registered = 0;
let unlisten: (() => void) | undefined;

/** Move focus to the press button with this element id, or on the web to any focusable element
 * with that id (a widget's own field, such as vela-search); false when none is drawn. */
export function focusElement(id: string, reveal = false): boolean {
  const registered = targets.get(id);
  const target = registered?.view ?? domElement(id);
  if (!target) return false;
  focusOn(target);
  if (reveal) registered?.reveal?.(target, true);
  return true;
}

function domElement(id: string): Focusable | undefined {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
  const element = document.getElementById(id)
    ?? document.querySelector<HTMLElement>(`[data-testid=${JSON.stringify(id)}]`)
    ?? undefined;
  // A box that is not itself a control (a menu a press opens) gives focus to its first control.
  if (!element || element.hasAttribute('tabindex') || element.matches('a[href], button, input, select, textarea')) return element;
  return element.querySelector<HTMLElement>('[tabindex]:not([tabindex="-1"]), a[href], button, input, select, textarea') ?? element;
}

/** A ref callback that registers a press button under its element id while it is mounted. */
export function focusTarget(id: string | undefined, reveal?: (view: Focusable, full: boolean) => void) {
  return (target: Focusable | null) => {
    if (!id || !target) return;
    const registered = { view: target, reveal };
    targets.set(id, registered);
    return () => {
      if (targets.get(id) === registered) targets.delete(id);
    };
  };
}

/** A ref callback's registration of a drawn press button; the returned cleanup forgets it. */
export function trackButton(target: Focusable | null, does: string) {
  if (!target) return undefined;
  mounted.set(target, does);
  return () => {
    mounted.delete(target);
  };
}

/** Move focus to a drawn press button that does one of `does` (`action:arg`), trying them in order:
 * how a page hands focus to the shell's destination for itself (the guide's Back to the top bar).
 * False when none is drawn. */
export function focusPressDoing(does: readonly string[]): boolean {
  for (const wanted of does) {
    for (const [target, doing] of mounted) {
      if (doing !== wanted) continue;
      focusOn(target);
      return true;
    }
  }
  return false;
}

/** Remember the button pressed last: a route it opens returns focus to it when it closes. */
export function notePress(button: Focusable | null, does: string): void {
  lastPressed = button ? { target: button, does } : null;
  pressedAt = Date.now();
}

/** On the web a pressed button holds focus as Chromium leaves it, so the keyboard carries on from
 * it: PageDown and Space scroll the page it is on (escape-policy.ts, pressTakesFocus). */
export function focusPressed(button: Focusable | null): void {
  if (!button || Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (!pressTakesFocus(document.activeElement, document.body) || !(button as { isConnected?: boolean }).isConnected) return;
  (button as { focus?(options?: { preventScroll?: boolean }): void }).focus?.({ preventScroll: true });
}

/** How soon after its press a button that leaves is taken to have been redrawn by that press. */
const REDRAW_MS = 1000;
let pressedAt = 0;

/** On the web, the button just pressed leaving as its own press redraws it hands focus to the
 * button drawn in its place. A season tab is drawn anew as the chosen one: its element left, focus
 * fell to the body, Enter's next press had nothing to act on, and Firefox and Safari scrolled the
 * body, which does not scroll, so PageDown, Space and the arrows did nothing on the title page
 * (Safari does not focus a clicked link, so this follows the press, not the focus). */
export function leaveButton(target: Focusable): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  const pressed = lastPressed;
  if (pressed?.target !== target || Date.now() - pressedAt > REDRAW_MS) return;
  requestAnimationFrame(() => {
    const next = successor(pressed, mounted, document.activeElement, document.body);
    if (!next) return;
    if (lastPressed === pressed) lastPressed = { target: next, does: pressed.does };
    (next as { focus?(options?: { preventScroll?: boolean }): void }).focus?.({ preventScroll: true });
  });
}

/** When focus is asked back again after the first frame (ms after the route comes back). */
const RETURN_RETRY_MS = [150, 400];

/** On TV, a route that comes back to the top (Back from a title over home) puts focus back on the
 * button that left it, which is still drawn underneath; without this nothing on it shows focus. */
export function useReturnFocus(focused: boolean): void {
  const opener = useRef<Pressed | null>(null);
  useEffect(() => {
    if (!restoreRouteFocus(Platform.OS, Platform.isTV)) return;
    if (!focused) {
      opener.current = lastPressed;
      return;
    }
    const pressed = opener.current;
    opener.current = null;
    if (!pressed) return;
    // Asked on the next frame, and again while the route that closed is still leaving: on Android TV
    // a title page over a row page was still in the window when the first request landed, and its
    // removal took focus with it, so nothing was focused at all. A press of the viewer's ends it.
    const returned = Date.now();
    const apply = () => {
      if (viewerPressedSince(returned)) return;
      const target = returnFocusTarget(pressed, mounted);
      if (target) focusOn(target);
    };
    const frame = requestAnimationFrame(apply);
    const timers = Platform.isTV ? RETURN_RETRY_MS.map(ms => setTimeout(apply, ms)) : [];
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
    };
  }, [focused]);
}

/** Remember which button opened a flag, so Escape can return focus to it. */
export function noteOpener(action: string, flag: string, button: Focusable | null): void {
  if (!button || !flag) return;
  if (action === 'toggle' || action === 'open' || action === 'only') openers.set(flag, button);
}

/** Whether any of a scope's flags is open. */
export function scopeOpen(flags: string[], open: string[]): boolean {
  return flags.some(flag => open.includes(flag));
}

interface ScopeProps {
  flags: string[];
  returnFocus?: string;
  /** The scope's own view on TV (a focus guide): it takes focus when the scope opens. */
  guide?: { current: Focusable | null };
  children: ReactNode;
}

/** Wraps a node that names `escape` flags: registers its scope and counts it for its descendants. */
export function EscapeScope({ flags, returnFocus, guide, children }: ScopeProps) {
  const host = useHost();
  const active = useContext(ScreenActive);
  const level = useContext(Level) + 1;
  const latest = useRef({ host, flags, returnFocus, active });
  latest.current = { host, flags, returnFocus, active };
  const open = active && selectEnv(host.env, 'flags', `scope:${flags.join(',')}`, open => scopeOpen(flags, open));

  // Open: Back closes it, and on TV focus moves into it once it is drawn (the guide hands focus
  // to its first item), so a menu over the page is never skipped for what lies behind it.
  useEffect(() => {
    if (!open) return;
    if (Platform.isTV && guide) requestAnimationFrame(() => guide.current && focusOn(guide.current));
    if (Platform.OS === 'web') return;
    return holdBack(escapeInnermost);
  }, [open, guide]);

  useEffect(() => {
    const openFlags = () => openScopeFlags(latest.current.flags, latest.current.host.env.flags, latest.current.active);
    const scope: Scope = {
      level,
      order: ++registered,
      isOpen: () => openFlags().length > 0,
      escape() {
        const open = openFlags();
        if (!open.length) return false;
        const { host: current, returnFocus: id } = latest.current;
        for (const flag of open) current.setFlag(flag, false);
        const opener = openers.get(open[0]!);
        // Focus moves once the closed menu has left the tree.
        requestAnimationFrame(() => {
          if (!latest.current.active) return;
          if (id && focusElement(id)) return;
          if (opener) focusOn(opener);
        });
        return true;
      },
    };
    scopes.add(scope);
    listen();
    return () => {
      scopes.delete(scope);
      if (!scopes.size) stopListening();
    };
  }, [level]);

  return createElement(Level.Provider, { value: level }, children);
}

/**
 * An ephemeral popover participates in the same innermost Escape/Back stack as document flags.
 * Unlike EscapeScope it owns no view-state flag; dismissing it calls its close function and puts
 * focus back on the control that opened it.
 */
export function DismissScope({ open, dismiss, returnTarget, guide, children }: {
  open: boolean;
  dismiss(): void;
  returnTarget?: Focusable | null;
  guide?: RefObject<Focusable | null>;
  children: ReactNode;
}) {
  const level = useContext(Level) + 1;
  const latest = useRef({ open, dismiss, returnTarget });
  latest.current = { open, dismiss, returnTarget };

  useEffect(() => {
    if (!open) return;
    if (Platform.isTV && guide) requestAnimationFrame(() => guide.current && focusOn(guide.current));
    if (Platform.OS === 'web') return;
    return holdBack(escapeInnermost);
  }, [open, guide]);

  useEffect(() => {
    const scope: Scope = {
      level,
      order: ++registered,
      isOpen: () => latest.current.open,
      escape() {
        if (!latest.current.open) return false;
        const { dismiss, returnTarget } = latest.current;
        dismiss();
        requestAnimationFrame(() => returnTarget && focusOn(returnTarget));
        return true;
      },
    };
    scopes.add(scope);
    listen();
    return () => {
      scopes.delete(scope);
      if (!scopes.size) stopListening();
    };
  }, [level]);

  return createElement(Level.Provider, { value: level }, children);
}

/** Escape the innermost open scope; answers whether one was open. */
function escapeInnermost(): boolean {
  let innermost: Scope | undefined;
  for (const scope of scopes) {
    if (!scope.isOpen()) continue;
    const deeper = !innermost || scope.level > innermost.level;
    const later = !!innermost && scope.level === innermost.level && scope.order > innermost.order;
    if (deeper || later) innermost = scope;
  }
  return innermost ? innermost.escape() : false;
}

/** Escape on the web's keyboard; natively each open scope holds Back while it is open (EscapeScope). */
function listen(): void {
  if (unlisten || Platform.OS !== 'web' || typeof document === 'undefined') return;
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    if (escapeInnermost()) event.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  unlisten = () => document.removeEventListener('keydown', onKey);
}

function stopListening(): void {
  unlisten?.();
  unlisten = undefined;
}

function focusOn(target: Focusable): void {
  if (target.requestTVFocus) target.requestTVFocus();
  else target.focus?.();
}
