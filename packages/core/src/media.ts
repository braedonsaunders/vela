// Media classes beyond video (docs/media-kinds.md): a title's class, role and relations as the
// app reads them. Everything here is derived from the wire's optional `media` block; a title
// without one is video and keeps every existing behaviour.
import type * as V from './wire';
import type { Card } from './models';
import { clock, minute, msg, number, percent, plural } from './i18n';
import { childCountsLine, childCountsOf } from './plugin-levels';
import { loudnessOf } from './audio/sound';

const CLASSES: V.MediaClass[] = ['video', 'music', 'audiobook', 'book', 'podcast', 'photo'];
const ROLES: V.MediaRole[] = ['item', 'artist', 'album', 'track', 'series', 'book', 'audiobook', 'part', 'show', 'episode', 'collection'];

/** An unknown class reads as video, an unknown role as item (the contract's forward rule). */
export function mediaClass(value: unknown): V.MediaClass {
  return CLASSES.includes(value as V.MediaClass) ? value as V.MediaClass : 'video';
}
export function mediaRole(value: unknown): V.MediaRole {
  return ROLES.includes(value as V.MediaRole) ? value as V.MediaRole : 'item';
}

/** How a card's cover is drawn: '' follows the row or library; the rest are media covers. */
export type CardShape = '' | 'square' | 'round' | 'book';

export interface MediaParent { id: string; name: string; role: V.MediaRole }
export interface MediaCredit { name: string; role: string; personId: string }

/** A media title's display facts. Present only on titles that carry a non-video `media` block. */
export interface CardMedia {
  class: V.MediaClass;
  role: V.MediaRole;
  shape: CardShape;
  /** Track number, book number in a series, part number; 0 when none. */
  index: number;
  disc: number;
  /** Shared recording identifier (ISRC or recording fingerprint) across releases (features.duplicates). */
  recordingId?: string;
  /** The main credit: an album's or track's artist, a book's author ('' when none). */
  byline: string;
  /** Where the byline opens: a person id (`person:`) or a parent title id (`title:`), '' for nothing. */
  bylineTarget: string;
  narrator: string;
  /** The nearest parent: a track's album, a book's series. */
  parent?: MediaParent;
  parents: MediaParent[];
  credits: MediaCredit[];
  childCount: number;
  /** Children per child level (features.pluginLevels): an artist's { album: 4, concert: 2 }; {} when unknown. */
  childCounts: Record<string, number>;
  /** A readable title's format ('' when it cannot be read). */
  readingFormat: '' | V.ReadingFormat;
  pages: number;
  /** Reading progress, 0 to 1, with the server's opaque locator. */
  readingFraction: number;
  readingLocator: string;
  readingLabel: string;
  facts: { label: string; value: string }[];
  /** Plays as audio: tracks, audiobooks, parts and podcast episodes. */
  audio: boolean;
  /** A track's loudness (features.loudness), when measured or hinted. */
  loudness?: V.Loudness;
  /** Beats per minute, when the provider knows it. */
  bpm?: number;
  /** "Track 3", "Book 2", "Part 1" ('' when unnumbered). */
  indexLabel: string;
  /** A track's length as m:ss ('' when unknown). */
  clockLabel: string;
}

const BYLINE_ROLES = ['artist', 'albumArtist', 'author', 'host'];

export function shapeOf(cls: V.MediaClass, role: V.MediaRole): CardShape {
  if (role === 'artist') return 'round';
  if (role === 'book' || role === 'series') return cls === 'audiobook' ? 'square' : 'book';
  if (cls === 'book') return 'book';
  // Photos are of every shape: a square tile crops each evenly, as a gallery does.
  if (cls === 'music' || cls === 'audiobook' || cls === 'podcast' || cls === 'photo') return 'square';
  return '';
}

export function isAudioRole(cls: V.MediaClass, role: V.MediaRole): boolean {
  return role === 'track' || role === 'audiobook' || role === 'part' || (cls === 'podcast' && (role === 'episode' || role === 'item'))
    || (cls === 'audiobook' && role === 'item') || (cls === 'music' && role === 'item');
}

/** A plugin video title's own role (a concert), '' for ordinary video and every other title. */
export function videoRole(title: V.Title): string {
  const media = title.media;
  if (!media || mediaClass(media.class) !== 'video' || typeof media.role !== 'string') return '';
  const role = media.role.trim();
  return role === 'item' ? '' : role;
}

/** A video title's container chain (a concert's artist), nearest first; [] for any other title.
 * Video titles have no CardMedia, so this is how their page links back to the container. */
export function videoParents(title: V.Title): MediaParent[] {
  const media = title.media;
  if (!media || mediaClass(media.class) !== 'video') return [];
  return (media.parents ?? []).filter(p => p && typeof p.id === 'string' && p.id && typeof p.name === 'string' && p.name)
    .map(p => ({ id: p.id, name: p.name, role: mediaRole(p.role) }));
}

