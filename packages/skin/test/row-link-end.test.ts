// A row's See all end card exists only when the row has more to show; otherwise nothing is drawn
// (the lab showed an empty styled tile at the end of Continue Watching and Up Next).
import { expect, test } from 'bun:test';
import { rowLinkAvailable } from '../src/row-link-available';
import { rowFocusDestination } from '../src/web-row-navigation';

const row = (items: number, more = false) => ({ id: 'r', name: 'Row', items: Array.from({ length: items }, (_, i) => ({ id: String(i) })), nextCursor: more ? 'c' : '', continuation: more ? 'more' : 'exhausted' }) as never;
const open = () => {};

test('the end card is available only for a row with more than it shows, and only where rows can open', () => {
  expect(rowLinkAvailable(row(5), open, undefined)).toBe(false);
  expect(rowLinkAvailable(row(5, true), open, undefined)).toBe(true);
  expect(rowLinkAvailable(row(12), open, 8)).toBe(true);
  expect(rowLinkAvailable(row(12), open, undefined, '10')).toBe(true);
  expect(rowLinkAvailable(row(12, true), undefined, undefined)).toBe(false);
  expect(rowLinkAvailable(undefined as never, open, undefined)).toBe(false);
});

test('on the web the end card is the row\'s last arrow stop: right reaches it, down leaves it for the next row', () => {
  // Row 0: three cards and its See all card; row 1: two cards.
  expect(rowFocusDestination(0, 2, [4, 2], 'ArrowRight')).toEqual({ row: 0, item: 3 });
  expect(rowFocusDestination(0, 3, [4, 2], 'ArrowRight')).toBeNull();
  expect(rowFocusDestination(0, 3, [4, 2], 'ArrowDown')).toEqual({ row: 1, item: 1 });
  expect(rowFocusDestination(0, 3, [4, 2], 'ArrowLeft')).toEqual({ row: 0, item: 2 });
});
