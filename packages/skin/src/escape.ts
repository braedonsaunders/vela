// Escape on a document's menus (docs/skin-schema.md, `escape`): Escape anywhere on the page, or
// Back on a TV remote or Android (Menu on tvOS), clears the open flags of the innermost node that
// names them and returns focus to its `returnFocus` element, else to the press button that opened
// the flag. On TV an open scope takes focus when it opens and keeps it until it closes.
// Press buttons register here by element id, so focus can be moved to one by id (Escape's
// returnFocus, and a press's `focus`).
import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useHost } from './host';
import { holdBack } from './menu-key';

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
const targets = new Map<string, Focusable>();
const openers = new Map<string, Focusable>();
const Level = createContext(0);
let registered = 0;
let unlisten: (() => void) | undefined;

/** Move focus to the press button with this element id, or on the web to any focusable element
 * with that id (a widget's own field, such as vela-search); false when none is drawn. */
export function focusElement(id: string): boolean {
  const target = targets.get(id) ?? domElement(id);
  if (!target) return false;
  focusOn(target);
  return true;
}

function domElement(id: string): Focusable | undefined {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
  return document.getElementById(id) ?? undefined;
}

/** A ref callback that registers a press button under its element id while it is mounted. */
export function focusTarget(id: string | undefined) {
  return (target: Focusable | null) => {
    if (!id || !target) return;
    targets.set(id, target);
    return () => {
      if (targets.get(id) === target) targets.delete(id);
    };
  };
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
  const level = useContext(Level) + 1;
  const latest = useRef({ host, flags, returnFocus });
  latest.current = { host, flags, returnFocus };
  const open = scopeOpen(flags, host.env.flags);

  // Open: Back closes it, and on TV focus moves into it once it is drawn (the guide hands focus
  // to its first item), so a menu over the page is never skipped for what lies behind it.
  useEffect(() => {
    if (!open) return;
    if (Platform.isTV && guide) requestAnimationFrame(() => guide.current && focusOn(guide.current));
    if (Platform.OS === 'web') return;
    return holdBack(escapeInnermost);
  }, [open, guide]);

  useEffect(() => {
    const openFlags = () => latest.current.flags.filter(flag => latest.current.host.env.flags.includes(flag));
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
