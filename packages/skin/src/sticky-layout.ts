export interface StickyLayout { y: number; height: number }

/** Pin at the top until the next header needs the same space. */
export function stickyLimit(layout: StickyLayout, nextY?: number): number {
  return nextY === undefined ? Infinity : Math.max(0, nextY - layout.y - layout.height);
}

export function stickyOffset(scroll: number, layout: StickyLayout, nextY?: number): number {
  return Math.min(stickyLimit(layout, nextY), Math.max(0, scroll - layout.y));
}
