// Vela's own sources and actions (docs/experiences.md: "Sources for Vela's own pages"): the
// `vela.*` names a page document may read (`sources.<name>.from`) and press (`press: {action:
// "plugin", args: {name: "vela.like", …}}`). Core answers them on the device through the active
// server adapter (Ether, Jellyfin, Plex), with the same answer shapes as plugin data and plugin
// actions; Ether never resolves them (it accepts these names only, skips them in data reads, and in
// a plugin document allows only `{context.*}` holes in their arguments). The list is data so the
// generated schema can publish it ($defs.VelaSources, $defs.VelaActions) and Ether re-vendors it.
//
// Values use the `{$record}` model: a list holds `{ "$record": "item:<id>" }` references into the
// shared record pool. `item:` and `channel:` records are the server's titles and channels (an
// `item:` value is core's `Card`); `queue:`, `nowPlaying:`, `import:` and `setting:` records are
// the device's own and never leave it. A source the active adapter cannot answer reads
// `errors.<source> = { code: "unsupported" }` and the document hides that part.
import type { RecordRef } from './screen';

/** The kind of one argument, as written in a document (every value arrives as text and is parsed). */
export interface VelaArgSpec {
  type: 'string' | 'ref' | 'int' | 'bool' | 'enum';
  required?: boolean;
  enum?: readonly string[];
  doc?: string;
}

export interface VelaSourceSpec {
  args: Record<string, VelaArgSpec>;
  /** Updated in place while a page reads it (a record pushed by core, not a re-read). */
  live?: boolean;
  doc: string;
}

export interface VelaActionSpec {
  args: Record<string, VelaArgSpec>;
  doc: string;
}

const id = (doc: string, required = true): VelaArgSpec => ({ type: 'string', required, doc });
const ref = (doc: string, required = true): VelaArgSpec => ({ type: 'ref', required, doc });

/** The published `vela.*` sources (versioned with RENDERER_VERSION; additions only within a version). */
export const VELA_SOURCES = {
  'vela.title': {
    args: { id: id('A title id (an `item:` key is accepted too).') },
    doc: 'One title: TitleValue. Its `item:` record carries the card; the source adds what only a detail read knows.',
  },
  'vela.children': {
    args: { id: id('The parent title.'), role: { type: 'string', doc: 'One child level (album, track, concert); every child when absent.' } },
    doc: "A title's children in the server's order, paged: ListValue.",
  },
  'vela.rows': {
    args: {
      placement: { type: 'enum', required: true, enum: ['home', 'title', 'library'], doc: "Home's rows, a title's related rows, or a library's recommended rows." },
      titleId: id('placement title: the title.', false),
      libraryId: id('placement library: the library.', false),
      tab: id("placement library: a recommended tab's own rows.", false),
    },
    doc: 'Rows of items: RowsValue.',
  },
  'vela.library': {
    args: {
      id: id('The library.'),
      sort: id('A sort the library offers (title, added, year, …).', false),
      direction: { type: 'enum', enum: ['asc', 'desc'] },
      kind: id('A kind filter.', false),
      genre: id('A genre filter.', false),
      played: { type: 'enum', enum: ['true', 'false', ''] },
      favorite: { type: 'bool' },
      year: { type: 'int' },
      q: id('Search within the library.', false),
      tab: id('One of the library\'s tabs (its album view, say).', false),
      limit: { type: 'int', doc: 'Titles per page (1 to 100; the server\'s default when absent).' },
      view: { type: 'enum', enum: ['albums'], doc: "A named view: `albums`, the library's searchable album view (with q; unsupported where the library has none)." },
    },
    doc: 'A library listing, paged: ListValue.',
  },
  'vela.favorites': {
    args: { role: id('track, album, artist, …'), class: id('A media class (music, audiobook, podcast).', false), library: id("Where the server keeps no liked lists or Favorites playlist (Jellyfin, Plex): the library whose favourite filter lists them.", false) },
    doc: "The viewer's likes of one role, newest first, paged: ListValue.",
  },
  'vela.playlists': { args: {}, doc: "The viewer's playlists as `item:` records of kind playlist: ListValue." },
  'vela.playlist': { args: { id: id('The playlist.'), audio: { type: 'bool', doc: 'Only entries that play as audio (items, entryIds and total together).' } }, doc: 'One playlist and its entries: PlaylistValue.' },
  'vela.recent': { args: {}, doc: 'What the viewer last played from: RecentValue.' },
  'vela.search': {
    args: { q: id('The query; empty answers no items.', false), kind: id('A result kind the server offers (searchKinds).', false), library: id('Search within one library (its media class when the server cannot scope).', false) },
    doc: "Search results, paged: SearchValue (the audio app's search).",
  },
  'vela.musicHome': { args: { library: id('The music library.') }, doc: "The music app's Home: MusicHomeValue (quick tiles, Vela's own recent shelves, the library's rows)." },
  'vela.libraryInfo': { args: { id: id('The library.') }, doc: 'What a library holds and what the server offers for it: LibraryInfoValue.' },
  'vela.viewer': { args: {}, doc: 'The signed-in viewer: ViewerValue.' },
  'vela.queue': { args: {}, live: true, doc: 'The audio queue: a reference to the `queue:current` record (QueueRecord).' },
  'vela.nowPlaying': { args: {}, live: true, doc: 'What plays now: a reference to `nowPlaying:current` (NowPlayingRecord), pushed about once a second while a page reads it.' },
  'vela.lyrics': { args: { id: id('The track.'), translate: id('A language to translate into, when the server offers it.', false) }, doc: 'LyricsValue.' },
  'vela.guide': { args: { day: { type: 'int', doc: 'Days from today (0 when absent; the guide reaches a week ahead).' } }, doc: 'One day of the Live TV guide: GuideValue, channels as `channel:` records.' },
  'vela.readingProgress': { args: { id: id('The readable title.') }, doc: 'ReadingProgressValue.' },
  'vela.recap': {
    args: { period: { type: 'enum', required: true, enum: ['week', 'month', 'year', 'all'] }, at: id('An anchor date (YYYY-MM-DD).', false), library: id('One library.', false) },
    doc: 'A listening recap (Rewind): RecapValue.',
  },
  'vela.duplicates': { args: { libraryId: id('The library.') }, doc: 'Duplicate recording groups, paged: DuplicatesValue.' },
  'vela.recording': { args: { id: id('A title (track).') }, doc: "Every release of the title's recording: RecordingValue." },
  'vela.import': { args: {}, live: true, doc: 'The playlist import in progress: a reference to `import:current` (ImportRecord).' },
  'vela.visualizer': { args: {}, live: true, doc: "The viewer's visualizer setting on this device: a reference to `setting:visualizer` (VisualizerSetting)." },
} as const satisfies Record<string, VelaSourceSpec>;

