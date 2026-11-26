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
