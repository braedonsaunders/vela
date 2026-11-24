// The marquee's motion, pure (blocks/marquee.tsx): how far the run moves in a frame, and whether it
// needs to move at all.

/** The run moves `offset` on by `speed` points a second for `ms`, wrapping at one copy's width so the
 * second copy takes over seamlessly. A changed width (a score got wider) keeps the offset where it
 * is, folded into the new width: the run never jumps back to the start. */
export function marqueeStep(offset: number, ms: number, speed: number, width: number): number {
  'worklet';
  if (!(width > 0) || !Number.isFinite(offset)) return 0;
  const next = offset + Math.max(0, ms) * speed / 1000;
  return next >= width ? next % width : next;
}

/** The run scrolls only when one copy of it is wider than the band shows. */
export function marqueeScrolls(contentWidth: number, viewportWidth: number): boolean {
  return contentWidth > 0 && viewportWidth > 0 && contentWidth > viewportWidth;
}