/** The published local actions, pressed as `{action: "plugin", args: {name, …}}` and answered by
 * core with the plugin action answer (`ScreenActionAnswer`: records, sources, refresh, toast). */
export const VELA_ACTIONS = {
  'vela.play': {
    args: {
      item: ref('The item to start at (`item:` key or id); the first of the context when absent.', false),
      context: id('What to play through: the name of a list source on this page, or an `item:` container (album, artist, playlist, show).', false),
      shuffle: { type: 'bool' },
    },
    doc: 'Play an item, a container, or a list on this page from an item.',
  },
  'vela.playNext': { args: { item: ref('An item or container.') }, doc: 'Queue to play after the current item.' },
  'vela.addToQueue': { args: { item: ref('An item or container.') }, doc: 'Queue at the end.' },
  'vela.startRadio': { args: { item: ref('The seed.') }, doc: 'Play the seed, then what the server continues it with.' },
  'vela.like': { args: { item: ref('The title.'), on: { type: 'bool', required: true } }, doc: 'Like or unlike (follow, save) a title. The answer patches the item record and refreshes favorites lists on the page.' },
  'vela.more': { args: { source: id('A list source on this page.') }, doc: "Read the next page of a list source (appended to its items)." },
  'vela.playlistImport': {
    args: { library: id('The library the playlist is for.'), url: id('A link to a playlist on an advertised source.', false), name: id('A file name (with text).', false), format: { type: 'enum', enum: ['m3u', 'csv'] }, text: id('The file text (with name and format).', false) },
    doc: 'Start a playlist import; its progress is polled into the `import:current` record.',
  },
  'vela.playlistImportSave': {
    args: { name: id('A new name.', false), exclude: id('Comma-separated matched indices to leave out.', false), choose: id('`index=titleId` pairs, comma-separated, for ambiguous matches.', false) },
    doc: 'Save the finished import as a playlist; navigates to it.',
  },
  'vela.playlistImportReset': { args: {}, doc: 'Forget the import (start again).' },
  'vela.duplicatePreference': {
    args: { libraryId: id('The library.'), recordingId: id('The recording.'), preferred: ref('The release to keep.'), hideOthers: { type: 'bool' } },
    doc: 'Choose the preferred release of a recording, optionally hiding the others.',
  },
  'vela.setVisualizerScene': { args: { id: id('A scene id, or "off".') }, doc: "The viewer's visualizer scene on this device (per profile, not synced)." },
} as const satisfies Record<string, VelaActionSpec>;

