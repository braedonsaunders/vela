// On TV the hero on show keeps its buttons as the carousel rotates, but not every title has the same
// ones: a title with nothing to play shows only More info, one with nothing to resume has no Restart,
// and Resume and Play are drawn differently. When the focused button leaves that way, the focus
// engine moves focus elsewhere (Android TV: to the pager, where Select picks the first title), so
// focus goes back to the hero's primary button: Play or Resume, else More info.

/** How a hero button ranks for the focus its hero lost: lower first. */
export function heroButtonRank(action: string, arg: string): number {
  // Restart is a play from an explicit start (`title|source|audio|0`); Play and Resume carry none.
  if (action === 'play') return arg.split('|').length >= 4 ? 2 : 0;
  return 1;
}

export interface HeroFocusCarry<T> {
  /** A hero button is on screen (again: a button only redrawn is no loss). */
  add(target: T, rank: number): void;
  /** Focus came to (`on`) or left a hero button (`now`: when, in milliseconds). */
  focused(target: T, on: boolean, now?: number): void;
  /** The hero button holding focus, and since when (milliseconds). */
  current(): { target: T; since: number } | undefined;
  /** The hero's buttons on screen. */
  targets(): T[];
  /** A hero button left. True when focus was on it and must be handed on once the redraw is done. */
  remove(target: T): boolean;
  /** Once the redraw is done: the hero button to take the focus that was lost, if any. */
  take(): T | undefined;
  /** Whether this is the outer hero action in the given horizontal direction: by where the buttons
   * stand on screen when `x` gives each one's left edge, else by rank. */
  atEdge(target: T, direction: -1 | 1, x?: (target: T) => number | undefined): boolean;
}

export function heroFocusCarry<T>(): HeroFocusCarry<T> {
  const buttons = new Map<T, number>();
  let focusedTarget: T | undefined;
  let focusedAt = 0;
  let lost: T | undefined;
  return {
    add(target, rank) {
      buttons.set(target, rank);
      if (lost === undefined || target !== lost) return;
      focusedTarget = target;
      lost = undefined;
    },
    focused(target, on, now = Date.now()) {
      if (on) { focusedTarget = target; focusedAt = now; }
      else if (focusedTarget === target) focusedTarget = undefined;
    },
    current() {
      return focusedTarget === undefined ? undefined : { target: focusedTarget, since: focusedAt };
    },
    targets() {
      return [...buttons.keys()];
    },
    remove(target) {
      buttons.delete(target);
      if (focusedTarget === undefined || target !== focusedTarget) return false;
      focusedTarget = undefined;
      lost = target;
      return true;
    },
    take() {
      if (lost === undefined) return undefined;
      lost = undefined;
      let best: T | undefined;
      let bestRank = Infinity;
      for (const [target, rank] of buttons) {
        if (rank < bestRank) { best = target; bestRank = rank; }
      }
      return best;
    },
    atEdge(target, direction, x) {
      const at = x?.(target);
      if (at !== undefined) {
        // Rank is the order focus is handed on in (Play, More info, Restart), not the order the
        // buttons stand in: Restart stands between Play and More info.
        return [...buttons.keys()].every(other => {
          const there = other === target ? undefined : x!(other);
          return there === undefined || (direction < 0 ? there > at : there < at);
        });
      }
      const ordered = [...buttons].sort((a, b) => a[1] - b[1]);
      return (direction < 0 ? ordered[0]?.[0] : ordered.at(-1)?.[0]) === target;
    },
  };
}
