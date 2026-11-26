// The rich blocks (docs/experiences.md: Blocks): native engines a document places and styles but
// never replaces. Each block publishes its props, its named parts (styled by `parts`, by a skin's
// `experiences.<id>.parts`, and by the document's own `parts`) and the parts whose template a
// document may replace (`partTemplates`, or a document template named after the part). Pure data:
// the resolver validates against it, the schema tool emits it as `$defs.RichBlocks`, and the
// rich blocks (packages/skin/src/blocks) draw from it. Additive within a renderer version.

export type RichPropType = 'value' | 'template' | 'boolean' | 'number' | 'enum';

export interface RichPropSpec {
  /** value: a raw read (a list, a record); template: text; boolean / number / enum: text parsed. */
  type: RichPropType;
  values?: readonly string[];
  required?: boolean;
  /** Used when the prop is absent. */
  default?: string;
  doc: string;
}

export interface RichBlockSpec {
  doc: string;
  props: Record<string, RichPropSpec>;
  /** Named parts, `<block>.<part>`. */
  parts: readonly string[];
  /** The parts whose template a document may replace. */
  templates: readonly string[];
  /** What a part template reads beside `{item.*}` and `{$index}`: `{part.<name>}`, per template. */
  templateScope?: Record<string, readonly string[]>;
  /** TV and performance rules the block keeps (docs/experiences.md: TV performance budgets). */
  tv: string;
}

const flag = (doc: string, fallback?: 'true' | 'false'): RichPropSpec => ({ type: 'boolean', doc, ...(fallback ? { default: fallback } : {}) });

const readItem = { type: 'value', required: true, doc: 'The book or series as an item: record or a vela.title value.' } as const;
const readItems = { type: 'value', doc: 'The children as item: records, from vela.children.' } as const;

