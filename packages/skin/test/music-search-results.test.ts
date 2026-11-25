// The audio app's search results (widgets/music/search-results.ts): grouped by what the library
// holds, kept to the library's own class when the server could not scope the search, and the
// library's recent searches.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from '@vela/core';
import { listeningWords } from '../src/blocks/listen/listening';
import {
  albumsTab, booksBy, creditedPeople, forgetSearch, listeningResults, nameMatches, readRecent, rememberSearch, RECENT_LIMIT, scopedItems, seeAllAlbums, topResult,
} from '../src/widgets/music/search-results';
import { parsePlace, placeParam } from '../src/blocks/listen/place';
import { nearEnd } from '../src/widgets/music/scroll-end';

const catalogue = JSON.parse(readFileSync(join(import.meta.dir, '../../core/src/i18n/strings/en.json'), 'utf8')) as Record<string, string>;

type Media = NonNullable<Card['media']>;
function card(id: string, media: Partial<Media> | null, extra: Partial<Card> = {}): Card {
  return {
    id, kind: 'episode', name: id, poster: '', backdrop: '', accent: '', receipt: '', yearLabel: '', summary: '', genres: [], airDate: '',
    durationSeconds: 100, progressSeconds: 0, played: false,
    media: media === null ? undefined : { class: 'music', role: 'track', shape: 'square', index: 0, disc: 0, byline: '', bylineTarget: '', narrator: '', parents: [], credits: [], childCount: 0, childCounts: {},
      readingFormat: '', pages: 0, readingFraction: 0, readingLocator: '', readingLabel: '', facts: [], audio: true, indexLabel: '', clockLabel: '', ...media },
    ...extra,
  } as unknown as Card;
}
const ids = (cards: Card[]) => cards.map(c => c.id);

const coldplay = card('Coldplay', { role: 'artist' }, { kind: 'show' });
const parachutes = card('Parachutes', { role: 'album' }, { kind: 'season' });
const yellow = card('Yellow', { role: 'track' });
const clocks = card('Clocks', { role: 'track' });
const mix = card('Coldplay Mix', null, { kind: 'playlist' });
const film = card('Coldplay: A Head Full of Dreams', null, { kind: 'movie' });
const videoEpisode = card('Coldplay ep', { class: 'video' });

test('music results group into songs, artists, albums and playlists, with the top result', () => {
  const results = listeningResults([coldplay, parachutes, yellow, clocks, mix], 'coldplay', 'music', true);
  expect(results.top?.id).toBe('Coldplay');
  expect(results.groups.map(g => [g.id, g.layout, ids(g.items)])).toEqual([
    ['songs', 'rows', ['Yellow', 'Clocks']],
    ['artists', 'tiles', ['Coldplay']],
    ['albums', 'tiles', ['Parachutes']],
    ['playlists', 'tiles', ['Coldplay Mix']],
  ]);
  expect(results.empty).toBe(false);
});

test('groups with nothing in them are left out; no results at all is empty', () => {
  expect(listeningResults([yellow], 'yellow', 'music', true).groups.map(g => g.id)).toEqual(['songs']);
  const none = listeningResults([], 'zzz', 'music', true);
  expect(none).toEqual({ top: undefined, groups: [], empty: true });
});

test('an unscoped answer keeps only the library\'s own class; a scoped one is trusted as-is', () => {
  const answer = [film, coldplay, videoEpisode, yellow, mix];
  expect(ids(scopedItems(answer, 'music', false))).toEqual(['Coldplay', 'Yellow', 'Coldplay Mix']);
  expect(ids(scopedItems(answer, 'music', true))).toEqual(ids(answer));
  const results = listeningResults(answer, 'coldplay', 'music', false);
  expect(results.top?.id).toBe('Coldplay');
  expect(results.groups.flatMap(g => ids(g.items))).not.toContain(film.id);
  // A spoken-word library keeps its own class only: no music, and no playlists.
  const book = card('Mistborn', { class: 'audiobook', role: 'audiobook' }, { kind: 'movie' });
  expect(ids(scopedItems([...answer, book], 'audiobook', false))).toEqual(['Mistborn']);
  // A library of another class in the audio app keeps any non-video media.
  expect(ids(scopedItems([film, yellow, book], 'audio', false))).toEqual(['Yellow', 'Mistborn']);
});

