// The music home's own shelves and Liked tile give way to the page's rows (Ether's purpose
// recentContexts and liked); surface rows are not music shelves.
import { expect, test } from 'bun:test';
import type { Row } from '@vela/core';
import { musicHomeRows } from '../src/widgets/music/home-rows';

const row = (id: string, purpose: Row['purpose'], more: Partial<Row> = {}): Row => ({ id, name: id, purpose, receipt: '', items: [{ id: `${id}-a` } as Row['items'][number]],
  nextCursor: '', continuation: 'exhausted', previewOnFocus: false, presentation: '', layout: 'standard', personal: false, ...more });

test('a page with its own Jump back in and liked rows: Vela draws neither its own recents nor the Liked tile', () => {
  const rows = [row('jump', 'recentContexts'), row('recent', 'recentlyAdded'), row('liked', 'liked'), row('picks', 'recommendation', { layout: 'tracks' })];
  const view = musicHomeRows(rows, true);
  expect(view).toMatchObject({ ownRecent: true, ownLiked: true, jump: [] });
  expect(view.shelves.map(r => r.id)).toEqual(['jump', 'recent', 'liked', 'picks']);
});

test('without them, Vela keeps its own shelves and tile (and an older server\'s named rows)', () => {
  const rows = [row('plugin:music:jump-back-in', 'recommendation'), row('plugin:music:recently-played', 'recent'), row('picks', 'recommendation')];
  const view = musicHomeRows(rows, true);
  expect(view).toMatchObject({ ownRecent: false, ownLiked: false });
  expect(view.jump).toEqual(rows[0]!.items);
  expect(view.shelves.map(r => r.id)).toEqual(['picks']);
  expect(musicHomeRows(rows, false).shelves.map(r => r.id)).toEqual(['plugin:music:recently-played', 'picks']);
});

test('empty rows and surface rows are not music shelves', () => {
  const rows = [row('empty', 'recommendation', { items: [] }), row('surface:sports:sports.tonight', 'recommendation', { items: [], surface: 'sports.tonight' }), row('albums', 'recentlyAdded')];
  expect(musicHomeRows(rows, false).shelves.map(r => r.id)).toEqual(['albums']);
});
