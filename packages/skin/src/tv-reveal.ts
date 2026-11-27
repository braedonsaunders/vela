// Android TV keeps the focused control clear of the shell's top bar. Its scroll view brings a
// newly focused control just inside its edge, and the shell's bar floats over that edge, so a
// control reached by moving up (the hero's Resume) can end under the bar. The route's scroll then
// moves it below the bar. tvOS's focus engine scrolls with margins of its own and is left alone.
import { createContext } from 'react';
import { Platform } from 'react-native';
import type { Focusable } from './escape';
import { revealOffset } from './tv-reveal-policy';

/** The height of the bar floating over the top of routes (the shell's navigation box). */
let topBar = 0;

export const revealing = Platform.isTV && Platform.OS === 'android';

/** The shell's navigation box measured itself; only a bar pinned over the route counts. */
export function noteTopBar(height: number, pinned: boolean): void {
  if (revealing && pinned) topBar = height;
}

/** Brings a focused control of the route below the bar; null off Android TV. */
export type Reveal = (target: Focusable, full?: boolean) => void;
export const RevealContext = createContext<Reveal | null>(null);

interface MeasurableView {
  measureLayout?(relativeTo: unknown, onSuccess: (x: number, y: number, width: number, height: number) => void, onFail?: () => void): void;
}

interface RouteScroll {
  scrollTo(options: { y: number; animated: boolean }): void;
  getInnerViewRef?(): unknown;
}

/** The route scroll's reveal: `scroll` is the route's scroll view, `offset` its vertical offset. */
export function revealer(scroll: { current: unknown }, offset: { current: number }, height: number): Reveal {
  return (target, full) => {
    const view = scroll.current as RouteScroll | null;
    const content = view?.getInnerViewRef?.();
    const measurable = target as MeasurableView;
    if (!topBar || !view || !content || !measurable.measureLayout) return;
    measurable.measureLayout(content, (_x, y, _width, targetHeight) => {
      // A programmatically restored result can already be focused without being scrolled into view.
      const next = revealOffset(y, targetHeight, offset.current, height, topBar, !!full);
      if (next !== undefined) view.scrollTo({ y: next, animated: !full });
    });
  };
}

interface HomeCardAnchor {
  row: string;
  card: string;
  target: Focusable;
  top?: number;
}

export interface HomeFocus {
  focus(row: string, card: string, target: Focusable): void;
  restore(rows: readonly { key: string; cards: readonly string[] }[]): () => void;
}

let focusedHomeCard: HomeCardAnchor | undefined;

/** A different control taking focus supersedes the Home card, including controls in the shell. */
export function leaveHomeCard(): void {
  focusedHomeCard = undefined;
}

/** Preserve the focused card's viewport position when Home inserts or moves shelves above it. */
export function homeFocus(scroll: { current: unknown }, offset: { current: number }): HomeFocus {
  let anchor: HomeCardAnchor | undefined;
  function measure(target: Focusable, read: (y: number) => void) {
    const inner = (scroll.current as RouteScroll | null)?.getInnerViewRef?.();
    if (inner) (target as MeasurableView).measureLayout?.(inner, (_x, y) => read(y));
  }
  return {
    focus(row, card, target) {
      const next = { row, card, target } as HomeCardAnchor;
      anchor = focusedHomeCard = next;
      measure(target, y => { next.top = y; });
    },
    restore(rows) {
      const current = anchor;
      if (!current || focusedHomeCard !== current || !rows.some(row => row.key === current.row && row.cards.includes(current.card))) return () => {};
      let active = true;
      let focusFrame = 0;
      const frame = requestAnimationFrame(() => measure(current.target, y => {
        if (!active || focusedHomeCard !== current) return;
        const top = current.top;
        current.top = y;
        if (top === undefined || Math.abs(top - y) < 1) return;
        const next = Math.max(0, offset.current + y - top);
        (scroll.current as RouteScroll | null)?.scrollTo({ y: next, animated: false });
        focusFrame = requestAnimationFrame(() => {
          if (focusedHomeCard === current) current.target.requestTVFocus?.();
        });
      }));
      return () => { active = false; cancelAnimationFrame(frame); if (focusFrame) cancelAnimationFrame(focusFrame); };
    },
  };
}
