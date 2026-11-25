// Jellyfin and Emby libraries beyond movies and shows (docs/media-kinds.md): what each library
// type holds, how its items map to Vela's media classes and roles, and the audio and reading
// formats Vela plays and reads directly. Pure functions over the servers' own item shapes.
import type * as V from '../../wire';
import type { Item } from './types';
import { skipMarkers } from '../../protocol/markers';

/** What a library (a user view) holds, by its CollectionType. */
export type Shelf = 'movies' | 'shows' | 'live' | 'music' | 'books' | 'audiobooks' | 'photos' | 'musicvideos' | 'playlists' | 'boxsets' | 'mixed';

export function shelfOf(collectionType: string | undefined): Shelf {
  switch (collectionType) {
    case 'movies': return 'movies';
    case 'tvshows': return 'shows';
    case 'livetv': return 'live';
    case 'music': return 'music';
    // Jellyfin keeps audiobooks in books libraries; Emby has a library type of its own.
    case 'books': return 'books';
    case 'audiobooks': return 'audiobooks';
    // Jellyfin's "Home videos and photos" and Emby's photo libraries: albums, photos and clips.
    case 'homevideos': case 'photos': return 'photos';
    case 'musicvideos': return 'musicvideos';
    case 'playlists': return 'playlists';
    case 'boxsets': return 'boxsets';
    default: return 'mixed';
  }
}

/** How a title of a non-video library is read: an audiobook library's audio is books, not songs;
 * `group` marks the folder (Jellyfin) or album (Emby) that holds a multi-file book's parts, and
 * `parent` the book a part belongs to. */
export interface MediaHint { audiobook?: boolean; group?: boolean; parent?: { id: string; name: string };
  /** Emby counts an artist's songs and albums together: no album count is shown. */ emby?: boolean }

/** The audio item types: Jellyfin's AudioBook, both servers' Audio. */
export const isAudioItem = (i: Item) => i.Type === 'Audio' || i.Type === 'AudioBook';

/** Item types that are titles (pages and playback), as opposed to folders, albums of photos,
 * playlists and collections, which open as directories. */
export function titleProjection(i: Item, hint: MediaHint = {}): { kind: V.TitleKind; media?: V.TitleMedia } | undefined {
  switch (i.Type) {
    case 'Movie': case 'MusicVideo': case 'Video': case 'Trailer': return { kind: 'movie' };
    case 'Series': return { kind: 'show' };
    case 'Season': return { kind: 'season' };
    case 'Episode': return { kind: 'episode' };
    case 'MusicArtist': return { kind: 'show', media: { class: 'music', role: 'artist', ...count(i.AlbumCount ?? (hint.emby ? undefined : i.ChildCount)) } };
    case 'MusicAlbum':
      if (hint.audiobook) return { kind: 'show', media: { class: 'audiobook', role: 'audiobook', ...count(i.ChildCount), credits: authors(i) } };
      return { kind: 'season', media: { class: 'music', role: 'album', ...count(i.ChildCount ?? i.SongCount), ...artistOf(i) } };
    case 'Audio': case 'AudioBook':
      if (i.Type === 'AudioBook' || hint.audiobook) return hint.parent
        ? { kind: 'episode', media: { class: 'audiobook', role: 'part', ...index(i.IndexNumber), parents: [{ ...hint.parent, role: 'audiobook' }], credits: authors(i) } }
        : { kind: 'movie', media: { class: 'audiobook', role: 'audiobook', credits: authors(i) } };
      return { kind: 'episode', media: { class: 'music', role: 'track', ...index(i.IndexNumber), ...(i.ParentIndexNumber ? { disc: i.ParentIndexNumber } : {}),
        parents: [...(i.AlbumId ? [{ id: i.AlbumId, name: i.Album ?? '', role: 'album' as const }] : []), ...(albumArtist(i) ? [{ ...albumArtist(i)!, role: 'artist' as const }] : [])],
        credits: (i.ArtistItems?.length ? i.ArtistItems.map(a => a.Name) : i.Artists ?? []).map(name => ({ name, role: 'artist' })) } };
    case 'Book': {
      const format = readingFormat(i);
      return { kind: 'movie', media: { class: 'book', role: 'book', credits: authors(i), ...(format ? { reading: { format } } : {}) } };
    }
    case 'Photo': return { kind: 'movie', media: { class: 'photo', role: 'item', ...photoFacts(i.Width, i.Height) } };
    case 'Folder': return hint.group ? { kind: 'show', media: { class: 'audiobook', role: 'audiobook', ...count(i.ChildCount), credits: authors(i) } } : undefined;
    default: return undefined;
  }
}

