import { expect, test } from 'bun:test';
import { kindLabelKey } from '../src/vocabulary';

const media = (cls: string, role: string) => ({ class: cls, role } as never);

test('a plugin book that arrives as a movie is named by its media class, not as a film', () => {
  expect(kindLabelKey({ kind: 'movie', media: media('book', 'book') })).toBe('media.ui.book');
  expect(kindLabelKey({ kind: 'movie', media: media('audiobook', 'audiobook') })).toBe('media.ui.audiobook');
  expect(kindLabelKey({ kind: 'show', media: media('book', 'series') })).toBe('media.ui.series');
  expect(kindLabelKey({ kind: 'movie', media: media('music', 'album') })).toBe('media.ui.album');
  expect(kindLabelKey({ kind: 'movie', media: media('music', 'track') })).toBe('media.ui.song');
  expect(kindLabelKey({ kind: 'show', media: media('music', 'artist') })).toBe('media.ui.artist');
  // A role the page does not name falls back to the class.
  expect(kindLabelKey({ kind: 'movie', media: media('book', 'item') })).toBe('media.ui.book');
});

test('video titles keep their structural kind', () => {
  expect(kindLabelKey({ kind: 'movie' })).toBe('ui.film');
  expect(kindLabelKey({ kind: 'movie', media: media('video', 'item') })).toBe('ui.film');
  expect(kindLabelKey({ kind: 'show' })).toBe('ui.series');
  expect(kindLabelKey({ kind: 'season' })).toBe('ui.season');
  expect(kindLabelKey({ kind: 'episode' })).toBe('ui.episode');
});
