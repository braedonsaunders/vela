// The audio app's search results, grouped by what the library holds: music's Top result, Songs,
// Artists, Albums and Playlists; audiobooks' books, authors and narrators; podcasts' shows and
// episodes. The server's list may be unscoped (a server that cannot keep search to one library):
// it is then kept to the library's own class here. Recent searches are this library's, local.
// Pure: the page (search.tsx) draws what this returns.
import { normalizeQuery, type Card, type LibraryModel } from '@vela/core';
import type { Listening } from '../../blocks/listen/listening';
import type { MusicPlace } from '../../blocks/listen/place';

/** A person a book credits whose name the query matches, with how many of the books found credit them. */
export interface ResultPerson { name: string; personId: string; role: 'author' | 'narrator'; count: number }

export type ResultGroupId = 'songs' | 'artists' | 'albums' | 'playlists' | 'books' | 'authors' | 'narrators' | 'shows' | 'episodes' | 'titles';

export interface ResultGroup {
  id: ResultGroupId;
  /** The group's heading, a message key. */
  title: string;
  /** Rows to play (songs, episodes), tiles to open, or people (authors, narrators). */
  layout: 'rows' | 'tiles' | 'people';
  items: Card[];
  people: ResultPerson[];
}

export interface ListeningResults {
  top?: Card;
  groups: ResultGroup[];
  /** Nothing in any group. */
  empty: boolean;
}

export interface ResultExtras {
  /** The viewer's own playlists (cards): those whose name the query matches join Playlists. */
  playlists?: Card[];
  /** The top artist's own albums, read from the artist: they join Albums after the server's. */
  artistAlbums?: Card[];
}

/** What a library of this kind keeps: the class its titles are (an 'audio' library keeps any non-video media). */
export function belongsTo(card: Pick<Card, 'kind' | 'media'>, listening: Listening): boolean {
  if (card.kind === 'playlist') return listening === 'music';
  const cls = card.media?.class;
  if (!cls) return false;
  return listening === 'audio' ? cls !== 'video' : cls === listening;
}

/** The server's list as this library's: as-is when the server kept it to the library, else only
 * the titles of the library's own class (the rest of the server's catalogue is not this library). */
export function scopedItems(items: Card[], listening: Listening, scoped: boolean): Card[] {
  return scoped ? items : items.filter(card => belongsTo(card, listening));
}

const roleOf = (card: Pick<Card, 'kind' | 'media'>) => (card.kind === 'playlist' ? 'playlist' : card.media?.role ?? '');

/** Containers before leaves when two share the query's name exactly ("Rumours" the album over the song). */
const TOP_ORDER: Record<Listening, string[]> = {
  music: ['artist', 'album', 'playlist', 'track'],
  audiobook: ['audiobook', 'book', 'series', 'part'],
  podcast: ['show', 'episode'],
  audio: [],
};

/**
 * The best match: a title named exactly what was typed (by kind, containers first), else the
 * first title in the server's order, which ranks by relevance. A leaf the server put first stays
 * first: a song can be the top result.
 */
export function topResult(items: Card[], query: string, listening: Listening): Card | undefined {
  const q = normalizeQuery(query);
  const order = TOP_ORDER[listening];
  const rank = (card: Card) => { const at = order.indexOf(roleOf(card)); return at < 0 ? order.length : at; };
  const exact = items.filter(card => q && normalizeQuery(card.name) === q).sort((a, b) => rank(a) - rank(b));
  return exact[0] ?? items[0];
}

/** Every word typed starts a word of the name (as Ether's own library search matches). */
export function nameMatches(name: string, query: string): boolean {
  const words = normalizeQuery(name).split(' ').filter(Boolean);
  const typed = normalizeQuery(query).split(' ').filter(Boolean);
  return typed.length > 0 && typed.every(part => words.some(word => word.startsWith(part)));
}

function unique(cards: Card[]): Card[] {
  const seen = new Set<string>();
  return cards.filter(card => !seen.has(card.id) && !!seen.add(card.id));
}

