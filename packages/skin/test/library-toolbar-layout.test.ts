import { expect, test } from 'bun:test';
import { tabOverflow } from '../src/widgets/library/toolbar-layout';
import { toolbarLayout } from '../src/widgets/library/toolbar-model';

test('desktop widths keep tabs, search, Filters, Sort and the count on one row', () => {
  for (const width of [900, 1000, 1199, 1200, 1440]) expect(toolbarLayout(width, false)).toBe('row');
});

test('tablets stack the tabs over the controls; phones draw Filters and Sort as icons', () => {
  expect(toolbarLayout(899, false)).toBe('stacked');
  expect(toolbarLayout(600, false)).toBe('stacked');
  expect(toolbarLayout(599, false)).toBe('phone');
  expect(toolbarLayout(390, false)).toBe('phone');
});

test('TV keeps one row even at low logical resolutions', () => {
  expect(toolbarLayout(800, true)).toBe('row');
});

test('tab overflow is based on measured clipping', () => {
  expect(tabOverflow(0, 600, 400)).toEqual({ before: false, after: false });
  expect(tabOverflow(0, 400, 600)).toEqual({ before: false, after: true });
  expect(tabOverflow(100, 400, 600)).toEqual({ before: true, after: true });
  expect(tabOverflow(200, 400, 600)).toEqual({ before: true, after: false });
});