/** The media facts of a title, or undefined for video (and titles from servers without media). */
export function cardMedia(title: V.Title): CardMedia | undefined {
  const media = title.media;
  if (!media) return undefined;
  const cls = mediaClass(media.class);
  if (cls === 'video') return undefined;
  const role = mediaRole(media.role);
  const parents = (media.parents ?? []).filter(p => p && typeof p.id === 'string').map(p => ({ id: p.id, name: p.name ?? '', role: mediaRole(p.role) }));
  const credits = (media.credits ?? []).filter(c => c && typeof c.name === 'string').map(c => ({ name: c.name, role: String(c.role ?? ''), personId: c.personId ?? '' }));
  const lead = BYLINE_ROLES.map(r => credits.find(c => c.role === r)).find(Boolean);
  const artistParent = parents.find(p => p.role === 'artist');
  const byline = lead?.name ?? artistParent?.name ?? '';
  const bylineTarget = lead?.personId ? `person:${lead.personId}` : artistParent && (!lead || lead.name === artistParent.name) ? `title:${artistParent.id}` : '';
  const reading = title.watch?.reading;
  const fraction = reading && Number.isFinite(reading.fraction) ? Math.min(1, Math.max(0, reading.fraction)) : 0;
  const index = positive(media.index);
  const format = media.reading?.format;
  const recordingId = typeof media.recordingId === 'string' && media.recordingId.trim() ? media.recordingId.trim() : undefined;
  const loudness = loudnessOf(media.loudness);
  return {
    class: cls,
    role,
    shape: shapeOf(cls, role),
    index,
    disc: positive(media.disc),
    ...(recordingId ? { recordingId } : {}),
    byline,
    bylineTarget,
    narrator: credits.filter(c => c.role === 'narrator').map(c => c.name).join(', '),
    parent: parents[0],
    parents,
    credits,
    childCount: positive(media.childCount),
    childCounts: childCountsOf(media.childCounts),
    readingFormat: format === 'epub' || format === 'pdf' || format === 'cbz' ? format : '',
    pages: positive(media.reading?.pages),
    readingFraction: fraction,
    readingLocator: reading?.locator ?? '',
    readingLabel: reading?.label ?? '',
    facts: (media.facts ?? []).filter(f => f && f.label && f.value).map(f => ({ label: f.label, value: f.value })),
    audio: isAudioRole(cls, role),
    indexLabel: index ? msg(`media.index.${role === 'book' ? 'book' : role === 'part' ? 'part' : role === 'track' ? 'track' : 'item'}`, { index: number(index) }) : '',
    clockLabel: title.durationSeconds ? clock(title.durationSeconds) : '',
    ...(loudness ? { loudness } : {}),
    ...(typeof media.bpm === 'number' && media.bpm > 0 && media.bpm < 400 ? { bpm: media.bpm } : {}),
  };
}

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** A media card's one-line facts: what a viewer scans a shelf for. */
export function mediaFacts(media: CardMedia, title: V.Title): string {
  const year = title.year ? number(title.year, { useGrouping: false }) : '';
  const count = (key: string) => media.childCount ? msg(`media.count.${key}.${plural(media.childCount)}`, { count: number(media.childCount) }) : '';
  const hours = title.durationSeconds ? durationLabel(title.durationSeconds) : '';
  switch (media.role) {
    // Albums and concerts apart when the server counts each child level (features.pluginLevels).
    case 'artist': return Object.keys(media.childCounts).length ? childCountsLine(media.childCounts) : count('albums');
    case 'album': return [year, count('tracks')].filter(Boolean).join(' · ');
    case 'track': return [media.parent?.name, media.clockLabel].filter(Boolean).join(' · ');
    case 'series': return count('books');
    case 'book': return [media.readingFraction > 0 && media.readingFraction < 0.98 ? msg('media.readPercent', { percent: percent(media.readingFraction) }) : year,
      media.pages ? msg(`media.pages.${plural(media.pages)}`, { count: number(media.pages) }) : ''].filter(Boolean).join(' · ');
    case 'audiobook': return [year, hours].filter(Boolean).join(' · ');
    case 'show': return media.class === 'podcast' ? count('episodes') || year : [year, hours].filter(Boolean).join(' · ');
    // A part names its book: on a shelf it may stand alone (Continue listening).
    case 'part': return [media.parent?.name, media.indexLabel, hours].filter(Boolean).join(' · ');
    default: return [year, hours].filter(Boolean).join(' · ');
  }
}

/** "9 h 41 min", "42 min": a long listen's length. */
export function durationLabel(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60), minutes = total % 60;
  if (!hours) return minute(minutes);
  return msg('media.hoursMinutes', { hours: number(hours), minutes: number(minutes) });
}

/** A media title's card kind: its role, so presses route to media pages rather than video ones.
 * Photos and podcasts have kinds of their own: a photo is any role of the photo class, and a
 * podcast's show and episodes would otherwise share video's 'show' and 'episode' and open the
 * video title page. */
export function mediaCardKind(media: CardMedia | undefined, fallback: string): string {
  if (!media) return fallback;
  if (media.class === 'photo') return 'photo';
  if (media.class === 'podcast' && media.role === 'show') return 'podcast';
  if (media.class === 'podcast' && (media.role === 'episode' || media.role === 'item')) return 'podcastEpisode';
  return media.role !== 'item' ? media.role : fallback;
}

/** Roles that open a purpose-built media page instead of the document's title page. */
export const MEDIA_PAGE_ROLES: readonly V.MediaRole[] = ['artist', 'album', 'series', 'book', 'audiobook', 'show'];

/** Card kinds (mediaCardKind) that open a media page. A video show keeps the kind 'show' and its
 * document's title page; a podcast's show is 'podcast'. */
export const MEDIA_PAGE_KINDS: readonly string[] = ['artist', 'album', 'track', 'series', 'book', 'audiobook', 'part', 'photo', 'podcast', 'podcastEpisode'];

export function opensMediaPage(kind: string): boolean {
  return MEDIA_PAGE_KINDS.includes(kind);
}

/** A podcast's episodes newest first: by date (or year), then by number. */
export function podcastOrder(episodes: Card[]): Card[] {
  const day = (card: Card) => /^\d{4}-\d{2}-\d{2}/.test(card.airDate) ? card.airDate.slice(0, 10) : card.year ? `${String(card.year).padStart(4, '0')}-00-00` : '';
  return [...episodes].sort((a, b) => day(b).localeCompare(day(a)) || (b.media?.index ?? 0) - (a.media?.index ?? 0));
}