/** A photo's size, shown as written. */
export function photoFacts(width: unknown, height: unknown): Partial<V.TitleMedia> {
  const w = Number(width), h = Number(height);
  return w > 0 && h > 0 ? { facts: [{ label: 'Size', value: `${w} × ${h}` }] } : {};
}
function count(n: number | undefined) { return n && n > 0 ? { childCount: n } : {}; }
function index(n: number | undefined) { return n && n > 0 ? { index: n } : {}; }
function albumArtist(i: Item): { id: string; name: string } | undefined {
  const artist = i.AlbumArtists?.[0] ?? i.ArtistItems?.[0];
  return artist?.Id ? { id: artist.Id, name: artist.Name } : undefined;
}
function artistOf(i: Item): Partial<V.TitleMedia> {
  const artist = albumArtist(i);
  const name = i.AlbumArtist || artist?.name;
  return { ...(artist ? { parents: [{ ...artist, role: 'artist' as const }] } : {}), ...(name ? { credits: [{ name, role: 'albumArtist' }] } : {}) };
}
/** Book and audiobook credits: People typed Author/Narrator (Jellyfin), else the album artist. */
function authors(i: Item): NonNullable<V.TitleMedia['credits']> {
  const people = (i.People ?? []).flatMap(p => {
    const role = /^author|writer$/i.test(p.Type ?? '') ? 'author' : /^narrator$/i.test(p.Type ?? '') ? 'narrator' : '';
    return role ? [{ name: p.Name, role }] : [];
  });
  if (people.some(p => p.role === 'author')) return people;
  const fallback = i.AlbumArtist || i.Artists?.[0];
  return fallback ? [{ name: fallback, role: 'author' }, ...people] : people;
}

/** A book's readable format from its file (Jellyfin omits Container on books; Emby sends it). */
export function readingFormat(i: Item): V.ReadingFormat | undefined {
  const names = [i.Container, i.MediaSources?.[0]?.Container, i.Path?.split('.').pop(), i.MediaSources?.[0]?.Path?.split('.').pop()];
  for (const name of names) {
    const value = name?.toLowerCase();
    if (value === 'epub' || value === 'pdf' || value === 'cbz') return value;
  }
  return undefined;
}
export const readingMime: Record<V.ReadingFormat, string> = { epub: 'application/epub+zip', pdf: 'application/pdf', cbz: 'application/vnd.comicbook+zip' };

/** Audio Vela plays as the file: what every platform's audio player decodes (web audio element,
 * AVPlayer, Media3). Anything else is transcoded to MP3 over progressive HTTP. */
export const DIRECT_AUDIO = ['mp3', 'm4a', 'm4b', 'mp4', 'aac', 'flac', 'wav'];
export function audioMime(container: string | undefined): string {
  const value = (container ?? '').toLowerCase().split(',')[0];
  if (value === 'mp3') return 'audio/mpeg';
  if (['m4a', 'm4b', 'mp4', 'mov', 'aac'].includes(value)) return 'audio/mp4';
  if (value === 'flac') return 'audio/flac';
  if (value === 'wav') return 'audio/wav';
  if (['ogg', 'oga', 'opus'].includes(value)) return 'audio/ogg';
  if (value === 'webm') return 'audio/webm';
  return 'audio/mpeg';
}

/**
 * A page of a books or audiobooks library with each multi-file book folded into one title: audio
 * items that share a group (Jellyfin: their folder; Emby: their album) and number more than one
 * become that group, at the position of its first part. Returns the entries in order, each either
 * an item or a group id to be read.
 */
export function foldAudiobooks(items: Item[], emby: boolean): ({ item: Item } | { group: string; parts: Item[] })[] {
  const key = (i: Item) => isAudioItem(i) ? (emby ? i.AlbumId ?? i.ParentId : i.ParentId) : undefined;
  const groups = new Map<string, Item[]>();
  for (const i of items) {
    const k = key(i);
    if (k) groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: ({ item: Item } | { group: string; parts: Item[] })[] = [];
  const placed = new Set<string>();
  for (const i of items) {
    const k = key(i);
    const parts = k ? groups.get(k)! : [];
    if (!k || parts.length < 2) out.push({ item: i });
    else if (!placed.has(k)) { placed.add(k); out.push({ group: k, parts }); }
  }
  return out;
}

/** One of Jellyfin's media segments (`/MediaSegments/{itemId}`, Jellyfin 10.10+), times in ticks. */
export interface MediaSegment { Type?: string; StartTicks?: number; EndTicks?: number }

/**
 * An item's intro and outro segments as the plan's skip markers: Intro is the intro, Outro the
 * credits (the last one, ending at the end of the title, is the tail credits). Recaps, previews
 * and commercials are not offered. Undefined when there are none.
 */
export function jellyfinMarkers(segments: readonly MediaSegment[] | undefined, durationSeconds: number | undefined): V.SkipMarker[] | undefined {
  const ranges = (segments ?? []).flatMap((s): V.SkipMarker[] => {
    const kind = s.Type === 'Intro' ? 'intro' : s.Type === 'Outro' ? 'credits' : undefined;
    return kind && typeof s.StartTicks === 'number' && typeof s.EndTicks === 'number' ? [{ kind, startSeconds: s.StartTicks / 10_000_000, endSeconds: s.EndTicks / 10_000_000 }] : [];
  });
  return skipMarkers(ranges, durationSeconds);
}
