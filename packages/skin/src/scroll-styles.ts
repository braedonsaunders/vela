// How a scrolling box's style splits between React Native's two views: the scroll view (the box's
// place on the page) and the content view inside it, which lays out the box's children.

/** The rows that lay out a scroll box's content. */
const CONTENT = new Set(['flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'alignContent', 'rowGap', 'columnGap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);
// A route is the page the window scrolls, so its minimum height is its content's, as in CSS:
// a `min-height: 100dvh` stage fills the window and centres within it.
const ROUTE_CONTENT = new Set([...CONTENT, 'minHeight']);
// A route that sets its own height (or a maximum) is a frame that size: Jelly Twin's title page is
// `height: 100%` with a region inside it that scrolls (`flex: 1; min-height: 0; overflow-y: auto`).
// The region is bounded only if the content view has that height too. Left on the scroll view
// alone, the content grew to the region's full length and nothing scrolled on the web, where the
// frame's `overflow-y: hidden` also stops the scroll view (#41). Both views keep the height, so
// the scroll view stays the size it was. A native scroll view scrolls whatever its overflow and
// lays its content out unbounded, so this is the web's alone.
const ROUTE_FRAME = ['height', 'maxHeight'] as const;

/** Splits a scrolling box's style into its content view's rows and its scroll view's. */
export function scrollStyles(style: Record<string, unknown>, route: boolean, web: boolean): [Record<string, unknown>, Record<string, unknown>] {
  const keys = route ? ROUTE_CONTENT : CONTENT;
  const content: Record<string, unknown> = {}, scroller: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) (keys.has(k) ? content : scroller)[k] = v;
  if (route && web) for (const k of ROUTE_FRAME) if (scroller[k] !== undefined) content[k] = scroller[k];
  return [content, scroller];
}
