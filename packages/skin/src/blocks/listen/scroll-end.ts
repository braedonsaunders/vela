// When a paged list reads on (paging.tsx): pure, so it is tested without a renderer.

export interface ScrollMetrics { offset: number; viewport: number; content: number }

/** How far ahead of the end a list reads on: about a screen. */
export const READ_AHEAD = 1;

/** The scroller's end is within `screens` viewports of what is in view (a page that does not fill the viewport is at its end). */
export function nearEnd(metrics: ScrollMetrics, screens = READ_AHEAD): boolean {
  if (metrics.viewport <= 0) return false;
  return metrics.offset + metrics.viewport * (1 + screens) >= metrics.content;
}

/**
 * Where the page in view was scrolled to, kept across a remount of its scroller: folding or
 * unfolding an iPhone Duo (or resizing a window) swaps the compact shell for the wide one, and the
 * page stays where the viewer left it. Only the page last scrolled is kept, so opening a page (a
 * new one, or one visited earlier) still starts at its top.
 */
export function createScrollMemory() {
  let kept = { page: '', offset: 0 };
  return {
    keep(page: string, offset: number) { kept = { page, offset: Number.isFinite(offset) ? Math.max(0, offset) : 0 }; },
    resume(page: string): number { return page && kept.page === page ? kept.offset : 0; },
  };
}

/** Whether a scroller resuming at `offset` can be put there yet: its viewport is measured and its
 * content reaches that far (a scroller clamps an offset beyond its content back to the top). */
export function canResume(offset: number, metrics: ScrollMetrics): boolean {
  return offset > 0 && metrics.viewport > 0 && metrics.content >= offset + metrics.viewport;
}
