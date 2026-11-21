// The reader opens out of the book's cover and closes back into it: where the cover was when Read
// was pressed, and the transform that puts the whole reader over it.

export interface Rect { x: number; y: number; width: number; height: number }
export interface Zoom { x: number; y: number; scale: number }

let pending: Rect | null = null;

/** Where the cover is, noted as Read is pressed. */
export function noteReaderOrigin(rect: Rect | null): void {
  pending = rect && rect.width > 0 && rect.height > 0 ? rect : null;
}

/** The cover the reader opens from, once: a reader opened any other way opens in place. */
export function takeReaderOrigin(): Rect | null {
  const rect = pending;
  pending = null;
  return rect;
}

/** The transform (about the viewport's centre) that shrinks a full-viewport reader onto the cover:
 * centred on it, as tall as it. One scale, so the page never stretches. */
export function zoomOnto(rect: Rect, viewport: { width: number; height: number }): Zoom {
  const scale = Math.min(1, Math.max(0.05, rect.height / Math.max(1, viewport.height)));
  return {
    x: Math.round(rect.x + rect.width / 2 - viewport.width / 2),
    y: Math.round(rect.y + rect.height / 2 - viewport.height / 2),
    scale: Number(scale.toFixed(4)),
  };
}

/** The largest cover in view on the web (the page's hero cover), or null. */
export function heroCoverRect(): Rect | null {
  if (typeof document === 'undefined') return null;
  let best: Rect | null = null;
  for (const element of Array.from(document.querySelectorAll('[data-testid="media-cover"]'))) {
    const r = element.getBoundingClientRect();
    if (r.width <= 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
    if (!best || r.width * r.height > best.width * best.height) best = { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  return best;
}