test('the top result is the exact name, containers first, else the server\'s first', () => {
  const rumoursSong = card('Rumours', { role: 'track' });
  const rumoursAlbum = card('Rumours ', { role: 'album' }, { name: 'Rumours' });
  expect(topResult([rumoursSong, rumoursAlbum], 'rumours', 'music')?.id).toBe('Rumours ');
  expect(topResult([yellow, coldplay], 'yel', 'music')?.id).toBe('Yellow');
  expect(topResult([yellow, coldplay], 'COLDPLAY', 'music')?.id).toBe('Coldplay');
  expect(topResult([], 'x', 'music')).toBeUndefined();
});

test('the viewer\'s own playlists join Playlists when their name matches, once each', () => {
  const own = [card('Road trip', null, { kind: 'playlist' }), card('Coldplay Mix', null, { kind: 'playlist' }), card('Cold mornings', null, { kind: 'playlist' })];
  const results = listeningResults([coldplay, mix], 'cold', 'music', true, { playlists: own });
  expect(ids(results.groups.find(g => g.id === 'playlists')!.items)).toEqual(['Coldplay Mix', 'Cold mornings']);
});

test('the top artist\'s own albums join Albums after the server\'s', () => {
  const xy = card('X&Y', { role: 'album' }, { kind: 'season' });
  const results = listeningResults([coldplay, parachutes], 'coldplay', 'music', true, { artistAlbums: [parachutes, xy, yellow] });
  expect(ids(results.groups.find(g => g.id === 'albums')!.items)).toEqual(['Parachutes', 'X&Y']);
});

const credits = (...list: [string, string][]) => list.map(([role, name]) => ({ role, name, personId: `p-${name}` }));
const mistborn = card('The Final Empire', { class: 'audiobook', role: 'audiobook', credits: credits(['author', 'Brandon Sanderson'], ['narrator', 'Michael Kramer']) }, { kind: 'movie' });
const lostMetal = card('The Lost Metal', { class: 'audiobook', role: 'audiobook', credits: credits(['author', 'Brandon Sanderson'], ['narrator', 'Michael Kramer']) }, { kind: 'movie' });
const wheel = card('The Gathering Storm', { class: 'audiobook', role: 'audiobook', credits: credits(['author', 'Robert Jordan'], ['author', 'Brandon Sanderson'], ['narrator', 'Michael Kramer'], ['narrator', 'Kate Reading']) }, { kind: 'movie' });

test('audiobook results group into books, authors and narrators the books credit', () => {
  const results = listeningResults([mistborn, lostMetal, wheel], 'sanderson', 'audiobook', true);
  expect(results.groups.map(g => g.id)).toEqual(['books', 'authors']);
  expect(results.groups[1]!.people).toEqual([{ name: 'Brandon Sanderson', personId: 'p-Brandon Sanderson', role: 'author', count: 3 }]);
  const narrated = listeningResults([mistborn, wheel], 'kra', 'audiobook', true);
  expect(narrated.groups.map(g => g.id)).toEqual(['books', 'narrators']);
  expect(narrated.groups[1]!.people.map(p => [p.name, p.count])).toEqual([['Michael Kramer', 2]]);
});

test('people are matched by the start of a word, most credited first, and pick their books', () => {
  expect(nameMatches('Brandon Sanderson', 'sand')).toBe(true);
  expect(nameMatches('Brandon Sanderson', 'anders')).toBe(false);
  expect(nameMatches('Brandon Sanderson', '')).toBe(false);
  const people = creditedPeople([mistborn, lostMetal, wheel], 'r', 'narrator');
  expect(people.map(p => p.name)).toEqual(['Kate Reading']);
  expect(creditedPeople([mistborn, wheel], 'b', 'author').map(p => [p.name, p.count])).toEqual([['Brandon Sanderson', 2]]);
  expect(ids(booksBy([mistborn, lostMetal, wheel], { name: 'kate reading', role: 'narrator' }))).toEqual(['The Gathering Storm']);
  expect(ids(booksBy([mistborn, wheel], { name: 'Robert Jordan', role: 'narrator' }))).toEqual([]);
});

