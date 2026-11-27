import { describe, expect, test } from 'bun:test';
import { belowUndrawn, cardBelow, drawnFor, gridFocus, pressDown, stepToward, targetIndex, type GridCard } from '../src/grid-focus';
import { gridDrawn } from '../src/lazy-items';

// A library page of 100 titles, six across, 24 drawn (rows 0-3).
const shape = { columns: 6, shown: 24, total: 100 };

describe('the card below', () => {
  test('is the same column in the next row, the last card under a short last row, none from the last row', () => {
    expect(cardBelow(3, 6, 100)).toBe(9);
    expect(cardBelow(94, 6, 100)).toBe(99);
    expect(cardBelow(97, 6, 100)).toBeUndefined();
    expect(cardBelow(5, 6, 6)).toBeUndefined();
  });

  test('a Down press waits only where the card below exists but is not drawn', () => {
    expect(belowUndrawn(17, shape)).toBe(false);
    expect(belowUndrawn(18, shape)).toBe(true);
    expect(belowUndrawn(23, shape)).toBe(true);
    expect(belowUndrawn(23, { ...shape, shown: 100 })).toBe(false);
    expect(belowUndrawn(5, { columns: 6, shown: 6, total: 6 })).toBe(false);
  });
});

describe('kept Down presses', () => {
  test('add up to a target row in the focused card\'s column', () => {
    let target = pressDown(null, 20, shape, 4);
    expect(target).toEqual({ row: 4, column: 2 });
    target = pressDown(target, 20, shape, 4);
    expect(target).toEqual({ row: 5, column: 2 });
    expect(targetIndex(target, 6, 100)).toBe(32);
    expect(drawnFor(target, 6, 100)).toBe(36);
  });

  test('a held key\'s repeats stop `lead` rows past the drawn ones', () => {
    let target = null;
    for (let i = 0; i < 40; i++) target = pressDown(target, 20, shape, 4);
    expect(target).toEqual({ row: 7, column: 2 });
    // Once more rows are drawn, the same repeats reach further.
    expect(pressDown(target, 20, { ...shape, shown: 48 }, 4)).toEqual({ row: 8, column: 2 });
  });

  test('never past the last row, where a short row\'s target is its last card', () => {
    const small = { columns: 6, shown: 12, total: 15 };
    let target = pressDown(null, 11, small, 4);
    expect(target).toEqual({ row: 2, column: 5 });
    expect(targetIndex(target, 6, 15)).toBe(14);
    target = pressDown(target, 11, small, 4);
    expect(target).toEqual({ row: 2, column: 5 });
  });
});

describe('stepping toward the target', () => {
  const drawnTo = (shown: number) => (index: number) => index < shown;
  test('goes to the target once drawn, else to the deepest drawn card in its column, else waits', () => {
    const target = { row: 6, column: 2 };
    expect(stepToward(target, 20, 6, 100, drawnTo(24))).toBeUndefined();
    expect(stepToward(target, 20, 6, 100, drawnTo(36))).toEqual({ index: 32, done: false });
    expect(stepToward(target, 32, 6, 100, drawnTo(48))).toEqual({ index: 38, done: true });
  });
});

