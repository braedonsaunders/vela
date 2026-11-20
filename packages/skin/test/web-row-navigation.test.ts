import { describe, expect, test } from 'bun:test';
import { rowFocusDestination } from '../src/web-row-navigation';

describe('row keyboard navigation', () => {
  const rows = [4, 2, 5];

  test('left and right stay within the current shelf', () => {
    expect(rowFocusDestination(0, 1, rows, 'ArrowLeft')).toEqual({ row: 0, item: 0 });
    expect(rowFocusDestination(0, 1, rows, 'ArrowRight')).toEqual({ row: 0, item: 2 });
    expect(rowFocusDestination(0, 0, rows, 'ArrowLeft')).toBeNull();
    expect(rowFocusDestination(0, 3, rows, 'ArrowRight')).toBeNull();
  });

  test('up and down preserve the column or land on the final card', () => {
    expect(rowFocusDestination(0, 1, rows, 'ArrowDown')).toEqual({ row: 1, item: 1 });
    expect(rowFocusDestination(0, 3, rows, 'ArrowDown')).toEqual({ row: 1, item: 1 });
    expect(rowFocusDestination(1, 1, rows, 'ArrowDown')).toEqual({ row: 2, item: 1 });
    expect(rowFocusDestination(0, 1, rows, 'ArrowUp')).toBeNull();
  });
});
