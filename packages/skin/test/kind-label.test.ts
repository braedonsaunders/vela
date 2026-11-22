import { expect, test } from 'bun:test';
import { card } from '@vela/core';
import { kindLabel, kindLabelKey } from '../src/vocabulary';

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

test("a plugin's video child is named by its own role, not as a film", () => {
  const concert = card({ id: 'c', kind: 'movie', name: 'Live at the Boathouse', summary: '', genres: [], artwork: [],
    media: { class: 'video', role: 'concert', parents: [{ id: 'a', name: 'The Band', role: 'artist' }] } });
  expect(concert.videoRole).toBe('concert');
  expect(kindLabel(concert)).toBe('Concert');
  // A role Vela has no word for reads as the server wrote it.
  expect(kindLabel({ kind: 'movie', videoRole: 'behind-the-scenes' })).toBe('Behind the scenes');
  expect(kindLabel({ kind: 'movie', videoRole: 'liveSession' })).toBe('Live session');
  // Ordinary video and media titles keep their words.
  expect(card({ id: 'm', kind: 'movie', name: 'M', summary: '', genres: [], artwork: [], media: { class: 'video', role: 'item' } }).videoRole).toBeUndefined();
  expect(kindLabel({ kind: 'movie' })).toBe('Film');
  expect(kindLabel({ kind: 'movie', media: media('music', 'album') })).toBe('Album');
});