export type VelaSourceName = keyof typeof VELA_SOURCES;
export type VelaActionName = keyof typeof VELA_ACTIONS;

/** Record key prefixes core writes for `vela.*` sources; the last four never leave the device. */
export const VELA_RECORD_PREFIXES = ['item:', 'channel:', 'queue:', 'nowPlaying:', 'import:', 'setting:'] as const;
export const VELA_LOCAL_RECORDS = { queue: 'queue:current', nowPlaying: 'nowPlaying:current', import: 'import:current', visualizer: 'setting:visualizer' } as const;

export const isVelaSource = (from: unknown): from is VelaSourceName => typeof from === 'string' && Object.prototype.hasOwnProperty.call(VELA_SOURCES, from);
export const isVelaAction = (name: unknown): name is VelaActionName => typeof name === 'string' && Object.prototype.hasOwnProperty.call(VELA_ACTIONS, name);

// Values (what `{src.<name>.…}` reads)

/** Every paged list. */
export interface ListValue { items: RecordRef[]; more: boolean; total?: number }

export interface TitleValue {
  item: RecordRef;
  canPlay: boolean;
  resumeSeconds: number;
  /** Format, quality and runtime facts ("FLAC · 24-bit"). */
  mediaFacts: string[];
  /** A playable title's chapters (an audiobook's). */
  chapters: { id: string; name: string; startSeconds: number; endSeconds?: number }[];
  /** Children per role as the card counts them, for "4 albums". */
  childCounts: Record<string, number>;
}

export interface RowValue {
  id: string;
  key?: string;
  name: string;
  purpose: string;
  layout: string;
  presentation: string;
  role?: string;
  items: RecordRef[];
  more: boolean;
  /** A row a plugin surface draws (no items of its own). */
  surface?: string;
  plugin?: string;
}
export interface RowsValue { rows: RowValue[] }

/** One quick tile on music Home: an item, Liked Songs (with its track count) or Rewind. */
export type MusicQuickTile = { kind: 'item'; item: RecordRef } | { kind: 'liked'; total: number } | { kind: 'rewind' };

/** `vela.musicHome`: what today's music Home draws, decided here so the document only lays it out. */
export interface MusicHomeValue {
  /** At most 8: Liked Songs, Rewind, what was played from most recently, the playlists, then Jump back in; each item once. */
  quick: MusicQuickTile[];
  /** Vela's own Recently played shelf (empty when the library's rows carry their own). */
  recent: RecordRef[];
  /** An older server's Jump back in row. */
  jump: RecordRef[];
  /** The library's rows drawn as shelves, in page order. `songs`: every item is a track, kept one per album
   *  (a `tracks` layout row keeps every track and is drawn as a track list). */
  shelves: (RowValue & { songs: boolean })[];
  /** The first quick item's accent, for the page's wash ('' when none). */
  accent: string;
}

/** `vela.libraryInfo`: a library and the music features the server offers (pages branch on these). */
export interface LibraryInfoValue {
  id: string;
  name: string;
  kind: string;
  /** The library's media class ('video' for servers without classes). */
  media: string;
  /** How it opens: watch, listen, read, gallery, live (or an id this app does not know). */
  experience: string;
  /** What the listen experience draws it as: music, audiobook, podcast, or audio (mixed). */
  listening: 'music' | 'audiobook' | 'podcast' | 'audio';
  /** The library's tabs (its album view, say), as the server declares them. */
  tabs: { id: string; label: string; kind: string; level?: string }[];
  features: {
    /** Likes listed by role (else the Favorites playlist). */
    likedByRole: boolean;
    playlists: boolean;
    recent: boolean;
    lyrics: boolean;
    recap: boolean;
    recapPeriods: string[];
    playlistImport: boolean;
    duplicates: boolean;
    loudness: boolean;
  };
}

/** `vela.viewer`. */
export interface ViewerValue { id: string; name: string; avatar: string }

