// A foldable's posture, as the app lays out by it: platform-neutral, so an Android foldable
// (Jetpack WindowManager's FoldingFeature) can report the same shape. Pure, so it is tested
// without a device.

/** A rectangle in the window's points, from its top left (as safe-area insets are). */
export interface FoldRect { x: number; y: number; width: number; height: number }

/**
 * `flat`: one surface (folded shut, fully open, or a device that does not fold). `book`: partly
 * open with the fold upright, held like a book. `tabletop`: partly open with the fold across,
 * the lower half resting like a laptop's keyboard.
 */
export type FoldPosture = 'flat' | 'book' | 'tabletop';

export interface FoldState {
  posture: FoldPosture;
  /** The hinge angle in degrees (180 fully open), where the platform reports it. */
  angle?: number;
  /** Where the window divides while the device is partly open, including the margins interactive
   * content keeps clear of; absent when flat. */
  division?: FoldRect;
}

export const FLAT: FoldState = Object.freeze({ posture: 'flat' }) as FoldState;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** What the native side reports, checked: anything malformed is flat, and a division always comes
 * with the posture its shape implies (upright: book; across: tabletop). */
export function foldState(value: unknown): FoldState {
  if (!value || typeof value !== 'object') return FLAT;
  const raw = value as { posture?: unknown; angle?: unknown; division?: Partial<Record<keyof FoldRect, unknown>> };
  const angle = finite(raw.angle) ? { angle: Math.max(0, Math.min(360, raw.angle)) } : {};
  const d = raw.division;
  if (raw.posture === 'flat' || !d || !finite(d.x) || !finite(d.y) || !finite(d.width) || !finite(d.height) || d.width <= 0 || d.height <= 0) {
    return Object.keys(angle).length ? { posture: 'flat', ...angle } : FLAT;
  }
  const division = { x: d.x, y: d.y, width: d.width, height: d.height };
  return { posture: division.height > division.width ? 'book' : 'tabletop', ...angle, division };
}

/** Whether two states lay out the same (the app re-lays out only when they do not). */
export function sameFold(a: FoldState, b: FoldState): boolean {
  if (a.posture !== b.posture || a.angle !== b.angle) return false;
  const p = a.division, q = b.division;
  if (!p || !q) return p === q;
  return p.x === q.x && p.y === q.y && p.width === q.width && p.height === q.height;
}