export const RICH_BLOCKS = {
  reader: {
    doc: 'The full-screen book reader, driven by Vela’s reader session.',
    props: { item: readItem },
    parts: ['reader.page', 'reader.toolbar', 'reader.title', 'reader.progress', 'reader.button', 'reader.panel'],
    templates: [], tv: 'The reader is offered on phones, tablets, web and desktop.',
  },
  bookCover: {
    doc: 'A book’s cover with a spine and the page edges.',
    props: { item: readItem }, parts: ['bookCover.root'], templates: [], tv: 'No focus.',
  },
  bookHero: {
    doc: 'A book’s cover, series, title, author, format facts, reading progress and action.',
    props: { item: readItem, cover: flag('Include the cover slot.', 'true'), action: flag('Include the reading action slot.', 'true') },
    parts: ['bookHero.title', 'bookHero.author', 'bookHero.series', 'bookHero.progress'],
    templates: ['bookHero.cover', 'bookHero.action'], templateScope: { 'bookHero.cover': [], 'bookHero.action': [] },
    tv: 'Focusable series and author links. The reading action becomes a quiet line on TV.',
  },
  bookReadAction: {
    doc: 'The Read, Continue reading or Read again button; a quiet explanation on TV.',
    props: { item: readItem }, parts: ['bookReadAction.button', 'bookReadAction.message'], templates: [], tv: 'No focus on TV.',
  },
  bookSummary: {
    doc: 'A book or series synopsis in serif type.',
    props: { item: readItem }, parts: ['bookSummary.root'], templates: [], tv: 'No focus.',
  },
  bookFacts: {
    doc: 'The metadata labels and values for a book.',
    props: { item: readItem }, parts: ['bookFacts.root'], templates: [], tv: 'No focus.',
  },
  bookSeriesList: {
    doc: 'The other books in a book’s series, or the ordered books on the series’ page.',
    props: { item: readItem, items: readItems }, parts: ['bookSeriesList.root'], templates: [], tv: 'Each book is one focus target.',
  },
  seriesHero: {
    doc: 'A fan of series covers, title, author, and the link to start or resume the series.',
    props: { item: readItem, items: readItems }, parts: ['seriesHero.title', 'seriesHero.author'], templates: [],
    tv: 'A reading action becomes a quiet line on TV. Playable audio and video links remain focusable.',
  },
  trackTable: {
    doc: 'A tracklist: number (a play control on hover, a live meter on the track playing), cover, title with the explicit mark and artist, album, the heart, duration and the row menu. Double-click or Enter plays from a track (a tap on touch, select on TV); right-click or long-press opens the menu.',
    props: {
      tracks: { type: 'value', required: true, doc: 'The tracks: a list source ({items, more}) or a list of item: records.' },
      entryIds: { type: 'value', doc: 'Playlist entry ids, parallel to tracks (a vela.playlist source\'s entryIds): Remove from this playlist, and drag reorder.' },
      playlist: { type: 'template', doc: 'The playlist id when the tracks are its entries.' },
      sourceId: { type: 'template', doc: 'Where the tracks are listed (Now Playing\'s "Playing from"): its id.' },
      sourceName: { type: 'template', doc: 'Its name.' },
      sourceKind: { type: 'enum', values: ['title', 'playlist', 'favorites'], doc: 'Its kind.' },
      covers: flag('Show each track\'s cover (a playlist, Liked Songs, Top Tracks).', 'false'),
      album: flag('Show the album column (wide windows only, never on TV).', 'false'),
      position: flag('Number by position instead of track number.', 'false'),
      header: flag('Draw the column header (never on a phone).', 'true'),
      discs: flag('Group a multi-disc album under disc headings.', 'false'),
      reorder: flag('Drag rows to reorder (a playlist the viewer owns; web pointer only). Needs playlist and entryIds.', 'false'),
      limit: { type: 'number', default: '0', doc: 'At most this many rows (Popular\'s 5, or 10 after See more); 0 is all.' },
    },
    parts: ['trackTable.header', 'trackTable.row', 'trackTable.activeRow', 'trackTable.number', 'trackTable.title', 'trackTable.artist', 'trackTable.album', 'trackTable.duration', 'trackTable.disc'],
    templates: ['trackTable.row', 'trackTable.empty'],
    templateScope: { 'trackTable.row': ['index', 'number', 'active', 'playing', 'disc', 'lit'], 'trackTable.empty': [] },
    tv: 'Each row is one focus target (select plays, a long select opens the menu); nothing inside a row takes focus. Rows draw with the page; a list longer than 200 rows draws its first 200 and the rest as the viewer nears the end.',
  },
  bar: {
    doc: 'The persistent now-playing bar: what is playing (cover, title, artist or chapter, the heart), the transport and the seek bar, and lyrics, Sound, the queue, volume and full screen. Spoken word trades shuffle, previous, next and repeat for speed, 15/30 s skips and the sleep timer.',
    props: {
      queueFlag: { type: 'template', default: 'queue', doc: 'The document state flag the queue button toggles (the shell shows the queue block while it is set).' },
      soundFlag: { type: 'template', default: 'sound', doc: 'The document state flag the Sound button toggles; opening one closes the other.' },
      sound: flag('Show the Sound button.', 'true'),
    },
    parts: ['bar.root', 'bar.cover', 'bar.title', 'bar.subtitle', 'bar.transport', 'bar.toggle', 'bar.scrubber', 'bar.time', 'bar.actions', 'bar.panel'],
    templates: [],
    tv: 'Not drawn on TV (the TV shell floats the mini player). Reads the audio position once a second.',
  },
  queue: {
    doc: 'The queue: what is playing, what the viewer queued (Play next, Add to queue) and what comes next from the source and autoplay. Rows play, remove and move (drag on web pointers, Move up / Move down in their menu).',
    props: {
      closeFlag: { type: 'template', doc: 'The document state flag the close button clears; no close button without it.' },
      header: flag('Draw the Queue heading.', 'true'),
      limit: { type: 'number', default: '60', doc: 'Rows drawn per section, at most 200.' },
    },
    parts: ['queue.heading', 'queue.section', 'queue.row', 'queue.activeRow', 'queue.title', 'queue.byline'],
    templates: ['queue.row'],
    templateScope: { 'queue.row': ['index', 'section', 'active', 'playing', 'lit'] },
    tv: 'Each row is one focus target. Redraws when the queue changes, not with the position.',
  },
  lyrics: {
    doc: 'Lyrics that follow playback: the line being sung is lit (word by word when the lyrics are word-timed), sung lines fade, the list keeps the line in view, and pressing a line seeks there. Plain lyrics scroll as text.',
    props: {
      item: { type: 'value', doc: 'The track (an item: record); the one playing when absent.' },
      large: flag('Now Playing\'s large type.', 'false'),
      translate: flag('Show the translation under each line when the lyrics carry one.', 'false'),
    },
    parts: ['lyrics.line', 'lyrics.activeLine', 'lyrics.pastLine', 'lyrics.word', 'lyrics.activeWord', 'lyrics.translation', 'lyrics.source', 'lyrics.message'],
    templates: [],
    tv: 'Lines are reading stops; the active line scrolls into view without motion when motion is reduced. Word timing redraws only the active line.',
  },
  nowPlaying: {
    doc: 'Now Playing: the artwork stage with its ambient tint, the title and byline, the scrubber and transport, and the queue, chapters, lyrics and Sound beside the stage (side by side by width, as the Duo window layout) or under it.',
    props: {
      panel: { type: 'enum', values: ['queue', 'chapters', 'lyrics', 'sound'], doc: 'The list shown first.' },
      closeFlag: { type: 'template', doc: 'The document state flag the close button clears; no close button without it.' },
      visualizer: flag('Offer the visualizer (the header button and the Sound panel\'s switch) where env.canVisualize.', 'true'),
      visualizerFlag: { type: 'template', doc: 'The document state flag the header\'s visualizer button sets (the page then shows a full-screen visualizer block); no button without it.' },
    },
    parts: ['nowPlaying.stage', 'nowPlaying.artwork', 'nowPlaying.title', 'nowPlaying.byline', 'nowPlaying.tint', 'nowPlaying.tabs', 'nowPlaying.header'],
    templates: ['nowPlaying.background'],
    templateScope: { 'nowPlaying.background': ['playing', 'accent'] },
    tv: 'The transport row and the list beside it are focus guides; the play button takes focus first. A background template is drawn behind the stage and takes no focus.',
  },
  player: {
    doc: 'The mini player (a Listen player; with `channel` the node is instead the muted live preview): what plays, previous, play and pause, next (spoken word: 15 and 30 s skips), stop, and its bottom edge as the scrubber. Pressing it opens Now Playing.',
    props: {
      openFlag: { type: 'template', doc: 'The document state flag set when it is pressed (the shell shows the nowPlaying block while it is set); the app\'s Now Playing opens without it.' },
    },
    parts: ['player.root', 'player.title', 'player.byline'],
    templates: [],
    tv: 'The open button is the focus target; the transport buttons follow it in the row.',
  },
  eq: {
    doc: 'Sound: AutoMix, volume levelling and the equalizer, or only the equalizer bands (`bands`).',
    props: {
      bands: flag('Only the equalizer bands and presets.', 'false'),
      closeFlag: { type: 'template', doc: 'The document state flag the close button clears; draws its own header with it.' },
    },
    parts: ['eq.section', 'eq.band', 'eq.preset'],
    templates: [],
    tv: 'Sliders become − and + (a remote\'s arrows move the focus).',
  },
  rail: {
    doc: 'Your Library: Home, Search and Rewind, the library heading with collapse, new playlist and the library tools, filters, and the playlists, liked albums and artists (spoken word: the books or shows under way). Collapsed it is an icon rail; embedded (a phone, a TV) a plain list.',
    props: {
      mode: { type: 'enum', values: ['auto', 'expanded', 'collapsed', 'embedded', 'icons', 'chips'], default: 'auto', doc: 'auto collapses below 1180 px and keeps the viewer\'s choice; embedded is Your Library as a page (a phone, a TV); icons is a TV\'s icon rail; chips is a phone\'s Home, Search, Your Library and Rewind chips.' },
      collapseFlag: { type: 'template', default: 'railCollapsed', doc: 'The document state flag holding the viewer\'s collapse (the shell sizes the rail from it).' },
    },
    parts: ['rail.nav', 'rail.navItem', 'rail.activeNavItem', 'rail.heading', 'rail.filter', 'rail.row', 'rail.activeRow'],
    templates: [],
    tv: 'Rows are single focus targets; the rail is one focus column.',
  },
  visualizer: {
    doc: 'The music visualizer (implementation: the visualizer lead): Now Playing\'s background or full screen with the scene picker.',
    props: {
      mode: { type: 'enum', values: ['background', 'fullscreen'], required: true, doc: 'Where it draws.' },
      sceneId: { type: 'template', doc: 'The scene; the viewer\'s choice when absent.' },
    },
    parts: ['visualizer.scenePicker', 'visualizer.sceneChip', 'visualizer.sceneChipActive', 'visualizer.caption'],
    templates: [],
    tv: 'Drawn only where env.canVisualize; a generic fallback elsewhere.',
  },
  recap: {
    doc: 'Rewind: the listening recap for a period with its charts (section-B recap block).',
    props: {
      libraryId: { type: 'template', doc: 'The library; the experience\'s when absent.' },
      period: { type: 'enum', values: ['week', 'month', 'year', 'all'], default: 'month', doc: 'The period shown first.' },
      periodParam: { type: 'template', doc: 'A page param holding the period: the block reads it and changes it with setParam, so a vela.recap source reading {param.<name>} follows.' },
      periodState: { type: 'template', doc: 'A document state value holding the chosen period (`open name=value`), so the page\'s heading can read it.' },
    },
    parts: [],
    templates: [],
    tv: 'As the Rewind page.',
  },
  playlistImport: {
    doc: 'The playlist import flow over the local import: record (section-B import block).',
    props: {
      libraryId: { type: 'template', doc: 'The library; the experience\'s when absent.' },
      nameState: { type: 'template', doc: 'A document state value holding the playlist name as edited, for the page\'s heading.' },
    },
    parts: [],
    templates: [],
    tv: 'Not offered on TV.',
  },
  duplicates: {
    doc: 'Duplicate recordings in a library and the preferred version of each (section-B duplicates block).',
    props: {
      libraryId: { type: 'template', doc: 'The library; the experience\'s when absent.' },
    },
    parts: [],
    templates: [],
    tv: 'Not offered on TV.',
  },
  // ——— Page-level blocks: the pieces of today's music pages a page document arranges ———
  wash: {
    doc: 'The wash behind a page\'s top: the artwork\'s colour (and the artwork, blurred, on the web) fading into the page.',
    props: {
      accent: { type: 'template', doc: 'The colour; the skin\'s accent when empty.' },
      image: { type: 'template', doc: 'The artwork drawn blurred under it (web).' },
      height: { type: 'number', default: '420', doc: 'Its height, px.' },
    },
    parts: [], templates: [], tv: 'No focus; no motion.',
  },
  collectionHeader: {
    doc: 'A collection page\'s header: the cover, the eyebrow, the display title sized by its length, and a byline under it; stacked and centred on a phone.',
    props: {
      eyebrow: { type: 'template', doc: 'The line above the title (Album, Playlist).' },
      title: { type: 'template', required: true, doc: 'The title.' },
    },
    parts: [], templates: ['collectionHeader.cover', 'collectionHeader.byline'],
    templateScope: { 'collectionHeader.cover': [], 'collectionHeader.byline': [] },
    tv: 'No focus of its own; links in the byline template are focusable.',
  },
  cover: {
    doc: 'A cover: a title\'s artwork (square, round for artists, book), Liked Songs\' heart, a playlist\'s mosaic, or Rewind\'s, import\'s or duplicates\' covers.',
    props: {
      kind: { type: 'enum', values: ['square', 'round', 'book', 'liked', 'mosaic', 'rewind', 'import', 'duplicates'], default: 'square', doc: 'What it draws.' },
      item: { type: 'value', doc: 'The title (an item: record or a vela.title value).' },
      tracks: { type: 'value', doc: 'mosaic: the tracks whose album covers fill it.' },
      poster: { type: 'template', doc: 'mosaic: the playlist\'s own artwork, drawn instead when present.' },
      size: { type: 'number', default: '0', doc: 'px; 0 is the page cover\'s size for the window.' },
      lift: { type: 'number', default: '2', doc: 'Its shadow.' },
      byline: flag('Letter the byline on the drawn cover too (spoken word\'s pages).', 'false'),
    },
    parts: [], templates: [], tv: 'No focus.',
  },
  actionBar: {
    doc: 'A page\'s action bar: play and pause (lit while playing from this source), shuffle, the heart, Follow, the title\'s menu, a playlist\'s Edit details.',
    props: {
      buttons: { type: 'template', required: true, doc: 'A comma list of play, shuffle, heart, follow, more, edit, in order.' },
      item: { type: 'value', doc: 'The title the heart, Follow and the menu act on.' },
      tracks: { type: 'value', doc: 'What play and shuffle play.' },
      sourceId: { type: 'template', doc: 'Where they play from; the item when empty.' },
      sourceName: { type: 'template', doc: 'Its name.' },
      sourceKind: { type: 'enum', values: ['title', 'playlist', 'favorites'], default: 'title', doc: 'Its kind.' },
      playlist: { type: 'template', doc: 'edit: the playlist id.' },
      summary: { type: 'template', doc: 'edit: the playlist\'s description.' },
    },
    parts: [], templates: [], tv: 'One focus row; play takes focus first when the page opens.',
  },
  byline: {
    doc: 'A title\'s byline: the artist (opening their page) and facts after it.',
    props: {
      item: { type: 'value', required: true, doc: 'The title.' },
      facts: { type: 'value', doc: 'Facts after the artist: a list, or text with | between them.' },
    },
    parts: [], templates: [], tv: 'The artist link is focusable.',
  },
  musicShelf: {
    doc: 'A shelf of music tiles (cover, title, a line under it) with previous and next arrows on pointers.',
    props: {
      title: { type: 'template', doc: 'Its heading.' },
      detail: { type: 'template', doc: 'A line beside the heading.' },
      items: { type: 'value', required: true, doc: 'The titles: a list source or a list of item: records.' },
      tileSize: { type: 'number', default: '176', doc: 'px (smaller on a phone).' },
      subtitle: { type: 'enum', values: ['none', 'year', 'byline', 'release', 'playlist'], default: 'none', doc: 'The line under each tile.' },
      dedupeAlbums: flag('Show each song\'s album once.', 'false'),
      exclude: { type: 'template', doc: 'A title id left out (an album\'s More by leaves the album out).' },
      role: { type: 'template', doc: 'Keep only titles of this role (artist, album).' },
      limit: { type: 'number', default: '0', doc: 'At most this many tiles; 0 is all.' },
    },
    parts: [], templates: [], tv: 'One focus row that remembers its position.',
  },
  quickTiles: { doc: 'Music Home\'s quick tiles: what was played from most recently (Liked Songs and Rewind among it), then the playlists.', props: {}, parts: [], templates: [], tv: 'A focus grid.' },
  homeShelves: { doc: 'Music Home\'s shelves: Recently played, Jump back in, and the library\'s rows (rows laid out as tracks draw as track lists).', props: {}, parts: [], templates: [], tv: 'One focus row per shelf.' },
  genres: { doc: 'The library\'s genres as coloured tiles.', props: {}, parts: [], templates: [], tv: 'No focus (not pressable today).' },
  artistHero: {
    doc: 'An artist page\'s image band: the eyebrow, the name sized by its length, the releases and genres.',
    props: { item: { type: 'value', required: true, doc: 'The artist.' } },
    parts: [], templates: [], tv: 'No focus.',
  },
  artistLiked: {
    doc: '"You\'ve liked N songs" by the artist, opening Liked Songs; nothing when none.',
    props: { item: { type: 'value', required: true, doc: 'The artist.' } },
    parts: [], templates: [], tv: 'One focus target.',
  },
  discography: {
    doc: 'An artist\'s discography: the heading with Albums / Singles and EPs chips, a shelf with Show all, the grid it opens, and a loading line while pages arrive.',
    props: { item: { type: 'value', required: true, doc: 'The artist.' } },
    parts: [], templates: [], tv: 'The chips are a focus row; the grid moves by D-pad.',
  },
  listenSearch: { doc: 'The audio app\'s search page, whole (field, recent searches, results by kind).', props: {}, parts: [], templates: [], tv: 'The TV keyboard and results.' },
  spokenHome: { doc: 'Home for the library (music Home, or spoken word\'s Home for audiobooks and podcasts), whole.', props: {}, parts: [], templates: [], tv: 'As the page.' },
  spokenTitle: {
    doc: 'A title page in the audio app (an album or artist for music; a book, show or collection for spoken word), whole.',
    props: { id: { type: 'template', required: true, doc: 'The title id.' } },
    parts: [], templates: [], tv: 'As the page.',
  },
  timeline: {
    doc: 'A virtualized square photo grid with calendar headings and cursor paging.',
    props: {
      items: { type: 'value', required: true, doc: 'The photo list source ({items, more}).' },
      source: { type: 'template', doc: 'The list source name for vela.more.' },
      pending: { type: 'value', doc: 'Whether a page is being read ({src.x.$pending}).' },
      failed: { type: 'template', doc: 'The last source error ({src.x.$error}).' },
    },
    parts: ['timeline.month', 'timeline.day', 'timeline.tile'],
    templates: [],
    tv: 'Moves by D-pad through square photo tiles.',
  },
  albumsGrid: {
    doc: 'The albums grid (a Show all of albums), paged as the viewer nears its end.',
    props: { query: { type: 'template', doc: 'The albums query (the place\'s).' } },
    parts: [], templates: [], tv: 'A focus grid.',
  },
  tileGrid: {
    doc: 'A wrapping grid of music tiles over a list source, reading its next page (vela.more) as the end comes into reach, with "Loading more…" and a retry at its end.',
    props: {
      items: { type: 'value', required: true, doc: 'The list source\'s value ({items, more}).' },
      source: { type: 'template', doc: 'The list source\'s name on this page, for vela.more.' },
      pending: { type: 'value', doc: 'Whether a page is being read ({src.x.$pending}).' },
      failed: { type: 'template', doc: 'The source\'s error, when its last read failed ({src.x.$error}).' },
      tileSize: { type: 'number', default: '0', doc: 'px; 0 is 200 on TV, 132 on a phone, else 168.' },
      subtitle: { type: 'enum', values: ['yearByline', 'none', 'year', 'byline', 'release', 'playlist'], default: 'yearByline', doc: 'The line under each tile.' },
    },
    parts: [], templates: [], tv: 'A focus grid; the first tile takes focus as the page opens.',
  },
  continueListening: {
    doc: 'Continue listening: a card per title under way with its progress and what is left; Play resumes (select resumes on TV).',
    props: {
      row: { type: 'value', required: true, doc: 'A vela.rows row ({name, items}).' },
      title: { type: 'template', doc: 'The heading; the row\'s name, else "Continue listening".' },
    },
    parts: [], templates: [], tv: 'A focus grid.',
  },
  spokenCredits: { doc: 'A spoken title\'s credits: by the author, narrated by, hosted by.', props: { item: { type: 'value', required: true, doc: 'The title.' } }, parts: [], templates: [], tv: 'No focus.' },
  spokenFacts: { doc: 'The facts under the credits: year, length, parts or chapters and genre (a book); episodes and genre (a show); year and count (a collection).', props: { item: { type: 'value', required: true, doc: 'The title.' } }, parts: [], templates: [], tv: 'No focus.' },
  spokenProgress: { doc: 'An audiobook under way: the bar, what is left and the chapter; Finished once played.', props: { item: { type: 'value', required: true, doc: 'The audiobook.' } }, parts: [], templates: [], tv: 'No focus.' },
  spokenPlay: { doc: 'A spoken title\'s action bar: listen or resume (and Start over), or play the show\'s next episode, the heart and the menu, with a line when this device cannot play it.', props: { item: { type: 'value', required: true, doc: 'The title.' } }, parts: [], templates: [], tv: 'One focus row; play takes focus first.' },
  spokenItems: { doc: 'A spoken title\'s list: a book\'s parts or chapters; a show\'s summary and episodes with the All / New chips; a collection\'s items when they all play.', props: { item: { type: 'value', required: true, doc: 'The title.' } }, parts: [], templates: [], tv: 'Rows are single focus targets.' },
  spokenAbout: { doc: 'About: the summary and the facts table (a show\'s summary is in spokenItems).', props: { item: { type: 'value', required: true, doc: 'The title.' } }, parts: [], templates: [], tv: 'No focus.' },
  searchField: { doc: 'The audio app\'s search field: focused as the page opens, Escape clears it, Vela\'s or the system\'s keyboard on a TV. Its query is the store\'s, shared with recentSearches and searchResults.', props: {}, parts: [], templates: [], tv: 'One focus target that opens the keyboard; the clear button beside it.' },
  recentSearches: { doc: 'This library\'s recent searches (or the intro) while the field is empty; nothing once something is typed.', props: {}, parts: [], templates: [], tv: 'Rows are focus targets.' },
  searchResults: { doc: 'The results for what is typed, grouped by what the library holds (top result, songs, albums, artists, people, playlists), with loading, failed and empty states; nothing while the field is empty.', props: {}, parts: [], templates: [], tv: 'As the page.' },
  importSubtitle: { doc: 'The import page\'s line under its title: the import\'s description, else what can be imported from (the advertised sources).', props: {}, parts: [], templates: [], tv: 'No focus.' },
  spokenCollectionShelf: { doc: 'A collection whose items do not all play: them as a shelf of tiles (else nothing).', props: { item: { type: 'value', required: true, doc: 'The collection.' } }, parts: [], templates: [], tv: 'One focus row.' },
} as const satisfies Record<string, RichBlockSpec>;

export type RichBlockName = keyof typeof RICH_BLOCKS;

export const RICH_BLOCK_NAMES = Object.keys(RICH_BLOCKS) as RichBlockName[];

export function isRichBlock(name: string): name is RichBlockName {
  return Object.prototype.hasOwnProperty.call(RICH_BLOCKS, name);
}