test('podcast results group into shows and episodes', () => {
  const show = card('Hardcore History', { class: 'podcast', role: 'show' }, { kind: 'show' });
  const episode = card('Supernova', { class: 'podcast', role: 'episode' });
  const results = listeningResults([episode, show], 'h', 'podcast', true);
  expect(results.groups.map(g => [g.id, g.layout, ids(g.items)])).toEqual([['shows', 'tiles', ['Hardcore History']], ['episodes', 'rows', ['Supernova']]]);
  expect(results.top?.id).toBe('Supernova');
});

test('every group heading and search word is in the catalogue; spoken word gets no music words', () => {
  const all = [coldplay, parachutes, yellow, mix, mistborn, wheel];
  const titles = (['music', 'audiobook', 'podcast', 'audio'] as const).flatMap(l => listeningResults(all, 'b', l, false).groups.map(g => g.title));
  for (const key of [...titles, 'listening.authors', 'listening.narrators', 'listening.shows', 'listening.titles']) expect(catalogue[key]).toBeDefined();
  for (const listening of ['music', 'audiobook', 'podcast', 'audio'] as const) {
    const { searchPlaceholder, searchIntro } = listeningWords(listening);
    expect(catalogue[searchPlaceholder]).toBeDefined();
    expect(catalogue[searchIntro]).toContain('{library}');
  }
  for (const listening of ['audiobook', 'podcast'] as const) {
    expect(catalogue[listeningWords(listening).searchPlaceholder]).not.toMatch(/song|album|artist|playlist/i);
    expect(listeningResults(all, 'b', listening, false).groups.map(g => g.title).filter(t => t.startsWith('music.'))).toEqual([]);
  }
});

test('recent searches: newest first, once each ignoring case and spacing, bounded, and forgettable', () => {
  let recent = rememberSearch([], '  coldplay ');
  recent = rememberSearch(recent, 'Rumours');
  recent = rememberSearch(recent, 'COLDPLAY');
  expect(recent).toEqual(['COLDPLAY', 'Rumours']);
  expect(rememberSearch(recent, '   ')).toEqual(recent);
  expect(rememberSearch(recent, 'taylor   swift')[0]).toBe('taylor swift');
  let many: string[] = [];
  for (let i = 0; i < RECENT_LIMIT + 3; i++) many = rememberSearch(many, `q${i}`);
  expect(many).toHaveLength(RECENT_LIMIT);
  expect(many[0]).toBe(`q${RECENT_LIMIT + 2}`);
  expect(forgetSearch(recent, 'rumours')).toEqual(['COLDPLAY']);
});

