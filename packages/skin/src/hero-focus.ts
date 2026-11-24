// On TV the hero on show keeps its buttons as the carousel rotates, but not every title has the same
// ones: a title with nothing to play shows only More info. When the focused button leaves that way,
// the focus engine moves focus elsewhere (Android TV: to the pager, where Select picks the first
// title), so the hero button arriving in its place takes the focus back.

/** How soon after a focused hero button left one arriving takes its focus (the same redraw). */
export const HERO_FOCUS_CARRY_MS = 1000;

export interface HeroFocusCarry {
  /** A hero button left the screen; `focused` when focus was on it. */
  left(focused: boolean, now: number): void;
  /** A hero button arrived: whether it takes the focus the last one left with. */
  arrives(now: number): boolean;
}

export function heroFocusCarry(windowMs = HERO_FOCUS_CARRY_MS): HeroFocusCarry {
  let lostAt: number | undefined;
  return {
    left(focused, now) {
      if (focused) lostAt = now;
    },
    arrives(now) {
      if (lostAt === undefined || now - lostAt > windowMs) return false;
      lostAt = undefined;
      return true;
    },
  };
}

/** The app's one carry: there is one focus, and one hero on show. */
export const heroFocus = heroFocusCarry();
