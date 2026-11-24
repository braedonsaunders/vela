import { expect, test } from 'bun:test';
import { FLAT, foldState, sameFold } from '../src/model';

test('an upright division is a book, one across is a tabletop', () => {
  // iPhone Duo inner display, partly open: landscape (951×669) and upright (669×951).
  expect(foldState({ posture: 'book', division: { x: 455.5, y: 0, width: 40, height: 669 } }))
    .toEqual({ posture: 'book', division: { x: 455.5, y: 0, width: 40, height: 669 } });
  expect(foldState({ posture: 'tabletop', division: { x: 0, y: 455.5, width: 669, height: 40 } }))
    .toEqual({ posture: 'tabletop', division: { x: 0, y: 455.5, width: 669, height: 40 } });
});

test('the posture follows the division, whatever the report says', () => {
  expect(foldState({ posture: 'book', division: { x: 0, y: 455.5, width: 669, height: 40 } }).posture).toBe('tabletop');
});

test('flat, missing or malformed reports are flat', () => {
  expect(foldState({ posture: 'flat' })).toBe(FLAT);
  expect(foldState(null)).toBe(FLAT);
  expect(foldState('book')).toBe(FLAT);
  expect(foldState({ posture: 'book' })).toBe(FLAT);
  expect(foldState({ posture: 'book', division: { x: 0, y: 0, width: 0, height: 669 } })).toBe(FLAT);
  expect(foldState({ posture: 'tabletop', division: { x: 0, y: Number.NaN, width: 669, height: 40 } })).toBe(FLAT);
  // A flat report keeps no division, even if one came along.
  expect(foldState({ posture: 'flat', division: { x: 455.5, y: 0, width: 40, height: 669 } })).toBe(FLAT);
});

test('an angle is kept where reported, in range', () => {
  expect(foldState({ posture: 'flat', angle: 180 })).toEqual({ posture: 'flat', angle: 180 });
  expect(foldState({ posture: 'tabletop', angle: 400, division: { x: 0, y: 455.5, width: 669, height: 40 } }).angle).toBe(360);
});

test('equal states are the same layout; a moved division is not', () => {
  const a = foldState({ posture: 'book', division: { x: 455.5, y: 0, width: 40, height: 669 } });
  expect(sameFold(a, foldState({ posture: 'book', division: { x: 455.5, y: 0, width: 40, height: 669 } }))).toBe(true);
  expect(sameFold(a, foldState({ posture: 'book', division: { x: 400, y: 0, width: 40, height: 669 } }))).toBe(false);
  expect(sameFold(a, FLAT)).toBe(false);
  expect(sameFold(FLAT, foldState(undefined))).toBe(true);
});