test('recent searches read back from storage; anything malformed reads as none', () => {
  expect(readRecent(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
  expect(readRecent(null)).toEqual([]);
  expect(readRecent('not json')).toEqual([]);
  expect(readRecent('{"a":1}')).toEqual([]);
  expect(readRecent(JSON.stringify(['a', 3, '', 'b']))).toEqual(['a', 'b']);
});

const artistOf = (id: string, name: string) => ({ parents: [{ id, name, role: 'artist' }] } as Partial<Media>);
const crash = card('Crash', { role: 'album', ...artistOf('dmb', 'Dave Matthews Band') }, { kind: 'season' });
const busted = card('Busted Stuff', { role: 'album', ...artistOf('dmb', 'Dave Matthews Band') }, { kind: 'season' });
const someDevil = card('Some Devil', { role: 'album', ...artistOf('dave', 'Dave Matthews') }, { kind: 'season' });
const dmb = card('Dave Matthews Band', { role: 'artist' }, { kind: 'show' });

test("Albums' See all opens the top artist's page when every album is theirs; mixed albums open every match", () => {
  const own = card('Crash', { role: 'album', ...artistOf('Dave Matthews Band', 'Dave Matthews Band') }, { kind: 'season' });
  const alone = listeningResults([dmb, own], 'dave matthews band', 'music', true);
  expect(alone.top?.id).toBe('Dave Matthews Band');
  expect(seeAllAlbums(alone, 'dave matthews band', true)).toEqual({ kind: 'title', id: 'Dave Matthews Band' });
  // "Dave Matthews": the solo artist on top, albums by him and by the band: the artist's page
  // would list fewer than the shelf, so the library's albums matching the query open.
  const mixed = listeningResults([dmb, crash, someDevil], 'dave matthews', 'music', true);
  expect(seeAllAlbums(mixed, 'dave matthews', true)).toEqual({ kind: 'albums', query: 'dave matthews' });
  // A library without an album view: the top artist's page.
  expect(seeAllAlbums(mixed, 'dave matthews', false)).toEqual({ kind: 'title', id: 'Dave Matthews Band' });
});

test("Albums' See all opens the one artist every album found is by, the byline's link standing in for a parent", () => {
  const results = listeningResults([crash, busted], 'crash', 'music', true);
  expect(seeAllAlbums(results, 'crash', true)).toEqual({ kind: 'title', id: 'dmb' });
  const linked = card('Linked', { role: 'album', bylineTarget: 'title:dmb' }, { kind: 'season' });
  expect(seeAllAlbums(listeningResults([crash, linked], 'x', 'music', true), 'x', false)).toEqual({ kind: 'title', id: 'dmb' });
});

test("albums by several artists open every album the library matches, only where the library has that view", () => {
  const results = listeningResults([crash, someDevil], ' dave ', 'music', true);
  expect(seeAllAlbums(results, ' dave ', true)).toEqual({ kind: 'albums', query: 'dave' });
  expect(seeAllAlbums(results, 'dave', false)).toBeUndefined();
  // An album without a known artist is not "one artist".
  const loose = card('Loose', { role: 'album' }, { kind: 'season' });
  expect(seeAllAlbums(listeningResults([crash, loose], 'x', 'music', true), 'x', true)).toEqual({ kind: 'albums', query: 'x' });
  // No albums group, no See all.
  expect(seeAllAlbums(listeningResults([yellow], 'yellow', 'music', true), 'yellow', true)).toBeUndefined();
});

test("the library's album view is its searchable album-level view tab, never a collections tab at that level", () => {
  expect(albumsTab([
    { id: 'genres', label: 'Genres', kind: 'collections', level: 'album', search: true },
    { id: 'artists', label: 'Artists', kind: 'view', level: 'artist', search: true },
    { id: 'albums', label: 'Albums', kind: 'view', level: 'album', search: true },
  ])).toBe('albums');
  expect(albumsTab([{ id: 'albums', label: 'Albums', kind: 'view', level: 'album' }])).toBeUndefined();
  expect(albumsTab(undefined)).toBeUndefined();
});

test('the albums a search matches have an address of their own, the query kept as typed', () => {
  const place = parsePlace(placeParam({ kind: 'albums', query: 'dave: live' }));
  expect(place).toEqual({ kind: 'albums', query: 'dave: live' });
  expect(parsePlace('albums:')).toEqual({ kind: 'home' });
  expect(parsePlace('albums:  ')).toEqual({ kind: 'home' });
});

test('a paged list reads on within a screen of its end, and at once when it does not fill the page', () => {
  expect(nearEnd({ offset: 0, viewport: 800, content: 4000 })).toBe(false);
  expect(nearEnd({ offset: 2400, viewport: 800, content: 4000 })).toBe(true);
  expect(nearEnd({ offset: 0, viewport: 800, content: 600 })).toBe(true);
  // Not laid out yet: nothing is known, so nothing is read.
  expect(nearEnd({ offset: 0, viewport: 0, content: 0 })).toBe(false);
});
