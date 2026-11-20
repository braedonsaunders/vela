import { expect, test } from 'bun:test';
import { placeAtPoint, placeAtRect } from '../src/card-context-placement';

test('pointer placement flips at every viewport edge and remains clamped', () => {
  const menu = { width: 240, height: 280 };
  expect(placeAtPoint({ x: 10, y: 10 }, menu, { width: 1000, height: 800 })).toMatchObject({ x: 12, y: 12, horizontal: 'right', vertical: 'below' });
  expect(placeAtPoint({ x: 990, y: 10 }, menu, { width: 1000, height: 800 })).toMatchObject({ x: 748, y: 12, horizontal: 'left', vertical: 'below' });
  expect(placeAtPoint({ x: 10, y: 790 }, menu, { width: 1000, height: 800 })).toMatchObject({ x: 12, y: 508, horizontal: 'right', vertical: 'above' });
  expect(placeAtPoint({ x: 990, y: 790 }, menu, { width: 1000, height: 800 })).toMatchObject({ x: 748, y: 508, horizontal: 'left', vertical: 'above' });
});

test('card placement prefers below, flips above and aligns inward near the right edge', () => {
  const menu = { width: 260, height: 300 };
  expect(placeAtRect({ left: 40, top: 40, right: 240, bottom: 160 }, menu, { width: 1000, height: 800 }))
    .toMatchObject({ x: 40, y: 168, horizontal: 'right', vertical: 'below' });
  expect(placeAtRect({ left: 800, top: 600, right: 980, bottom: 760 }, menu, { width: 1000, height: 800 }))
    .toMatchObject({ x: 720, y: 292, horizontal: 'left', vertical: 'above' });
});

test('oversized menus are pinned to the safe viewport margin', () => {
  expect(placeAtRect({ left: 20, top: 20, right: 80, bottom: 80 }, { width: 900, height: 700 }, { width: 500, height: 400 }))
    .toMatchObject({ x: 12, y: 12 });
});
