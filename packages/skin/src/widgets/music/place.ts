// Where the music app is: Home, Search, Liked Songs, Your Library, Rewind, Playlist Import,
// Duplicate Recordings, a title (artist, album) or a playlist. It lives in the library page's
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
  | { kind: 'playlist'; id: string };

export function parsePlace(raw: string | undefined): MusicPlace {
  const value = (raw ?? '').trim();
  if (value === 'search' || value === 'liked' || value === 'library' || value === 'rewind' || value === 'import' || value === 'duplicates') {
    return { kind: value };
  }
  if (value.startsWith('title:') && value.length > 6) return { kind: 'title', id: value.slice(6) };
  if (value.startsWith('playlist:') && value.length > 9) return { kind: 'playlist', id: value.slice(9) };
  return { kind: 'home' };
}

export function placeParam(place: MusicPlace): string {
  return place.kind === 'title' || place.kind === 'playlist' ? `${place.kind}:${place.id}` : place.kind === 'home' ? '' : place.kind;
}

export function samePlace(a: MusicPlace, b: MusicPlace): boolean {
  return placeParam(a) === placeParam(b);
}
