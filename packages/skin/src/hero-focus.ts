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
  /** The currently mounted hero actions, left to right. */
  visualTargets(): T[];
  /** A hero button is on screen (again: a button only redrawn is no loss). */
  add(target: T, rank: number): void;
  /** Focus came to (`on`) or left a hero button (`now`: when, in milliseconds). */
  focused(target: T, on: boolean, now?: number): void;
  current(): { target: T; since: number } | undefined;
  targets(): T[];
  /** A hero button left. True when focus was on it and must be handed on once the redraw is done. */
  remove(target: T): boolean;
  /** Note a viewer-driven hero page turn (`-1` left, `1` right) so focus lost by the outgoing
   * title lands on the matching edge of the incoming one. */
  turn(direction: -1 | 1, now?: number): void;
  /** Once the redraw is done: the hero button to take the focus that was lost, if any. */
  take(x?: (target: T) => number | undefined, now?: number): T | undefined;
}

export function heroFocusCarry<T>(): HeroFocusCarry<T> {
  const buttons = new Map<T, number>();
  let focusedTarget: T | undefined;
  let focusedAt = 0;
  let lost: T | undefined;
  let pendingTurn: { direction: -1 | 1; at: number } | undefined;
  return {
    visualTargets() {
      return [...buttons].sort((a, b) => heroVisualOrder(a[1]) - heroVisualOrder(b[1])).map(([target]) => target);
    },
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
  };
}

export interface AndroidHeroKey {
  eventType?: string;
  eventKeyAction?: number;
  repeatCount?: number;
  heroTag?: number;
  withinHero?: boolean;
}

export function androidHeroKeyDirection(event: AndroidHeroKey): -1 | 1 | undefined {
  if (event.heroTag === undefined || event.eventKeyAction !== 0 || event.repeatCount !== 0) return;
  if (event.eventType === 'left') return -1;
  if (event.eventType === 'right') return 1;
}

export type HeroDirection = -1 | 1;
export interface HeroInput {
  direction: HeroDirection;
  swipe?: true;
}

/** A directional press pages only if focus cannot move to another hero action. */
function heroPageDirection(direction: HeroDirection | undefined, withinHero: boolean | undefined) {
  return withinHero === false ? direction : undefined;
}

/** Android asks the native focus engine which control the press would reach. */
export function androidHeroPageDirection(event: AndroidHeroKey) {
  return heroPageDirection(androidHeroKeyDirection(event), event.withinHero);
}

/** tvOS recognizes clicks on release and swipes as distinct gestures. */
export function appleHeroInput(event: { eventType?: string; eventKeyAction?: number }): HeroInput | undefined {
  if (event.eventType === 'swipeLeft') return { direction: 1, swipe: true };
  if (event.eventType === 'swipeRight') return { direction: -1, swipe: true };
  if (event.eventKeyAction !== 1) return;
  if (event.eventType === 'left') return { direction: -1 };
  if (event.eventType === 'right') return { direction: 1 };
}

export function heroHorizontalMove(focus: number, count: number, input: HeroInput) {
  if (focus < 0 || focus >= count) return { focus };
  const next = focus + input.direction;
  const turn = heroPageDirection(input.direction, !input.swipe && next >= 0 && next < count);
  return turn === undefined ? { focus: next } : { focus, turn };
}

/** Replay distinct inputs that arrived while a page turn was rendering against the new buttons. */
export function heroAfterTurn(count: number, edge: HeroDirection, inputs: readonly HeroInput[]) {
  let focus = edge < 0 ? 0 : count - 1;
  for (const [index, input] of inputs.entries()) {
    const move = heroHorizontalMove(focus, count, input);
    if (move.turn !== undefined) return { ...move, remaining: inputs.slice(index + 1) };
    focus = move.focus;
  }
  return { focus };
}
