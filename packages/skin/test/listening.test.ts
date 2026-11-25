// The audio app's words and controls follow the library's class and each title's role
// (blocks/listen/listening.ts): no music wording reaches an audiobook or a podcast.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from '@vela/core';
import { creditLines, isSpoken, keyboardMap, listColumns, listenFrom, listenedFraction, listeningOf, listeningWords, roleLabel, spokenMode } from '../src/blocks/listen/listening';

const catalogue = JSON.parse(readFileSync(join(import.meta.dir, '../../core/src/i18n/strings/en.json'), 'utf8')) as Record<string, string>;

type Media = NonNullable<Card['media']>;
function card(id: string, media: Partial<Media>, extra: Partial<Card> = {}): Card {
  return {
    id, kind: 'episode', name: id, poster: '', backdrop: '', accent: '', receipt: '', yearLabel: '', summary: '', genres: [], airDate: '',
    durationSeconds: 100, progressSeconds: 0, played: false,
    media: { class: 'music', role: 'track', shape: 'square', index: 0, disc: 0, byline: '', bylineTarget: '', narrator: '', parents: [], credits: [], childCount: 0, childCounts: {},
      readingFormat: '', pages: 0, readingFraction: 0, readingLocator: '', readingLabel: '', facts: [], audio: true, indexLabel: '', clockLabel: '', ...media },
    ...extra,
  } as unknown as Card;
}

test('the library class picks the words; other classes asking for the audio app get neutral ones', () => {
  expect(listeningOf('music')).toBe('music');
  expect(listeningOf('audiobook')).toBe('audiobook');
  expect(listeningOf('podcast')).toBe('podcast');
  expect(listeningOf('video')).toBe('audio');
  expect(listeningOf(undefined)).toBe('audio');
  expect(isSpoken('audiobook') && isSpoken('podcast')).toBe(true);
  expect(isSpoken('music') || isSpoken('audio')).toBe(false);
});

test('music keeps playlists and shuffle; spoken word has skips, speed and the sleep timer, and no music words', () => {
  expect(listeningWords('music')).toMatchObject({ playlists: true, transport: 'tracks', genreCount: 'music.albumsCount' });
  for (const listening of ['audiobook', 'podcast'] as const) {
    const words = listeningWords(listening);
    expect(words.playlists).toBe(false);
    expect(words.transport).toBe('spoken');
    const keys = [...words.filters.map(f => f.label), words.genreCount, words.likeKey, words.skipKey];
    expect(keys.filter(key => key.startsWith('music.'))).toEqual([]);
    for (const key of keys) expect(catalogue[key]).toBeDefined();
    // No song, album, artist or playlist in what a spoken-word library says.
    for (const key of keys) expect(catalogue[key]!).not.toMatch(/song|album|artist|playlist/i);
  }
  expect(listeningWords('podcast').filters.map(f => f.label)).toContain('listening.following');
  expect(listeningWords('audiobook').savedRoles).toEqual(['audiobook']);
});

test('the keyboard sheet lists shuffle and repeat for music and speed for spoken word', () => {
  const music = keyboardMap('music').map(row => row.label);
  expect(music).toContain('music.key.shuffle');
  expect(music).toContain('music.key.repeat');
  const book = keyboardMap('audiobook').map(row => row.label);
  expect(book).not.toContain('music.key.shuffle');
  expect(book).toContain('listening.key.speed');
  expect(book).toContain('listening.key.seek');
  expect(book).toContain('listening.key.skipBook');
  for (const label of [...music, ...book, ...keyboardMap('podcast').map(row => row.label)]) expect(catalogue[label]).toBeDefined();
});

