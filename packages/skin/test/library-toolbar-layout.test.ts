import { expect, test } from 'bun:test';
import { singleLibraryStrip, tabOverflow } from '../src/widgets/library/toolbar-layout';

test('portrait tablets keep tabs, filters and sorting in one usable scrolling strip', () => {
  expect(singleLibraryStrip(800, false)).toBe(true);
  expect(singleLibraryStrip(390, false)).toBe(true);
  expect(singleLibraryStrip(959, false)).toBe(true);
  expect(singleLibraryStrip(1024, false)).toBe(true);
  expect(singleLibraryStrip(1199, false)).toBe(true);
  expect(singleLibraryStrip(1200, false)).toBe(false);
  expect(singleLibraryStrip(1280, false)).toBe(false);
});

test('TV keeps separate tabs and sorting even at low logical resolutions', () => {
  expect(singleLibraryStrip(800, true)).toBe(false);
});

test('tab overflow is based on measured clipping', () => {
  expect(tabOverflow(0, 600, 400)).toEqual({ before: false, after: false });
  expect(tabOverflow(0, 400, 600)).toEqual({ before: false, after: true });
  expect(tabOverflow(100, 400, 600)).toEqual({ before: true, after: true });
  expect(tabOverflow(200, 400, 600)).toEqual({ before: true, after: false });
});
