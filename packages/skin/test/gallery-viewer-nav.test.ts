import { expect, test } from 'bun:test';
import { galleryOriginKey, galleryOriginParam, photoInfoFacts, photoNeighbours, photoSwipe } from '../src/blocks/gallery/viewer-nav-model';

test('moves through the opening order, offers a next page at its edge, and never wraps', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  expect(photoNeighbours([a, c, b], 'a', true)).toEqual({ previous: undefined, next: c, more: false });
  expect(photoNeighbours([a, c, b], 'c', true)).toEqual({ previous: a, next: b, more: false });
  expect(photoNeighbours([a, c, b], 'b', true)).toEqual({ previous: c, next: undefined, more: true });
  expect(photoNeighbours([a, c, b], 'b', false).next).toBeUndefined();
  expect(photoNeighbours([a, c, b], 'missing', true)).toEqual({ more: false });
});

test('horizontal swipes page photos and taps and vertical scrolling do not', () => {
  const start = { x: 90, y: 80 };
  expect(photoSwipe(start, { x: 40, y: 82 })).toBe(1);
  expect(photoSwipe(start, { x: 150, y: 92 })).toBe(-1);
  expect(photoSwipe(start, { x: 60, y: 76 })).toBeUndefined();
  expect(photoSwipe(start, { x: 40, y: 160 })).toBeUndefined();
  expect(photoSwipe(start, { x: NaN, y: 80 })).toBeUndefined();
});


test('the opening page key survives routing percent decoding for names with spaces and accents', () => {
  const key = 'screen:vela.gallery/person?id=al%2525~p&library=photos&name=Fran%C3%A7oise%20~';
  const param = galleryOriginParam(key);
  expect(decodeURIComponent(param)).toBe(param);
  expect(galleryOriginKey(param)).toBe(key);
});


test('the info panel drops a Taken fact that repeats the caption and keeps other facts', () => {
  const taken = { label: 'Taken', value: '2026-11-23' };
  const place = { label: 'Place', value: 'North Quay' };
  expect(photoInfoFacts([taken, place], '2026-11-23')).toEqual([place]);
  expect(photoInfoFacts([taken, place], '')).toEqual([taken, place]);
  expect(photoInfoFacts([taken, place], '2026-11-24')).toEqual([taken, place]);
});
