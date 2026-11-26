// How much a window can hold, from the space it lays out in (points or px, after the side safe
// areas), never from the device: an iPad, an unfolded iPhone Duo and a desktop window of the same
// size get the same layout, and folding or rotating re-lays the page out in place.

/** From this width a landscape window holds two panes. An unfolded iPhone Duo lays out in about
 * 867 pt beside its Dynamic Island; an upright 11-inch iPad (820–834 pt, taller than wide) stays
 * one pane. */
export const LANDSCAPE_TWO_PANES = 840;

/**
 * Whether a window has room for two panes side by side: from `wide` px at any shape, or from
 * LANDSCAPE_TWO_PANES when it is wider than tall (where a stacked page would push its second pane
 * below the fold).
 */
export function twoPanes(width: number, height: number, wide: number): boolean {
  if (!(width > 0)) return false;
  return width >= wide || (width >= Math.min(wide, LANDSCAPE_TWO_PANES) && width > height);
}

/** The music app's form: the wide shell (Your Library beside the page, the bar below) from 980 px,
 * or a landscape window of LANDSCAPE_TWO_PANES; the compact shell (chips and the floating mini
 * player) otherwise. A TV is decided by the platform, not here. */
export const wideMusic = (width: number, height: number): boolean => twoPanes(width, height, 980);

/** Now Playing draws the cover and transport beside Up Next from 900 px, or in a landscape window
 * of LANDSCAPE_TWO_PANES; else they stack. */
export const nowPlayingSideBySide = (width: number, height: number): boolean => twoPanes(width, height, 900);

/** A short handheld window can fit a compact transport and an independently scrolling list. */
export function nowPlayingCompactLandscape(width: number, height: number): boolean {
  return width >= 560 && height > 0 && height <= 500 && width > height;
}

/** The wide bar's volume slider needs a roomy window; narrower bars keep the mute button (a touch
 * device has its own volume buttons). */
export const barVolumeSlider = (width: number): boolean => width >= 1000;