describe('a grid\'s bookkeeping', () => {
  function harness() {
    const queue: (() => void)[] = [];
    const focused: number[] = [];
    let wanted = 0;
    const grid = gridFocus({ lead: columns => Math.ceil(24 / columns), wanted: count => { wanted = count; }, later: run => { queue.push(run); } });
    const card = (index: number): GridCard => ({ requestTVFocus: () => { focused.push(index); } });
    const draw = (from: number, to: number) => { for (let i = from; i < to; i++) grid.register(i, card(i), 1000 + i); };
    const flush = () => { while (queue.length) queue.shift()!(); };
    return { grid, focused, draw, flush, wanted: () => wanted };
  }
  const down = (index: number) => ({ eventType: 'down', eventKeyAction: 0, gridHeld: true, focusTag: 1000 + index });

  test('a kept press asks for its row, and focus goes there once it is drawn', () => {
    const h = harness();
    h.grid.shape(shape);
    h.draw(0, 24);
    h.grid.focused(21);
    expect(h.grid.key(down(21))).toBe(true);
    expect(h.grid.key(down(21))).toBe(true);
    expect(h.grid.pending).toEqual({ row: 5, column: 3 });
    expect(h.wanted()).toBe(36);
    h.flush();
    expect(h.focused).toEqual([]);
    h.grid.shape({ ...shape, shown: 48 });
    h.draw(24, 48);
    h.flush();
    expect(h.focused).toEqual([33]);
    h.grid.focused(33);
    expect(h.grid.pending).toBeNull();
    expect(h.wanted()).toBe(0);
  });

  test('a batch short of the target moves focus to its deepest row in the meantime', () => {
    const h = harness();
    h.grid.shape(shape);
    h.draw(0, 24);
    h.grid.focused(19);
    for (let i = 0; i < 6; i++) h.grid.key(down(19));
    expect(h.grid.pending).toEqual({ row: 7, column: 1 });
    h.grid.shape({ ...shape, shown: 36 });
    h.draw(24, 36);
    h.flush();
    expect(h.focused).toEqual([31]);
    h.grid.blurred(19);
    h.grid.focused(31);
    h.flush();
    expect(h.grid.pending).toEqual({ row: 7, column: 1 });
    h.grid.shape({ ...shape, shown: 48 });
    h.draw(36, 48);
    h.flush();
    expect(h.focused).toEqual([31, 43]);
  });

  test('a press kept on the old card while focus moves on counts from the card focus is going to', () => {
    const h = harness();
    h.grid.shape(shape);
    h.draw(0, 24);
    h.grid.focused(18);
    h.grid.key(down(18));
    h.grid.shape({ ...shape, shown: 48 });
    h.draw(24, 48);
    h.flush();
    expect(h.focused).toEqual([24]);
    expect(h.grid.pending).toBeNull();
    // Sent before focus reached 24: one row past it.
    h.grid.key(down(18));
    expect(h.grid.pending).toEqual({ row: 5, column: 0 });
    h.grid.blurred(18);
    h.grid.focused(24);
    h.flush();
    expect(h.focused).toEqual([24, 30]);
  });

  test('presses Android moved itself, and other grids\' presses, are not taken', () => {
    const h = harness();
    h.grid.shape(shape);
    h.draw(0, 24);
    expect(h.grid.key({ eventType: 'down', eventKeyAction: 0 })).toBe(false);
    expect(h.grid.key({ ...down(21), focusTag: 5 })).toBe(false);
    expect(h.grid.key({ ...down(21), eventKeyAction: 1 })).toBe(false);
    expect(h.grid.pending).toBeNull();
  });

  test('another press, or focus leaving the grid, drops the target', () => {
    const h = harness();
    h.grid.shape(shape);
    h.draw(0, 24);
    h.grid.focused(21);
    h.grid.key(down(21));
    h.grid.key({ eventType: 'up', eventKeyAction: 0 });
    expect(h.grid.pending).toBeNull();
    h.grid.key(down(21));
    h.grid.blurred(21);
    h.flush();
    expect(h.grid.pending).toBeNull();
    h.grid.shape({ ...shape, shown: 48 });
    h.draw(24, 48);
    h.flush();
    expect(h.focused).toEqual([]);
  });

  test('a card drawn again (a redraw) keeps its place', () => {
    const h = harness();
    h.grid.shape(shape);
    h.draw(0, 24);
    h.grid.focused(22);
    const release = h.grid.register(22, { requestTVFocus() {} }, 1022);
    release();
    h.grid.register(22, { requestTVFocus() {} }, 1022);
    expect(h.grid.key(down(22))).toBe(true);
  });
});

describe('drawing for a waiting press', () => {
  test('a grid draws on toward the wanted count wherever its spacer is', () => {
    expect(gridDrawn(24, 24, 100, 5000, 1000, 1.5, 24)).toBe(24);
    expect(gridDrawn(24, 24, 100, 5000, 1000, 1.5, 24, 36)).toBe(48);
    expect(gridDrawn(48, 48, 100, 5000, 1000, 1.5, 24, 36)).toBe(48);
  });
});
