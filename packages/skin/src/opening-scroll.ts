/** Detail-like routes always begin at their top; ordinary routes retain their own scroll policy. */
export function opensAtTop(route: string): boolean {
  return route === 'title' || route === 'screen';
}

/** Whether a route opening puts focus on its first action (route-focus.ts): always on a TV, and in
 * a browser for a detail page (a keyboard reaches its Resume at once). Native touch leaves focus to
 * the viewer: a phone given focus drew the focus ring on a game page's Watch chip and its row
 * scrolled to that chip, past the first. */
export function opensWithFocus(route: string, tv: boolean, os: string): boolean {
  return tv || (os === 'web' && opensAtTop(route));
}

/** Keep native focus from pulling an opening detail page down during its entrance/focus settle. */
export function pinOpeningScroll(opened: number, now: number, viewerMoved: boolean, settleMs = 1400): boolean {
  return !viewerMoved && now - opened <= settleMs;
}

/** Keys that scroll a page (or move keyboard focus down it) in a browser. */
const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'Spacebar']);

/** Whether a browser event is the viewer moving the page: a wheel or trackpad, a touch, a press
 * (a scrollbar drag starts with one) or a scrolling key. The opening pin only corrects scrolls
 * nobody asked for (focus pulling Play toward the centre), never these. */
export function viewerScrollIntent(event: { type: string; key?: string }): boolean {
  switch (event.type) {
    case 'wheel': case 'touchstart': case 'touchmove': case 'pointerdown': case 'mousedown': return true;
    case 'keydown': return SCROLL_KEYS.has(event.key ?? '');
    default: return false;
  }
}

let lastViewerScroll = -Infinity;
let listening = false;

/** Whether the viewer has moved the page since `time` (web: wheel, trackpad, touch, scrollbar,
 * scrolling keys; never elsewhere, where a drag reports itself). Listens from its first call. */
export function viewerScrolledSince(time: number): boolean {
  if (!listening && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    listening = true;
    const note = (event: Event) => { if (viewerScrollIntent(event as Event & { key?: string })) lastViewerScroll = Date.now(); };
    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'mousedown', 'keydown']) {
      document.addEventListener(type, note, { capture: true, passive: true });
    }
  }
  return lastViewerScroll > time;
}
