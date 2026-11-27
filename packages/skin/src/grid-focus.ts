// Android TV focus across a grid drawn a batch at a time (render.tsx GridTrack). Android finds the card
// below among the cards that exist. Below the last drawn row there is only the spacer holding the rest,
// so a Down press made before the next row is drawn left the grid. It went to the page's Show more, or
// the route's scroll jumped half a screen and took focus from the card. A slow box draws a batch in a
// second or more, and a held Down repeats twenty times a second, so a viewer moving down a long grid
// lost focus there.
//
// The activity (apps/vela/plugins/android-tv-keys.js) now keeps such a press on its card when the card
// is inside a grid still drawing (GRID_OPEN) and hands it here. The grid adds it to a target row in the
// focused card's column, draws until that row exists, and moves focus there (to the deepest drawn row
// in the meantime). The target goes at most `lead` rows past the drawn ones, so letting go of a held
// Down stops focus within a batch.

/** The native IDs of a grid's track on Android TV, while it has rows left to draw and once drawn. The
 * activity looks for them among the focused card's ancestors: it keeps a Down press that would leave
 * an open grid on its card, and brings a card focused before it was laid out on screen. */
export const GRID_OPEN = 'vela-grid-open';
export const GRID_DRAWN = 'vela-grid';

export interface GridTarget { row: number; column: number }

export interface GridShape {
  /** Cards per row. */
  columns: number;
  /** Cards drawn so far (the first ones). */
  shown: number;
  /** Cards the grid holds. */
  total: number;
}

export const rowOf = (index: number, columns: number) => Math.floor(index / Math.max(1, columns));

/** The card a Down press from `index` reaches: the same column in the next row, or the last card when
 * the last row is shorter; none from the last row. */
export function cardBelow(index: number, columns: number, total: number): number | undefined {
  if (index < 0 || index >= total) return undefined;
  if (rowOf(index, columns) >= rowOf(total - 1, columns)) return undefined;
  return Math.min(index + columns, total - 1);
}

/** Whether the card below `index` exists in the grid but is not drawn yet. */
export function belowUndrawn(index: number, shape: GridShape): boolean {
  const below = cardBelow(index, shape.columns, shape.total);
  return below !== undefined && below >= shape.shown;
}

/** A kept Down press: one row past the pending target, else past the focused card, in that card's
 * column; never past the last row, nor more than `lead` rows past the last drawn row (at least one
 * row past the focused card). */
export function pressDown(pending: GridTarget | null, focused: number, shape: GridShape, lead: number): GridTarget {
  const { columns, shown, total } = shape;
  const from = pending ?? { row: rowOf(focused, columns), column: focused % columns };
  const last = rowOf(total - 1, columns);
  const reach = Math.max(rowOf(Math.max(1, shown) - 1, columns) + lead, rowOf(focused, columns) + 1);
  return { row: Math.max(from.row, Math.min(from.row + 1, last, reach)), column: from.column };
}

/** The card a target names: its column in its row, or the last card when that row is shorter. */
export function targetIndex(target: GridTarget, columns: number, total: number): number {
  return Math.min(target.row * columns + target.column, total - 1);
}

/** Cards to draw for the target's row to exist. */
export function drawnFor(target: GridTarget, columns: number, total: number): number {
  return Math.min(total, (target.row + 1) * columns);
}

/** Where focus goes toward a target: the target once it is drawn, else the deepest drawn card in its
 * column below the focused one; none when nothing below is drawn yet. `done` when it is the target. */
export function stepToward(target: GridTarget, focused: number, columns: number, total: number, drawn: (index: number) => boolean): { index: number; done: boolean } | undefined {
  for (let row = target.row; row > rowOf(focused, columns); row--) {
    const index = targetIndex({ row, column: target.column }, columns, total);
    if (index > focused && drawn(index)) return { index, done: row === target.row };
  }
  return undefined;
}

/** A card's button, as the grid moves focus to it. */
export interface GridCard { requestTVFocus?(): void; focus?(): void }

