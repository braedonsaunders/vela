// Apple TV's Top Shelf (README.md): the pure rules. Home's Continue Watching row becomes a small,
// bounded snapshot the TV Services extension reads from the App Group, the snapshot follows the
// signed-in viewer, and a Top Shelf link resumes only for the viewer it was written for.
//
// The snapshot never holds an artwork URL: a native server's image URLs can carry a transient
// credential that is never persisted. The app downloads each picture (`downloads`, kept in memory
// only) into the App Group, and the snapshot names the file.

/** The snapshot's format; the extension shows nothing it does not understand. */
export const TOP_SHELF_VERSION = 1;
/** At most this many items: the Top Shelf shows about five at a time. */
export const TOP_SHELF_LIMIT = 10;
/** The app route a Top Shelf item opens (app/resume/[id].tsx). */
export const TOP_SHELF_ROUTE = 'resume';
const SCHEME = 'vela';
const MAX_TITLE = 120;
const MAX_ID = 200;

/** The parts of a Home card the shelf reads (structurally @vela/core's Card). */
export interface ShelfCard {
  id: string;
  kind: string;
  name: string;
  /** An episode's show ('' when the server did not say). */
  showName: string;
  /** An episode's show and number ("Show · Season 1, Episode 3"), without the show when unknown. */
  episodeContext: string;
  durationSeconds: number;
  progressSeconds: number;
  thumbnail?: string;
  backdrop: string;
  poster: string;
  /** Music, book and audiobook facts: present means the card is not video. */
  media?: unknown;
}

/** The parts of a Home row the shelf reads (structurally @vela/core's Row). */
export interface ShelfRow {
  purpose: string;
  name: string;
  items: ShelfCard[];
}

export interface TopShelfItem {
  id: string;
  /** The line under the picture: an episode's show and number, else the title's name. */
  title: string;
  /** The picture's file in the App Group's Top Shelf folder. */
  image: string;
  /** `wide` (a still or backdrop, 16:9) or `poster` (2:3) when the title has nothing wider. */
  shape: 'wide' | 'poster';
  /** How far in, 0 to 1 (0: not started, for a next episode). */
  progress: number;
  /** Opens the app and resumes the title for this snapshot's viewer. */
  link: string;
}

export interface TopShelfSnapshot {
  version: typeof TOP_SHELF_VERSION;
  /** Whose shelf this is (topShelfOwner): a link carries it back to the app. */
  owner: string;
  /** The section's heading: the server's own name for the row ("Continue Watching"). */
  title: string;
  items: TopShelfItem[];
}

/** A picture to fetch into the App Group. The URL stays in memory and is never written down. */
export interface TopShelfDownload {
  file: string;
  url: string;
}

export interface TopShelfPublication {
  snapshot: TopShelfSnapshot;
  downloads: TopShelfDownload[];
}

/** FNV-1a, 32 bits, as eight hex digits. Identifies; never protects. */
function fnv(text: string, seed = 0x811c9dc5): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
const digest = (text: string) => fnv(text) + fnv(text, 0x01000193);

/** The viewer a shelf belongs to: one server's one signed-in viewer (a Plex Home profile is its own). */
export function topShelfOwner(serverId: string, viewerId: string): string {
  return serverId && viewerId ? digest(`${serverId}\n${viewerId}`) : '';
}

/** The app link a Top Shelf item opens: `vela://resume/<title>?owner=<owner>`. */
export function topShelfLink(titleId: string, owner: string): string {
  return `${SCHEME}://${TOP_SHELF_ROUTE}/${encodeURIComponent(titleId)}?owner=${encodeURIComponent(owner)}`;
}

/** Kinds that never play from Continue Watching. */
const NOT_PLAYABLE = new Set(['collection', 'playlist', 'directory', 'channel', 'person', 'show', 'season']);
const isVideo = (card: ShelfCard) => card.media === undefined && !NOT_PLAYABLE.has(card.kind);
const clip = (text: string) => (text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text);

/** A card's landscape picture (an episode's still, a film's backdrop), else its poster. */
function picture(card: ShelfCard): { url: string; identity: string; shape: TopShelfItem['shape'] } | null {
  for (const [source, shape] of [[card.thumbnail, 'wide'], [card.backdrop, 'wide'], [card.poster, 'poster']] as const) {
    if (!source) continue;
    try {
      const url = new URL(source);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      // Plex re-signs the same transcode URL as its delegated token rotates. Keep the
      // actual image path, sizing and version parameters in the cache identity.
      url.searchParams.delete('X-Plex-Token');
      return { url: source, identity: url.href, shape };
    } catch { /* A malformed image URL leaves the next artwork choice available. */ }
  }
  return null;
}

/** The line under a card: an episode's show and number; without its show (Ether's Continue
 * Watching leaves it out), its own name and number. A film, its name. */
function shelfTitle(card: ShelfCard): string {
  if (card.kind !== 'episode' || !card.episodeContext) return card.name || card.episodeContext;
  return card.showName ? card.episodeContext : [card.name, card.episodeContext].filter(Boolean).join(' · ');
}

