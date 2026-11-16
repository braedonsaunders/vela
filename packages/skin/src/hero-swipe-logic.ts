/** A deliberate horizontal swipe advances one hero, wrapping in either direction. */
export function heroSwipe(dx: number, dy: number, index: number, count: number): number | null {
  if (count < 2 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return (index + (dx < 0 ? 1 : -1) + count) % count;
}