/** The people the books credit in `role` whose name the query matches, most credited first. */
export function creditedPeople(books: Card[], query: string, role: 'author' | 'narrator'): ResultPerson[] {
  const people = new Map<string, ResultPerson>();
  for (const book of books) {
    const named = new Set<string>();
    for (const credit of book.media?.credits ?? []) {
      if (credit.role !== role || !nameMatches(credit.name, query)) continue;
      const key = normalizeQuery(credit.name);
      if (named.has(key)) continue;
      named.add(key);
      const known = people.get(key);
      if (known) known.count++;
      else people.set(key, { name: credit.name, personId: credit.personId, role, count: 1 });
    }
  }
  return [...people.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Books crediting a person (an author or narrator picked from the results). */
export function booksBy(books: Card[], person: Pick<ResultPerson, 'name' | 'role'>): Card[] {
  const key = normalizeQuery(person.name);
  return books.filter(book => (book.media?.credits ?? []).some(credit => credit.role === person.role && normalizeQuery(credit.name) === key));
}

const group = (id: ResultGroupId, title: string, layout: ResultGroup['layout'], items: Card[], people: ResultPerson[] = []): ResultGroup => ({ id, title, layout, items, people });

/** The results for one query, grouped for the library: `items` is the server's one list (scopedItems applied by the caller or here). */
export function listeningResults(serverItems: Card[], query: string, listening: Listening, scoped: boolean, extras: ResultExtras = {}): ListeningResults {
  const items = unique(scopedItems(serverItems, listening, scoped));
  const by = (...roles: string[]) => items.filter(card => roles.includes(roleOf(card)));
  let groups: ResultGroup[];
  switch (listening) {
    case 'music': {
      const own = (extras.playlists ?? []).filter(p => nameMatches(p.name, query));
      groups = [
        group('songs', 'media.ui.songs', 'rows', by('track')),
        group('artists', 'music.artists', 'tiles', by('artist')),
        group('albums', 'music.albums', 'tiles', unique([...by('album'), ...(extras.artistAlbums ?? []).filter(a => roleOf(a) === 'album')])),
        group('playlists', 'music.playlists', 'tiles', unique([...by('playlist'), ...own])),
      ];
      break;
    }
    case 'audiobook': {
      const books = by('audiobook', 'book', 'series');
      groups = [
        group('books', 'media.ui.audiobooks', 'tiles', books),
        group('authors', 'listening.authors', 'people', [], creditedPeople(books, query, 'author')),
        group('narrators', 'listening.narrators', 'people', [], creditedPeople(books, query, 'narrator')),
      ];
      break;
    }
    case 'podcast':
      groups = [
        group('shows', 'listening.shows', 'tiles', by('show')),
        group('episodes', 'media.ui.episodes', 'rows', by('episode', 'item')),
      ];
      break;
    default:
      groups = [group('titles', 'listening.titles', 'tiles', items)];
  }
  groups = groups.filter(g => g.items.length || g.people.length);
  return { top: topResult(items, query, listening), groups, empty: groups.length === 0 };
}

/** Who an album is by: its artist parent, else the title its byline links to. */
export function albumArtist(card: Pick<Card, 'media'>): string | undefined {
  const media = card.media;
  return media?.parents.find(parent => parent.role === 'artist')?.id ?? (media?.bylineTarget.startsWith('title:') ? media.bylineTarget.slice(6) : undefined);
}

/** The library's own view of every album, searchable (Ether's music "Albums" tab: level album), if it declares one. */
export function albumsTab(tabs: LibraryModel['tabs']): string | undefined {
  return tabs?.find(tab => tab.kind === 'view' && tab.level === 'album' && tab.search === true)?.id;
}

/**
 * Where the Albums group's "See all" goes. Albums all by one artist: that artist's page, which
 * reads the whole discography. Albums by several: every album in the library matching the query,
 * when the library has a searchable album view (so "See all" never lists fewer than the shelf);
 * without one, the top result's page when it is an artist. Otherwise no "See all".
 */
export function seeAllAlbums(results: ListeningResults, query: string, albumView: boolean): MusicPlace | undefined {
  const albums = results.groups.find(group => group.id === 'albums')?.items ?? [];
  if (!albums.length) return undefined;
  const artists = new Set(albums.map(albumArtist));
  const [only] = artists;
  if (artists.size === 1 && only) return { kind: 'title', id: only };
  const text = query.trim();
  if (albumView && text) return { kind: 'albums', query: text };
  return results.top?.media?.role === 'artist' ? { kind: 'title', id: results.top.id } : undefined;
}

/** How many recent searches a library keeps. */
export const RECENT_LIMIT = 8;

/** The library's recent searches with `query` first: trimmed, once each (ignoring case), at most RECENT_LIMIT. */
export function rememberSearch(recent: readonly string[], query: string): string[] {
  const text = query.trim().replace(/\s+/g, ' ');
  if (!text) return [...recent];
  const key = normalizeQuery(text);
  return [text, ...recent.filter(item => normalizeQuery(item) !== key)].slice(0, RECENT_LIMIT);
}

export function forgetSearch(recent: readonly string[], query: string): string[] {
  const key = normalizeQuery(query);
  return recent.filter(item => normalizeQuery(item) !== key);
}

/** Recent searches as stored (a JSON list of strings); anything else reads as none. */
export function readRecent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}