export interface PlaylistValue extends ListValue {
  playlist: RecordRef;
  /** Parallel to `items`: each entry's id (one track may be listed twice). */
  entryIds: string[];
  smart: boolean;
  summary: string;
}

export interface RecentValue {
  items: ({ kind: 'title' | 'playlist'; item: RecordRef; playedAt: string } | { kind: 'favorites'; role: string; playedAt: string })[];
}

/** `queue:current`. */
export interface QueueRecord {
  /** Every item in play order (shuffled when shuffle is on). */
  items: RecordRef[];
  /** Where playback is in `items`, -1 when nothing is queued. */
  at: number;
  current: RecordRef | null;
  /** What plays after the current item: queued (Play next, Add to queue), then the source's, then autoplay's. */
  queued: RecordRef[];
  next: RecordRef[];
  autoplay: RecordRef[];
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  source: { id: string; name: string; kind: string } | null;
}

/** `nowPlaying:current`. Positions are whole seconds (it changes about once a second). */
export interface NowPlayingRecord {
  item: RecordRef | null;
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'failed';
  playing: boolean;
  position: number;
  duration: number;
  /** 0..1 */
  progress: number;
  rate: number;
  volume: number;
  muted: boolean;
  error: string;
  sleep: { mode: string; endsAt: number };
}

/** One lyrics line; word timing, translation and romanisation when the server sends them. */
export interface LyricsLine {
  startMs: number;
  endMs?: number;
  text: string;
  words?: { startMs: number; endMs?: number; text: string }[];
  translation?: string;
  romanised?: string;
}

export interface LyricsValue {
  /** Synced lines (startMs) or plain lines (startMs -1). */
  lines: LyricsLine[];
  synced: boolean;
  plain: string;
  instrumental: boolean;
  source: string;
  /** The title has no lyrics. */
  none: boolean;
}

/** `vela.search`: the server's ranked list, with the best match and the list by role. */
export interface SearchValue extends ListValue {
  q: string;
  /** The list is a description match (no title was named). */
  byDescription: boolean;
  /** An exact name match (containers first), else the server's first. */
  top: RecordRef | null;
  /** `items` by media role (track, album, artist, playlist, audiobook, …), in the server's order. */
  groups: Record<string, RecordRef[]>;
}

/** `vela.guide`: a `channel:` record holds the channel, what it airs now and next, and the day's programmes. */
export interface GuideValue {
  channels: RecordRef[];
  day: number;
  dayLabel: string;
  /** Minutes from the day's timeline start to now, and the timeline's length. */
  nowMinute: number;
  minutes: number;
  days: { offset: number; label: string; date: string }[];
  /** The owner's named Guides (tabs). */
  guides: { id: string; name: string }[];
}

export interface ReadingProgressValue { fraction: number; locator: string; label: string }

export interface RecapEntryValue { item: RecordRef; plays: number; minutes: number }
export interface RecapValue {
  period: string; from: string; to: string; minutes: number; plays: number;
  distinctTracks: number; distinctArtists: number;
  topArtists: RecapEntryValue[]; topTracks: RecapEntryValue[]; topAlbums: RecapEntryValue[];
  streak: { current: number; longest: number };
  byDay: { date: string; minutes: number }[];
  firstPlayAt?: string; generatedAt: string;
}

export interface DuplicateGroupValue { recordingId: string; count: number; items: RecordRef[]; preferred: RecordRef | null }
export interface DuplicatesValue { groups: DuplicateGroupValue[]; more: boolean }
export interface RecordingValue { recordingId: string; items: RecordRef[]; preferred: RecordRef | null }

/** `import:current`. `state` idle before an import starts. */
export interface ImportRecord {
  state: 'idle' | 'starting' | 'reading' | 'matching' | 'done' | 'failed';
  id: string;
  name: string;
  description: string;
  poster: string;
  total: number;
  done: number;
  /** 0..1 */
  progress: number;
  matched: { index: number; item: RecordRef; by: 'isrc' | 'title'; source: { title: string; artist: string; album?: string } }[];
  unmatched: { index: number; reason: 'not_found' | 'ambiguous'; source: { title: string; artist: string; album?: string }; candidates: RecordRef[] }[];
  error: string;
  truncated: boolean;
  sourceTotal?: number;
}

/** `setting:visualizer`. */
export interface VisualizerSetting { scene: string; enabled: boolean }
