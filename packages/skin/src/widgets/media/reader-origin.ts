// The reader opens out of the book's cover and closes back into it: where the cover was when Read
// was pressed, where the book stands while it opens, and the moves between the two. Every move is
// one scale, so a cover never stretches.

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

/** A book cover's shape: two wide by three tall (the media cover's own shape). */
export const COVER_ASPECT = 2 / 3;

/** Where the book stands while it opens: centred, as large as the window comfortably allows, in
 * the cover's shape. */
export function bookRect(viewport: { width: number; height: number }): Rect {
  const vw = Math.max(1, viewport.width), vh = Math.max(1, viewport.height);
  const height = Math.round(Math.min(vh * 0.8, vw * (vw < 640 ? 0.72 : 0.6) / COVER_ASPECT));
  const width = Math.round(height * COVER_ASPECT);
  return { x: Math.round((vw - width) / 2), y: Math.round((vh - height) / 2), width, height };
}

/** The move (about the book's centre) that puts the standing book over the cover it came from:
 * centred on it, as tall as it. */
export function bookFrom(origin: Rect, book: Rect): Zoom {
  return {
    x: Math.round(origin.x + origin.width / 2 - (book.x + book.width / 2)),
    y: Math.round(origin.y + origin.height / 2 - (book.y + book.height / 2)),
    scale: Number(Math.min(4, Math.max(0.02, origin.height / Math.max(1, book.height))).toFixed(4)),
  };
}

/** The page under the cover filling the window: a plain sheet, so its two scales never show. */
export function pageFill(book: Rect, viewport: { width: number; height: number }): { x: number; y: number; scaleX: number; scaleY: number } {
  return {
    x: Math.round(viewport.width / 2 - (book.x + book.width / 2)),
    y: Math.round(viewport.height / 2 - (book.y + book.height / 2)),
    scaleX: Number((Math.max(1, viewport.width) / Math.max(1, book.width)).toFixed(4)),
    scaleY: Number((Math.max(1, viewport.height) / Math.max(1, book.height)).toFixed(4)),
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
