export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }

export interface PopoverPlacement extends Point {
  horizontal: 'left' | 'right';
  vertical: 'above' | 'below';
}

const DEFAULT_MARGIN = 12;
const DEFAULT_GAP = 8;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Place a pointer menu after the pointer, flipping before it near the right or bottom edge. */
export function placeAtPoint(point: Point, menu: Size, viewport: Size, margin = DEFAULT_MARGIN, gap = 2): PopoverPlacement {
  const right = point.x + gap + menu.width > viewport.width - margin;
  const above = point.y + gap + menu.height > viewport.height - margin;
  const wantedX = right ? point.x - menu.width - gap : point.x + gap;
  const wantedY = above ? point.y - menu.height - gap : point.y + gap;
  return {
    x: clamp(wantedX, margin, viewport.width - margin - menu.width),
    y: clamp(wantedY, margin, viewport.height - margin - menu.height),
    horizontal: right ? 'left' : 'right',
    vertical: above ? 'above' : 'below',
  };
}

/** Anchor a touch/TV menu to the card's leading edge, flipping above and inward at edges. */
export function placeAtRect(anchor: Rect, menu: Size, viewport: Size, margin = DEFAULT_MARGIN, gap = DEFAULT_GAP): PopoverPlacement {
  const above = anchor.bottom + gap + menu.height > viewport.height - margin
    && anchor.top - gap - menu.height >= margin;
  const left = anchor.left + menu.width > viewport.width - margin;
  const wantedX = left ? anchor.right - menu.width : anchor.left;
  const wantedY = above ? anchor.top - gap - menu.height : anchor.bottom + gap;
  return {
    x: clamp(wantedX, margin, viewport.width - margin - menu.width),
    y: clamp(wantedY, margin, viewport.height - margin - menu.height),
    horizontal: left ? 'left' : 'right',
    vertical: above ? 'above' : 'below',
  };
}
