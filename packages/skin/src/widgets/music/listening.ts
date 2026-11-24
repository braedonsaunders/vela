// What the audio app is listening to, read from the library's class: music (albums, artists,
// tracks, playlists) or spoken word (audiobooks with authors, narrators and chapters; podcasts with
// shows, hosts and episodes). Pages, rows and the player take their words and controls from here,
// so no music wording reaches an audiobook. Message keys, not text: the views translate them.
import type { Card } from '@vela/core';

type MediaClass = NonNullable<Card['media']>['class'];

/** 'audio': a library of another class that asked for the audio app (generic words). */
export type Listening = 'music' | 'audiobook' | 'podcast' | 'audio';

export function listeningOf(cls: MediaClass | string | undefined): Listening {
  return cls === 'music' || cls === 'audiobook' || cls === 'podcast' ? cls : 'audio';
}

/** Spoken word: 15/30 s skips, speed and the sleep timer in place of shuffle and repeat, resume
 * points and Continue listening. A podcast episode or audiobook in any library is spoken word. */
export function isSpoken(value: Listening | MediaClass | string | undefined): boolean {
  return value === 'audiobook' || value === 'podcast';
}

export interface ListeningWords {
  /** Playlists, Liked Songs and Create playlist: music only. */
  playlists: boolean;
  /** The transport: previous/next with shuffle and repeat, or skips, speed and the sleep timer. */
  transport: 'tracks' | 'spoken';
  /** Your Library's filters: the roles it lists apart, each with its label. */
  filters: { role: string; label: string }[];
  /** The roles a viewer saves (the heart), for Your Library's Saved list. */
  savedRoles: string[];
  /** "{count} albums" on a genre tile. */
  genreCount: string;
  /** The heart on a leaf ("Like the song playing" or "Save the episode"), for the keyboard sheet. */
  likeKey: string;
  /** Shift ←/→ ("Previous or next song"). */
  skipKey: string;
  /** The search field's placeholder and the empty search page's line ("Find artists, songs… in {library}"). */
  searchPlaceholder: string;
  searchIntro: string;
}

export function listeningWords(listening: Listening): ListeningWords {
  switch (listening) {
    case 'music': return {
      playlists: true, transport: 'tracks',
      filters: [{ role: 'playlist', label: 'music.playlists' }, { role: 'album', label: 'music.albums' }, { role: 'artist', label: 'music.artists' }],
      savedRoles: ['track', 'album', 'artist'], genreCount: 'music.albumsCount', likeKey: 'music.key.like', skipKey: 'music.key.skip',
      searchPlaceholder: 'listening.search.music', searchIntro: 'listening.searchIntro.music',
    };
    case 'audiobook': return {
      playlists: false, transport: 'spoken',
      filters: [{ role: 'progress', label: 'listening.inProgress' }, { role: 'saved', label: 'listening.saved' }, { role: 'finished', label: 'listening.finished' }],
      savedRoles: ['audiobook'], genreCount: 'listening.audiobooksCount', likeKey: 'listening.key.save', skipKey: 'listening.key.skipBook',
      searchPlaceholder: 'listening.search.audiobook', searchIntro: 'listening.searchIntro.audiobook',
    };
    case 'podcast': return {
      playlists: false, transport: 'spoken',
      filters: [{ role: 'progress', label: 'listening.inProgress' }, { role: 'saved', label: 'listening.following' }],
      savedRoles: ['show', 'episode'], genreCount: 'listening.showsCount', likeKey: 'listening.key.save', skipKey: 'listening.key.skipEpisode',
      searchPlaceholder: 'listening.search.podcast', searchIntro: 'listening.searchIntro.podcast',
    };
    default: return {
      playlists: false, transport: 'tracks',
      filters: [{ role: 'progress', label: 'listening.inProgress' }, { role: 'saved', label: 'listening.saved' }],
      savedRoles: [], genreCount: 'listening.titlesCount', likeKey: 'listening.key.save', skipKey: 'listening.key.skipItem',
      searchPlaceholder: 'listening.search.audio', searchIntro: 'listening.searchIntro.audio',
    };
  }
}

/** The eyebrow over a title's name: what it is, by its role and class. */
export function roleLabel(card: Pick<Card, 'media'>): string {
  const media = card.media;
  switch (media?.role) {
    case 'album': return (media.childCount || 0) <= 3 ? 'music.single' : media.childCount <= 6 ? 'music.ep' : 'media.ui.album';
    case 'artist': return 'media.ui.artist';
    case 'track': return 'media.ui.song';
    case 'audiobook': return 'media.ui.audiobook';
    case 'part': return 'media.ui.part';
    case 'series': return 'media.ui.series';
    case 'book': return media.class === 'audiobook' ? 'media.ui.audiobook' : 'media.ui.book';
    case 'show': return media.class === 'podcast' ? 'media.ui.podcast' : 'media.ui.series';
    case 'episode': return 'media.ui.episode';
    default: return 'listening.title';
  }
}

