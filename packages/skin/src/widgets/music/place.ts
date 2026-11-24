// Where the music app is: Home, Search, Liked Songs, Your Library, Rewind, Playlist Import,
// Duplicate Recordings, a title (artist, album), a playlist, or every album a search matches. It lives in the library page's
// address (`?m=`) so back, forward and links work.
export type MusicPlace =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'liked' }
  | { kind: 'library' }
  | { kind: 'rewind' }
  | { kind: 'import' }
  | { kind: 'duplicates' }
  | { kind: 'title'; id: string }
  | { kind: 'playlist'; id: string }
  /** Every album in the library matching `query`, page by page (Search's Albums "See all"). */
  | { kind: 'albums'; query: string };

export function parsePlace(raw: string | undefined): MusicPlace {
  const value = (raw ?? '').trim();
  if (value === 'search' || value === 'liked' || value === 'library' || value === 'rewind' || value === 'import' || value === 'duplicates') {
    return { kind: value };
  }
  if (value.startsWith('title:') && value.length > 6) return { kind: 'title', id: value.slice(6) };
  if (value.startsWith('playlist:') && value.length > 9) return { kind: 'playlist', id: value.slice(9) };
  if (value.startsWith('albums:') && value.slice(7).trim()) return { kind: 'albums', query: value.slice(7) };
  return { kind: 'home' };
}

export function placeParam(place: MusicPlace): string {
  if (place.kind === 'albums') return `albums:${place.query}`;
  return place.kind === 'title' || place.kind === 'playlist' ? `${place.kind}:${place.id}` : place.kind === 'home' ? '' : place.kind;
}

export function samePlace(a: MusicPlace, b: MusicPlace): boolean {
  return placeParam(a) === placeParam(b);
}
