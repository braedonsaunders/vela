// When a paged list reads on (paging.tsx): pure, so it is tested without a renderer.

export interface ScrollMetrics { offset: number; viewport: number; content: number }

/** How far ahead of the end a list reads on: about a screen. */
export const READ_AHEAD = 1;

/** The scroller's end is within `screens` viewports of what is in view (a page that does not fill the viewport is at its end). */
export function nearEnd(metrics: ScrollMetrics, screens = READ_AHEAD): boolean {
  if (metrics.viewport <= 0) return false;
  return metrics.offset + metrics.viewport * (1 + screens) >= metrics.content;
}