test('eyebrows and credit lines follow the role: author and narrator, hosts, or the artist', () => {
  expect(roleLabel(card('a', { class: 'audiobook', role: 'audiobook' }))).toBe('media.ui.audiobook');
  expect(roleLabel(card('s', { class: 'podcast', role: 'show' }))).toBe('media.ui.podcast');
  expect(roleLabel(card('e', { class: 'podcast', role: 'episode' }))).toBe('media.ui.episode');
  expect(roleLabel(card('al', { class: 'music', role: 'album', childCount: 12 }))).toBe('media.ui.album');
  expect(roleLabel(card('ep', { class: 'music', role: 'album', childCount: 5 }))).toBe('music.ep');
  expect(roleLabel(card('x', { class: 'audiobook', role: 'collection' }))).toBe('listening.title');
  const book = card('b', { class: 'audiobook', role: 'audiobook', credits: [{ name: 'Ione', role: 'author', personId: 'p1' }, { name: 'Bea', role: 'narrator', personId: 'p2' }, { name: 'Cal', role: 'narrator', personId: '' }] });
  expect(creditLines(book)).toEqual([{ key: 'listening.by', names: [{ name: 'Ione', personId: 'p1' }] }, { key: 'media.ui.narratedBy', names: [{ name: 'Bea', personId: 'p2' }, { name: 'Cal', personId: '' }] }]);
  const show = card('s', { class: 'podcast', role: 'show', credits: [{ name: 'Wren', role: 'host', personId: '' }, { name: 'Teo', role: 'host', personId: '' }] });
  expect(creditLines(show)).toEqual([{ key: 'listening.hostedBy', names: [{ name: 'Wren', personId: '' }, { name: 'Teo', personId: '' }] }]);
  const album = card('al', { class: 'music', role: 'album', credits: [{ name: 'Band', role: 'albumArtist', personId: '' }, { name: 'Band', role: 'artist', personId: '' }] });
  expect(creditLines(album)).toEqual([{ key: 'music.byArtist', names: [{ name: 'Band', personId: '' }] }]);
  expect(creditLines(card('n', { class: 'audiobook', role: 'audiobook' }))).toEqual([]);
  for (const key of ['listening.by', 'media.ui.narratedBy', 'listening.hostedBy', 'listening.title', 'listening.chapter']) expect(catalogue[key]).toBeDefined();
});

test('list columns: tracks show the artist (and album across albums), chapters their start, episodes their date', () => {
  expect(listColumns('track')).toEqual({ title: 'music.title', album: false, detail: 'artist', time: 'duration' });
  expect(listColumns('track', true).album).toBe(true);
  expect(listColumns('chapter')).toEqual({ title: 'listening.chapter', album: false, detail: 'none', time: 'start' });
  expect(listColumns('episode')).toMatchObject({ title: 'media.ui.episode', detail: 'date', album: false });
  expect(listColumns('part').title).toBe('media.ui.part');
});

test('a book in parts resumes in the part under way; a show plays its episode under way, else its newest unheard', () => {
  const book = card('book', { class: 'audiobook', role: 'audiobook', childCount: 3 });
  const parts = [3, 1, 2].map(i => card(`p${i}`, { class: 'audiobook', role: 'part', index: i }, i === 1 ? { played: true } : i === 2 ? { progressSeconds: 41 } : {}));
  expect(listenFrom(book, parts)).toMatchObject({ index: 1, positionSeconds: 41 });
  expect(listenFrom(book, parts).items.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
  // Nothing under way: the first part not yet heard.
  expect(listenFrom(book, parts.map(p => ({ ...p, progressSeconds: 0 })))).toEqual({ items: expect.any(Array), index: 1 });

  const show = card('show', { class: 'podcast', role: 'show', audio: false });
  const episode = (id: string, airDate: string, extra: Partial<Card> = {}) => card(id, { class: 'podcast', role: 'episode' }, { airDate, ...extra });
  const old = episode('old', '2026-10-01', { played: true }), mid = episode('mid', '2026-11-01', { progressSeconds: 30 }), fresh = episode('new', '2026-11-20');
  expect(listenFrom(show, [old, fresh, mid])).toEqual({ items: [mid], index: 0, positionSeconds: 30 });
  expect(listenFrom(show, [old, fresh, { ...mid, progressSeconds: 0 }])).toEqual({ items: [fresh], index: 0 });
  expect(listenFrom(show, [{ ...old }, { ...fresh, played: true }])).toEqual({ items: [{ ...fresh, played: true }], index: 0 });
  // An album starts at its first track.
  const tracks = [card('t1', {}), card('t2', {})];
  expect(listenFrom(card('al', { class: 'music', role: 'album', audio: false }), tracks)).toEqual({ items: tracks, index: 0 });
});

test('only spoken word shows how far the viewer got', () => {
  expect(listenedFraction(card('e', { class: 'podcast', role: 'episode' }, { progressSeconds: 25 }))).toBe(0.25);
  expect(listenedFraction(card('e', { class: 'podcast', role: 'episode' }, { progressSeconds: 25, played: true }))).toBe(0);
  expect(listenedFraction(card('t', { class: 'music', role: 'track' }, { progressSeconds: 25 }))).toBe(0);
});

test('a spoken title page is an audiobook, a show or another container', () => {
  expect(spokenMode(card('b', { class: 'audiobook', role: 'audiobook' }))).toBe('audiobook');
  expect(spokenMode(card('b', { class: 'book', role: 'book', audio: true }))).toBe('audiobook');
  expect(spokenMode(card('s', { class: 'podcast', role: 'show' }))).toBe('show');
  expect(spokenMode(card('e', { class: 'podcast', role: 'episode' }))).toBe('show');
  expect(spokenMode(card('c', { class: 'audiobook', role: 'series' }))).toBe('collection');
});
