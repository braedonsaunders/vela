import { expect, test } from 'bun:test';
import { layoutsFor, neighbour, placement, settleLayout, slotRects, tileMaxHeight, type Rect } from '../src/widgets/multiview/layout';

const TV = { width: 1920, height: 1080 };
const inside = (rect: Rect, size = TV) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= size.width + 1e-6 && rect.y + rect.height <= size.height + 1e-6;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const sixteenNine = (rect: Rect) => Math.abs(rect.width / rect.height - 16 / 9) < 1e-6;

test('each tile count offers its layouts, the default first', () => {
  expect(layoutsFor(1)).toEqual(['single']);
  expect(layoutsFor(2)).toEqual(['split', 'feature']);
  expect(layoutsFor(3)).toEqual(['grid', 'feature']);
  expect(layoutsFor(4)).toEqual(['grid', 'feature']);
});

test('a chosen layout holds while the count allows it, and falls back when it does not', () => {
  expect(settleLayout('feature', 4)).toBe('feature');
  expect(settleLayout('split', 4)).toBe('grid');
  expect(settleLayout('grid', 2)).toBe('split');
  expect(settleLayout(null, 1)).toBe('single');
});

test('every layout keeps its tiles 16:9, on screen and apart', () => {
  for (const layout of ['split', 'grid', 'feature'] as const) {
    for (const count of [2, 3, 4]) {
      if (layout === 'split' && count > 2) continue;
      const rects = slotRects(layout, count, TV, 14);
      expect(rects).toHaveLength(count);
      for (const rect of rects) { expect(inside(rect)).toBe(true); expect(sixteenNine(rect)).toBe(true); }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
    }
  }
});

test('2×2 is four equal quarters; one big + three small gives the big tile most of the screen', () => {
  const grid = slotRects('grid', 4, TV, 14);
  expect(new Set(grid.map(rect => Math.round(rect.width))).size).toBe(1);
  expect(grid[0]!.width).toBeGreaterThan(900);
  const feature = slotRects('feature', 4, TV, 14);
  const [big, ...small] = feature;
  for (const rect of small) expect(big!.width).toBeGreaterThan(rect.width * 2);
  // The side column is centred and its tiles stacked in order.
  expect(small[0]!.y).toBeLessThan(small[1]!.y);
  expect(small[1]!.y).toBeLessThan(small[2]!.y);
  // With fewer beside it, the big tile keeps its size.
  expect(slotRects('feature', 2, TV, 14)[0]).toEqual(big!);
});

test('a lone tile fills the screen', () => {
  expect(slotRects('grid', 1, TV, 14)).toEqual([{ x: 0, y: 0, width: 1920, height: 1080 }]);
  expect(slotRects('grid', 0, TV, 14)).toEqual([]);
});

test('placement maps a full-screen view onto its rect about the centre', () => {
  expect(placement({ x: 0, y: 0, width: 1920, height: 1080 }, TV)).toEqual({ translateX: 0, translateY: 0, scale: 1 });
  const quarter = placement({ x: 960, y: 540, width: 960, height: 540 }, TV);
  expect(quarter).toEqual({ translateX: 480, translateY: 270, scale: 0.5 });
  // The centre lands on the rect's centre: 960 + 480 = 1440 = 960 + 960 / 2.
  expect(TV.width / 2 + quarter.translateX).toBe(960 + 480);
});

test('tiles cap their stream height by how many share the screen', () => {
  expect(tileMaxHeight(1)).toBeUndefined();
  expect(tileMaxHeight(2)).toBe(1080);
  expect(tileMaxHeight(3)).toBe(720);
  expect(tileMaxHeight(4)).toBe(720);
});

test('directional neighbours follow the grid and stop at its edges', () => {
  const grid = slotRects('grid', 4, TV, 14);
  expect(neighbour(grid, 0, 'right')).toBe(1);
  expect(neighbour(grid, 0, 'down')).toBe(2);
  expect(neighbour(grid, 3, 'up')).toBe(1);
  expect(neighbour(grid, 3, 'left')).toBe(2);
  expect(neighbour(grid, 0, 'left')).toBe(-1);
  const feature = slotRects('feature', 4, TV, 14);
  expect(neighbour(feature, 0, 'right')).toBe(2);
  expect(neighbour(feature, 3, 'left')).toBe(0);
});
