import type { Viewport } from '../../css';

/** Android TV's IME already resizes the app window. Applying KeyboardAvoidingView's height
 * reduction as well can collapse the served TextInput and make the TV keyboard restart focus. */
export function keyboardAvoidanceEnabled(os: string, tv: boolean): boolean {
  return os !== 'web' && !(os === 'android' && tv);
}

/** Sizes of the signed-out flow in the usable area (the stage less any keyboard). Height reduces
 * decoration; only a small touch viewport changes structure (the landscape split). Foldables,
 * tablets, desktops and TVs keep the centred column. */
export function authLayout(viewport: Viewport, availableHeight = viewport.height, tv = false, touch = false) {
  const height = Math.max(0, availableHeight - viewport.insets.top - viewport.insets.bottom);
  const compact = !tv && touch && Math.min(viewport.width, viewport.height) < 600;
  const landscape = compact && viewport.width > viewport.height;
  const tight = !tv && height < 700;
  const short = !tv && height < 420;
  // The smallest keyboard area (a landscape phone typing): fields and the action, nothing else.
  const minimal = compact && height < 300;
  const gap = tv ? 24 : short || minimal ? 8 : tight ? 12 : 16;
  const sides = (viewport.sides?.left ?? 0) + (viewport.sides?.right ?? 0) + viewport.insets.left + viewport.insets.right;
  const room = landscape ? (viewport.width - sides) * 0.58 : viewport.width - sides;
  const margin = compact ? 24 : 32;
  return {
    compact,
    landscape,
    tight,
    minimal,
    gap,
    /** The content column's width: a thumb's reach on phones, a reading measure elsewhere. */
    contentWidth: Math.max(0, Math.min(tv ? 600 : 440, room - margin * 2)),
    headingSize: tv ? 56 : short ? 28 : tight ? 34 : compact ? 38 : 44,
    /** Primary actions: sized for thumbs, smaller only where height is scarce. */
    controlHeight: tv ? 64 : short ? 46 : tight ? 52 : 56,
    inlineAlternatives: short && !compact && viewport.width >= 520,
  };
}

export type AuthLayout = ReturnType<typeof authLayout>;

/** Instrument Serif's ascender and descender (0.99 + 0.31 em, hhea): a display line box
 * shorter than this clips the glyphs' tops on iOS, whatever the padding around it. */
export const DISPLAY_LINE_HEIGHT = 1.3;

export interface HorizonInput {
  viewport: Viewport;
  /** The stage's laid-out height (it can differ from the viewport's on web). */
  height: number;
  /** The keyboard's height over the stage, or 0. */
  keyboard: number;
  /** The current step's natural height, once measured (0 before). */
  content: number;
  tv?: boolean;
  touch?: boolean;
  /** A step past the first: the horizon rises and the sail shrinks, giving the step the water. */
  deep?: boolean;
}

export interface HorizonPlan {
  /** The horizon line's distance from the stage's top. */
  horizon: number;
  /** The sail's height standing on the horizon; 0 hides it (the keyboard took the sky). */
  sail: number;
  /** Where the step's content begins and the room it has before the bottom edge or keyboard. */
  contentTop: number;
  contentBottom: number;
  /** Landscape phones and book-held foldables: the scene on the left, the step on the right. */
  split: boolean;
  /** Split: the scene's pane width (the sail is centred in it); the step starts after it. */
  pane: number;
}

const SAIL_MAX = { phone: 172, large: 220, tv: 240 };
const SAIL_MIN = 34;

/** Where the horizon sits: as low as the step's content allows (a short step leaves a tall sky
 * and a large sail; a long one lifts the horizon and the sail shrinks), never below the hero line
 * (half the usable height on the first step, about a quarter deeper in the flow), never above the
 * top band. A keyboard lifts it out of the way. */
export function horizonPlan({ viewport, height, keyboard, content, tv = false, touch = false, deep = false }: HorizonInput): HorizonPlan {
  const { insets } = viewport;
  const top = insets.top;
  const bottom = keyboard > 0 ? keyboard + 12 : Math.max(insets.bottom, tv ? 48 : 20);
  const usable = Math.max(0, height - bottom);
  const compact = !tv && touch && Math.min(viewport.width, viewport.height) < 600;
  const fold = viewport.fold;
  const maxSail = tv ? SAIL_MAX.tv : compact ? SAIL_MAX.phone : SAIL_MAX.large;

  // Book-held foldable: the fold is the natural divide between scene and step.
  if (fold?.posture === 'book' && fold.division) {
    const pane = fold.division.x;
    const horizon = Math.round(top + (usable - top) * 0.62);
    return { horizon, sail: sailFor(horizon - top, maxSail), contentTop: top, contentBottom: bottom, split: true, pane };
  }
  if (compact && viewport.width > viewport.height) {
    const sideLeft = (viewport.sides?.left ?? 0) + insets.left;
    const pane = Math.round(sideLeft + (viewport.width - sideLeft) * 0.42);
    // Typing in landscape takes nearly all the height: the scene keeps its place behind the step.
    const horizon = Math.round(top + (height - top - Math.max(insets.bottom, 12)) * 0.62);
    return { horizon, sail: sailFor(horizon - top, 132), contentTop: top, contentBottom: bottom, split: true, pane };
  }
  // Table-top foldable: the sea is the lower half, the horizon on the fold.
  if (fold?.posture === 'tabletop' && fold.division) {
    const horizon = Math.round(fold.division.y);
    return { horizon, sail: sailFor(horizon - top, maxSail), contentTop: Math.round(fold.division.y + fold.division.height), contentBottom: bottom, split: false, pane: 0 };
  }
  const hero = top + (usable - top) * (deep ? 0.27 : 0.5);
  const highest = top + (keyboard > 0 ? 8 : 64);
  const gapBelow = (sky: number) => Math.round(Math.min(48, Math.max(20, sailFor(sky, maxSail) * 0.22)));
  // Content sits below the horizon with a gap that scales with the sail: solve for the lowest
  // horizon whose content still fits (the gap grows with the sky, so try the hero line first).
  let horizon = hero;
  if (content > 0) {
    const fit = (h: number) => usable - content - gapBelow(h - top);
    // The gap shrinks as the horizon rises, so a few rounds settle on the lowest horizon that fits.
    for (let round = 0; round < 4; round++) horizon = Math.min(hero, fit(Math.min(horizon, fit(horizon))));
  }
  horizon = Math.floor(Math.max(highest, horizon));
  const sail = keyboard > 0 && horizon - top < 80 ? 0 : sailFor(horizon - top, maxSail);
  return { horizon, sail, contentTop: horizon + gapBelow(horizon - top), contentBottom: bottom, split: false, pane: 0 };
}

/** The sail fills about two thirds of the sky above it, within the device's range. */
function sailFor(sky: number, max: number): number {
  const size = Math.round(sky * 0.62);
  return size < SAIL_MIN ? 0 : Math.min(max, size);
}
