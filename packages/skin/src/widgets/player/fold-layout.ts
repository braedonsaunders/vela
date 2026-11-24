// Where the watch route draws the picture and its controls. Flat (and on every device that does
// not fold) the picture fills the stage and the controls keep to the safe area. A foldable stood
// partly open on a table (tabletop) puts the picture in the upper half, clear of the status bar,
// and the controls in the lower half, so neither sits in the fold. Held like a book, the picture
// spans both halves as it does fully open; the bottom bar's controls already keep to each side.
import type { Viewport } from '../../css';

export interface Edges { top: number; right: number; bottom: number; left: number }

export interface WatchFrames {
  /** The picture's frame within the stage (the full window), as offsets from its edges. */
  picture: Edges;
  /** The controls' frame within the stage. */
  chrome: Edges;
}

/** The least either half of a tabletop needs to be worth splitting (else the picture fills). */
export const TABLETOP_MIN_HALF = 180;

export function watchFrames(viewport: Viewport): WatchFrames {
  const { insets, sides, fold, height } = viewport;
  const left = sides?.left ?? insets.left, right = sides?.right ?? insets.right;
  const flat: WatchFrames = {
    picture: { top: 0, right: 0, bottom: 0, left: 0 },
    chrome: { top: insets.top, right, bottom: insets.bottom, left },
  };
  const d = fold?.posture === 'tabletop' ? fold.division : undefined;
  if (!d) return flat;
  const upper = d.y - insets.top;
  const lowerTop = d.y + d.height;
  const lower = height - insets.bottom - lowerTop;
  if (upper < TABLETOP_MIN_HALF || lower < TABLETOP_MIN_HALF) return flat;
  return {
    picture: { top: insets.top, right: 0, bottom: height - d.y, left: 0 },
    chrome: { top: lowerTop, right, bottom: insets.bottom, left },
  };
}