/** A remote press as the activity reports it (`velaAndroidTVKey`). */
export interface GridKey {
  eventType?: string;
  eventKeyAction?: number;
  /** Kept on its card: the card's view tag. */
  gridHeld?: boolean;
  focusTag?: number;
}

export interface GridFocus {
  /** The grid's columns and drawn and total counts, as last drawn. */
  shape(shape: GridShape): void;
  /** A card's button drawn (`tag` is its view tag); returns its removal. */
  register(index: number, card: GridCard, tag: number | null): () => void;
  focused(index: number): void;
  blurred(index: number): void;
  /** A remote press; answers whether this grid took it. */
  key(event: GridKey): boolean;
  /** The pending target, if any (for drawing and tests). */
  readonly pending: GridTarget | null;
}

/** One grid's bookkeeping. `wanted` asks the grid to draw at least that many cards; `later` runs a
 * focus move after the current draw (requestAnimationFrame). */
export function gridFocus(options: { lead: (columns: number) => number; wanted(count: number): void; later(run: () => void): void }): GridFocus {
  let shape: GridShape = { columns: 1, shown: 0, total: 0 };
  const cards = new Map<number, GridCard>();
  const tags = new Map<number, number>();
  let pending: GridTarget | null = null;
  let focusedIndex: number | undefined;
  /** The card the grid is moving focus to: the focused card's blur on the way is not the viewer leaving. */
  let moving: number | undefined;
  let scheduled = false;
  const set = (next: GridTarget | null) => {
    pending = next;
    options.wanted(next ? drawnFor(next, shape.columns, shape.total) : 0);
  };
  const apply = () => {
    scheduled = false;
    if (!pending || focusedIndex === undefined) return;
    const step = stepToward(pending, focusedIndex, shape.columns, shape.total, index => index < shape.shown && cards.has(index));
    if (!step) return;
    const card = cards.get(step.index)!;
    if (step.done) set(null);
    moving = step.index;
    if (card.requestTVFocus) card.requestTVFocus();
    else card.focus?.();
  };
  const schedule = () => {
    if (scheduled || !pending) return;
    scheduled = true;
    options.later(apply);
  };
  return {
    shape(next) {
      shape = next;
      // A grid that lost cards (a new sort or filter) starts over.
      if (pending && pending.row > rowOf(shape.total - 1, shape.columns)) set(null);
      schedule();
    },
    register(index, card, tag) {
      cards.set(index, card);
      if (tag != null) tags.set(tag, index);
      schedule();
      return () => {
        if (cards.get(index) === card) cards.delete(index);
        if (tag != null && tags.get(tag) === index) tags.delete(tag);
      };
    },
    focused(index) {
      focusedIndex = index;
      moving = undefined;
      if (pending && rowOf(index, shape.columns) >= pending.row) set(null);
      schedule();
    },
    blurred(index) {
      if (focusedIndex === index) focusedIndex = undefined;
      // Focus leaving the grid some other way (a menu, Back) drops the target; focus moving on to
      // another of its cards (Android's own move to a row just drawn) comes as that card's focus.
      if (!pending || moving !== undefined) return;
      options.later(() => { if (focusedIndex === undefined && moving === undefined && pending) set(null); });
    },
    key(event) {
      if (event.eventKeyAction !== 0) return false;
      if (event.eventType === 'down') {
        const index = event.gridHeld && event.focusTag !== undefined ? tags.get(event.focusTag) : undefined;
        // A press Android moved itself (the row below was drawn) leaves the target as it is.
        if (index === undefined) return false;
        // The press's card is where focus was as it arrived: focus events come after it. A press made
        // as the grid moved focus on counts from the card focus is going to.
        focusedIndex = index;
        const from = !pending && moving !== undefined && moving > index ? moving : index;
        set(pressDown(pending, from, shape, options.lead(shape.columns)));
        schedule();
        return true;
      }
      // Any other press (up, a side, select) is the viewer going elsewhere: the target is dropped.
      if (pending) set(null);
      return false;
    },
    get pending() { return pending; },
  };
}