/**
 * The shelf for Home's rows: the video titles of the first Continue Watching row that has any
 * (a Continue Reading or Listening row is skipped), at most TOP_SHELF_LIMIT, each with a picture.
 * Null when there is nothing to show or no viewer to show it for: the Top Shelf keeps its artwork.
 */
export function topShelfPublication(rows: readonly ShelfRow[] | undefined, owner: string): TopShelfPublication | null {
  if (!owner || !rows) return null;
  for (const row of rows) {
    if (row.purpose !== 'continue') continue;
    const publication = rowPublication(row, owner);
    if (publication) return publication;
  }
  return null;
}

function rowPublication(row: ShelfRow, owner: string): TopShelfPublication | null {
  const items: TopShelfItem[] = [];
  const downloads: TopShelfDownload[] = [];
  const seen = new Set<string>();
  for (const card of row.items) {
    if (items.length === TOP_SHELF_LIMIT) break;
    if (!isVideo(card) || !card.id || card.id.length > MAX_ID || seen.has(card.id)) continue;
    const art = picture(card);
    if (!art) continue;
    seen.add(card.id);
    const file = `${digest(`${owner}\n${card.id}\n${art.identity}`)}.jpg`;
    const progress = card.durationSeconds > 0 && Number.isFinite(card.progressSeconds) ? Math.min(1, Math.max(0, card.progressSeconds / card.durationSeconds)) : 0;
    items.push({
      id: card.id,
      title: clip(shelfTitle(card)),
      image: file,
      shape: art.shape,
      progress: Math.round(progress * 1000) / 1000,
      link: topShelfLink(card.id, owner),
    });
    downloads.push({ file, url: art.url });
  }
  if (!items.length) return null;
  return { snapshot: { version: TOP_SHELF_VERSION, owner, title: clip(row.name), items }, downloads };
}

/** Where the app writes the shelf (index.ts on tvOS). Calls carry a rising sequence: a call that
 * arrives after a later one is dropped, so the previous viewer's late write never lands. */
export interface TopShelfWriter {
  publish(sequence: number, snapshot: string, downloads: TopShelfDownload[]): Promise<void>;
  clear(sequence: number): Promise<void>;
}

export interface TopShelfInput {
  phase: string;
  owner: string;
  /** Moves on with every session change (auth.revision). */
  revision: number;
  /** Home's rows; undefined while Home is unread. */
  rows: readonly ShelfRow[] | undefined;
}

/**
 * Keeps the App Group's shelf in step with the session. Signing out clears it, and so does a new
 * viewer (a server switch, a Plex Home profile) until their own Home is read. Rows first seen
 * under an earlier session are the previous viewer's and are never written for the new one.
 * Unchanged shelves are not written again (a picture re-signed for the same title is not news).
 */
export class TopShelfSync {
  private sequence = 0;
  /** What the App Group holds: unknown at launch (the last run's shelf, kept while Home loads). */
  private written: { owner: string; key: string } | 'cleared' | null = null;
  private readonly rowsRevision = new WeakMap<object, number>();

  constructor(private readonly writer: TopShelfWriter, private readonly warn: (error: unknown) => void = () => {}) {}

  update({ phase, owner, revision, rows }: TopShelfInput): void {
    if (rows && !this.rowsRevision.has(rows)) this.rowsRevision.set(rows, revision);
    if (phase === 'signed-out') return this.clear();
    // Starting, restoring or offline: the shelf stays as it is.
    if (phase !== 'signed-in' || !owner) return;
    const current = rows && this.rowsRevision.get(rows) === revision ? rows : undefined;
    if (!current) {
      if (this.written && this.written !== 'cleared' && this.written.owner !== owner) this.clear();
      return;
    }
    const publication = topShelfPublication(current, owner);
    if (!publication) return this.clear();
    const key = JSON.stringify(publication.snapshot);
    if (this.written !== null && this.written !== 'cleared' && this.written.key === key) return;
    this.written = { owner, key };
    const sequence = ++this.sequence;
    this.writer.publish(sequence, key, publication.downloads).catch(error => {
      if (this.sequence === sequence) this.written = { owner, key: '' };
      this.warn(error);
    });
  }

  private clear(): void {
    if (this.written === 'cleared') return;
    this.written = 'cleared';
    const sequence = ++this.sequence;
    this.writer.clear(sequence).catch(error => {
      if (this.sequence === sequence) this.written = null;
      this.warn(error);
    });
  }
}

/** What a Top Shelf link does once the session has settled. */
export type TopShelfLinkAction = 'wait' | 'resume' | 'home';

/**
 * A link resumes only for the viewer whose shelf it came from: the same server and viewer. Any
 * other signed-in viewer goes to their Home. Until the session settles, wait; a signed-out or
 * offline session is sent to sign in by the app's gate.
 */
export function topShelfLinkAction(phase: string, currentOwner: string, linkOwner: string | undefined): TopShelfLinkAction {
  if (phase !== 'signed-in') return 'wait';
  return linkOwner && currentOwner && linkOwner === currentOwner ? 'resume' : 'home';
}
