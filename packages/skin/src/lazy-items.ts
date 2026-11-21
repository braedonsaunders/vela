// Pure arithmetic for lazily drawn rows and row items (render.tsx LazyRepeat).

export interface LazySample { count: number; at: number }

/** The items' pitch from the spacer's offset after the drawn items: its movement between two drawn
 * counts, or, along a row (whose items start its content), its offset over the drawn count. */
export function lazyPitch(previous: LazySample | null, shown: number, at: number, axis: 'x' | 'y'): number | undefined {
  if (previous && previous.count !== shown && at !== previous.at) return Math.max(1, (at - previous.at) / (shown - previous.count));
  if (axis === 'x' && !previous && at > 0 && shown > 0) return at / shown;
  return undefined;
}

/** The spacer's extent for the items not drawn yet (at least a point, so it can be measured). */
export function lazyExtent(remaining: number, pitch: number, guess: number): number {
  return Math.max(1, remaining * (pitch || guess));
}

/** Whether the spacer's window rectangle is within reach of the screen along the axis. */
export function lazyNear(axis: 'x' | 'y', rect: { x: number; y: number; height: number }, screen: { width: number; height: number }, reach: number): boolean {
  return axis === 'y'
    ? rect.y < screen.height * (1 + reach)
    : rect.x < screen.width * (1 + reach) && rect.y < screen.height * (1 + reach) && rect.y + rect.height > -screen.height * reach;
}