/** The people a title's byline names, in the order a page shows them: authors then narrators, or
 * hosts, or the artist. `key` is the message that frames each group ("by {name}", "Narrated by {name}"). */
export function creditLines(card: Pick<Card, 'media'>): { key: string; names: { name: string; personId: string }[] }[] {
  const credits = card.media?.credits ?? [];
  const group = (role: string) => credits.filter(credit => credit.role === role).map(({ name, personId }) => ({ name, personId }));
  const lines = card.media?.class === 'podcast'
    ? [{ key: 'listening.hostedBy', names: group('host') }]
    : card.media?.class === 'audiobook'
      ? [{ key: 'listening.by', names: group('author') }, { key: 'media.ui.narratedBy', names: group('narrator') }]
      : [{ key: 'music.byArtist', names: [...group('artist'), ...group('albumArtist')].filter((c, i, all) => all.findIndex(o => o.name === c.name) === i) }];
  return lines.filter(line => line.names.length);
}

/** What a list of a title's children numbers and heads its columns with. */
export interface ListColumns {
  /** The heading of the title column. */
  title: string;
  /** The album column (music lists from several albums). */
  album: boolean;
  /** Each row's second line: the artist (tracks), the date (episodes), nothing (chapters). */
  detail: 'artist' | 'date' | 'none';
  /** The last column: the length, a chapter's start or an episode's length. */
  time: 'duration' | 'start';
}

export function listColumns(role: 'track' | 'chapter' | 'part' | 'episode', fromSeveralAlbums = false): ListColumns {
  switch (role) {
    case 'chapter': return { title: 'listening.chapter', album: false, detail: 'none', time: 'start' };
    case 'part': return { title: 'media.ui.part', album: false, detail: 'none', time: 'duration' };
    case 'episode': return { title: 'media.ui.episode', album: false, detail: 'date', time: 'duration' };
    default: return { title: 'music.title', album: fromSeveralAlbums, detail: 'artist', time: 'duration' };
  }
}

/** Where listening to a container starts: an album from its first track; a book in parts in the part
 * under way (else the first unheard); a show at the episode under way, else its newest unheard.
 * `positionSeconds` is the resume point in `items[index]` (the server resumes a leaf on its own). */
export function listenFrom(container: Pick<Card, 'media'>, children: Card[]): { items: Card[]; index: number; positionSeconds?: number } {
  const playable = children.filter(child => child.media?.audio);
  const underway = (card: Card) => card.progressSeconds > 0 && !card.played;
  if (container.media?.class === 'podcast' && container.media.role === 'show') {
    const newest = [...playable].sort((a, b) => (b.airDate || '').localeCompare(a.airDate || '') || (b.media?.index ?? 0) - (a.media?.index ?? 0));
    const pick = newest.find(underway) ?? newest.find(card => !card.played) ?? newest[0];
    return pick ? { items: [pick], index: 0, ...(underway(pick) ? { positionSeconds: pick.progressSeconds } : {}) } : { items: [], index: 0 };
  }
  if (container.media?.role === 'audiobook') {
    const parts = [...playable].sort((a, b) => (a.media?.index ?? 0) - (b.media?.index ?? 0));
    let index = parts.findIndex(underway);
    if (index < 0) index = Math.max(0, parts.findIndex(part => !part.played));
    const part = parts[index];
    return { items: parts, index, ...(part && underway(part) ? { positionSeconds: part.progressSeconds } : {}) };
  }
  return { items: playable, index: 0 };
}

/** How far through a spoken-word title the viewer is, 0..1; 0 for music, which never resumes. */
export function listenedFraction(card: Pick<Card, 'media' | 'progressSeconds' | 'durationSeconds' | 'played'>): number {
  if (!isSpoken(card.media?.class) || card.played || !card.durationSeconds) return 0;
  return Math.min(1, Math.max(0, card.progressSeconds / card.durationSeconds));
}

/** The keyboard sheet's rows, in the order it shows them: music's shuffle and repeat, or spoken
 * word's skips and speed. The keys themselves are handled in the app's keyboard map. */
export function keyboardMap(listening: Listening): { keys: string; label: string }[] {
  const words = listeningWords(listening);
  const spoken = words.transport === 'spoken';
  return [
    { keys: 'Space', label: 'music.key.toggle' },
    spoken ? { keys: '← / →', label: 'listening.key.seek' } : { keys: '← / →', label: 'music.key.seek' },
    { keys: 'Shift ← / Shift →', label: words.skipKey },
    { keys: '↑ / ↓', label: 'music.key.volume' },
    { keys: 'M', label: 'music.key.mute' },
    ...(spoken ? [{ keys: '[ / ]', label: 'listening.key.speed' }] : [{ keys: 'S', label: 'music.key.shuffle' }, { keys: 'R', label: 'music.key.repeat' }]),
    { keys: 'L', label: words.likeKey },
    { keys: 'Q', label: 'music.key.queue' },
    { keys: '⌘K / Ctrl K', label: 'music.key.search' },
    { keys: '?', label: 'music.key.help' },
  ];
}
