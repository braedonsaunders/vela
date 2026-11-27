import { expect, test } from 'bun:test';
import { playlistsLayout } from '../../../apps/vela/src/playlists/layout';

test('a phone stacks the create row under the heading and shows two capped columns', () => {
  expect(playlistsLayout(390, false)).toEqual({ stacked: true, columns: 2, gutter: 20, card: 165 });
  expect(playlistsLayout(320, false)).toEqual({ stacked: true, columns: 2, gutter: 20, card: 130 });
});

test('three columns keep their original card bounds and one header row wherever they fit', () => {
  for (const width of [750, 820, 844, 1440]) expect(playlistsLayout(width, false)).toEqual({ stacked: false, columns: 3, gutter: 30, card: null });
});

test('TV keeps one row, three columns and the original card bounds at any reported width', () => {
  for (const width of [390, 960, 1920]) expect(playlistsLayout(width, true)).toEqual({ stacked: false, columns: 3, gutter: 30, card: null });
});
