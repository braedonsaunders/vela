import { expect, test } from 'bun:test';
import type { Title } from '../src/wire';
import { card } from '../src/discovery/models';
import { cardMedia, mediaClass, mediaRole, shapeOf } from '../src/media';

const base: Title = { id: 't', kind: 'episode', name: 'Low Tide', summary: '', genres: [], artwork: [] };
const track: Title = { ...base, durationSeconds: 222, media: { class: 'music', role: 'track', index: 3, disc: 1,
  parents: [{ id: 'album-1', name: 'Harbour Lights', role: 'album' }, { id: 'artist-1', name: 'The Paper Moons', role: 'artist' }],
  credits: [{ name: 'The Paper Moons', role: 'artist' }] } };

test('a title without a media block stays video', () => {
  expect(cardMedia(base)).toBeUndefined();
  expect(card(base).kind).toBe('episode');
  expect(card(base).shape).toBeUndefined();
});

test('unknown classes read as video and unknown roles as item', () => {
  expect(mediaClass('hologram')).toBe('video');
  expect(mediaRole('stanza')).toBe('item');
  expect(cardMedia({ ...base, media: { class: 'hologram' as never, role: 'track' } })).toBeUndefined();
  expect(cardMedia({ ...base, media: { class: 'music', role: 'stanza' as never } })?.role).toBe('item');
});

test('a track card carries its role, square cover, album and artist byline', () => {
  const model = card(track);
  expect(model.kind).toBe('track');
  expect(model.shape).toBe('square');
  expect(model.media?.parent).toEqual({ id: 'album-1', name: 'Harbour Lights', role: 'album' });
  expect(model.media?.byline).toBe('The Paper Moons');
  // No person id: the byline opens the artist title.
  expect(model.media?.bylineTarget).toBe('title:artist-1');
  expect(model.media?.clockLabel).toBe('3:42');
  expect(model.media?.audio).toBe(true);
  expect(model.facts).toBe('Harbour Lights · 3:42');
});

test('cover shapes follow class and role', () => {
  expect(shapeOf('music', 'artist')).toBe('round');
  expect(shapeOf('music', 'album')).toBe('square');
  expect(shapeOf('book', 'book')).toBe('book');
  expect(shapeOf('book', 'series')).toBe('book');
  expect(shapeOf('audiobook', 'audiobook')).toBe('square');
  expect(shapeOf('video', 'item')).toBe('');
});

test('a book card reads its author by person and its reading progress', () => {
  const book = card({ ...base, id: 'b', year: 2019, watch: { positionSeconds: 0, played: false, favorite: false, watchlisted: false,
    reading: { locator: 'epubcfi(/6/4)', fraction: 0.34, label: 'Chapter 4', updatedAt: '2026-11-20T00:00:00Z' } },
    media: { class: 'book', role: 'book', reading: { format: 'epub', pages: 312 }, credits: [{ name: 'Ada Wren', role: 'author', personId: 'p-ada' }] } });
  expect(book.kind).toBe('book');
  expect(book.shape).toBe('book');
  expect(book.media?.bylineTarget).toBe('person:p-ada');
  expect(book.media?.readingFormat).toBe('epub');
  expect(book.media?.readingFraction).toBe(0.34);
  expect(book.facts).toBe('34% read · 312 pages');
  expect(book.progressLabel).toBe('34%');
});

test('reading URLs resolve on the server origin and refuse anywhere else', async () => {
  const { readingURL } = await import('../src/store/media');
  expect(readingURL('/reading/media/abc/book.epub', 'http://127.0.0.1:7777')).toBe('http://127.0.0.1:7777/reading/media/abc/book.epub');
  expect(readingURL('https://ether.example/ether/v1/kind-media/t', 'https://ether.example')).toBe('https://ether.example/ether/v1/kind-media/t');
  expect(() => readingURL('https://elsewhere.example/book.epub', 'https://ether.example')).toThrow();
  expect(() => readingURL('https://user:pw@ether.example/book.epub', 'https://ether.example')).toThrow();
});
