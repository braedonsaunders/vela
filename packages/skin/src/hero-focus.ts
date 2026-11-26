// On TV the hero on show keeps its buttons as the carousel rotates, but not every title has the same
// ones: a title with nothing to play shows only More info, one with nothing to resume has no Restart,
// and Resume and Play are drawn differently. When the focused button leaves that way, the focus
// engine moves focus elsewhere (Android TV: to the pager, where Select picks the first title), so
// focus goes back to the hero: on a viewer-driven page turn, to the edge matching the turn
// direction (Play/Resume on a left turn, More info on a right turn); otherwise to the hero's
// primary button (Play or Resume, else More info).

/** How a hero button ranks for non-directional focus hand-over: lower first. */
export function heroButtonRank(action: string, arg: string): number {
  // Restart is a play from an explicit start (`title|source|audio|0`); Play and Resume carry none.
  if (action === 'play') return arg.split('|').length >= 4 ? 2 : 0;
  return 1;
}

/** Visual left-to-right order of hero buttons: Play/Resume left, Restart middle, More info right. */
function heroVisualOrder(rank: number): number {
  if (rank === 0) return 0;
  if (rank === 2) return 1;
  if (rank === 1) return 2;
  return rank;
}

/** A viewer-driven turn's direction stays fresh long enough for its redraw to commit, never long
 * enough to leak into a later automatic rotation. */
const HERO_TURN_WINDOW_MS = 2000;

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
  /** Note a viewer-driven hero page turn (`-1` left, `1` right) so focus lost by the outgoing
   * title lands on the matching edge of the incoming one. */
  turn(direction: -1 | 1, now?: number): void;
  /** Once the redraw is done: the hero button to take the focus that was lost, if any. */
  take(x?: (target: T) => number | undefined, now?: number): T | undefined;
  /** Whether this is the outer hero action in the given horizontal direction: by where the buttons
   * stand on screen when `x` gives each one's left edge, else by rank. */
  atEdge(target: T, direction: -1 | 1, x?: (target: T) => number | undefined): boolean;
}

export function heroFocusCarry<T>(): HeroFocusCarry<T> {
  const buttons = new Map<T, number>();
  let focusedTarget: T | undefined;
  let focusedAt = 0;
  let lost: T | undefined;
  let pendingTurn: { direction: -1 | 1; at: number } | undefined;
  return {
    add(target, rank) {
      buttons.set(target, rank);
      if (lost === undefined || target !== lost) return;
      focusedTarget = target;
      lost = undefined;
    },
    focused(target, on, now = Date.now()) {
      if (on) {
        focusedTarget = target;
        focusedAt = now;
        if (lost === undefined) pendingTurn = undefined;
      } else if (focusedTarget === target) {
        focusedTarget = undefined;
      }
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
    turn(direction, now = Date.now()) {
      pendingTurn = { direction, at: now };
    },
    take(x, now = Date.now()) {
      const turn = pendingTurn;
      pendingTurn = undefined;
      if (lost === undefined) return undefined;
      lost = undefined;
      const direction = turn && now - turn.at <= HERO_TURN_WINDOW_MS ? turn.direction : undefined;
      let best: T | undefined;
      let bestScore = direction === 1 ? -Infinity : Infinity;
      for (const [target, rank] of buttons) {
        if (direction !== undefined) {
          const pos = x?.(target);
          const score = pos !== undefined ? pos : heroVisualOrder(rank);
          if (direction < 0 ? score < bestScore : score > bestScore) { best = target; bestScore = score; }
        } else if (rank < bestScore) {
          best = target;
          bestScore = rank;
        }
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

/** Android TV: tracks hardware left/right key-down and key-up focus snapshots (emitted from
 * MainActivity.dispatchKeyEvent before native focus moves) alongside hero button focus reports, so
 * an inward press that moved focus between buttons never turns the page regardless of how long the
 * key was held, and a deliberate edge press turns immediately without waiting out a settle timer. */
export interface HeroEdgeKeyGate {
  /** A hardware left/right key event arrived (`down`: ACTION_DOWN, false: ACTION_UP). */
  key(direction: -1 | 1, down: boolean, focus: string | undefined, now?: number): void;
  /** Native focus moved onto a hero button. */
  focused(now?: number): void;
  /** Whether the press finishing at `pressedAt` in `direction` stayed on the same button throughout
   * (never moved focus). Falls back to `settledMs` when no key-down/up pair was observed. */
  stayed(direction: -1 | 1, pressedAt: number, focusedSince: number, settledMs: number): boolean;
}

const KEY_HOLD_STALE_MS = 1500;
const KEY_MATCH_WINDOW_MS = 250;
const LATE_FOCUS_WINDOW_MS = 200;

export function heroEdgeKeyGate(): HeroEdgeKeyGate {
  let active: { direction: -1 | 1; focus: string | undefined; at: number; moved: boolean } | undefined;
  let last: { direction: -1 | 1; stayed: boolean; at: number } | undefined;
  return {
    key(direction, down, focus, now = Date.now()) {
      if (down) {
        // Ignore auto-repeat key-downs while a press in the same direction is already active, so
        // the original pre-move focus and `moved` flag are preserved until key-up.
        if (!active || active.direction !== direction || now - active.at > KEY_HOLD_STALE_MS) {
          active = { direction, focus, at: now, moved: false };
        }
        return;
      }
      if (active && active.direction === direction) {
        const sameFocus = active.focus !== 'none' && active.focus === focus;
        last = { direction, stayed: !active.moved && sameFocus, at: now };
        active = undefined;
        return;
      }
      active = undefined;
      last = undefined;
    },
    focused(now = Date.now()) {
      if (active) {
        active.moved = true;
      } else if (last && now - last.at <= LATE_FOCUS_WINDOW_MS) {
        last.stayed = false;
      }
    },
    stayed(direction, pressedAt, focusedSince, settledMs) {
      if (last && last.direction === direction && Math.abs(pressedAt - last.at) <= KEY_MATCH_WINDOW_MS) {
        return last.stayed;
      }
      return pressedAt - focusedSince >= settledMs;
    },
  };
}
