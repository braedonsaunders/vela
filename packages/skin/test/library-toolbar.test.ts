import { expect, test } from 'bun:test';
import { toolbarTabs, tabSearchEnabled } from '../src/widgets/library/toolbar-model';
import type { LibraryPage } from '../src/widgets/library/model';

test('toolbar preserves declared order and labels and does not invent explicitly absent tabs', () => {
  const page = { model: { tabs: [{ id: 'studio', label: 'Our Studios', kind: 'collections' }, { id: 'cast', label: 'Performers', kind: 'people' }] } } as LibraryPage;
  expect(toolbarTabs(page).map(tab => [tab.id, tab.label])).toEqual([['studio', 'Our Studios'], ['cast', 'Performers']]);
  expect(toolbarTabs({ model: { tabs: [] } } as unknown as LibraryPage)).toEqual([]);
});
test('legacy genres require choices and collection tabs require server support', () => {
  expect(toolbarTabs(undefined).map(tab => tab.id)).toEqual(['library']);
  const page = { canRecommend: true, extras: { collectionsAvailable: true, genres: [{ id: 'drama', label: 'Drama' }] } } as LibraryPage;
  expect(toolbarTabs(page).map(tab => tab.id)).toEqual(['recommended', 'library', 'collections', 'genres']);
});
test('collection and people search defaults can be overridden by the server', () => {
  for (const kind of ['collections', 'people']) {
    expect(tabSearchEnabled({ kind })).toBe(true);
    expect(tabSearchEnabled({ kind, search: false })).toBe(false);
  }
  for (const kind of ['recommended', 'library']) expect(tabSearchEnabled({ kind })).toBe(false);
  expect(tabSearchEnabled(undefined)).toBe(false);
});

test('toolbar dimensions come from validated skin look tokens', async () => {
  const { resolveUi, withUi } = await import('../src/resolve/ui');
  const ui = resolveUi({ controlHeight: 44, controlFontSize: 16, radiusControl: 12 });
  expect(withUi('$ui.controlHeight $ui.controlFontSize $ui.radiusControl', ui)).toBe('44px 16px 12px');
  for (const controlHeight of [0, -1, 161, NaN]) expect(() => resolveUi({ controlHeight })).toThrow();
});
