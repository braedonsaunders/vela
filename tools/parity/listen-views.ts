// The Listen parity matrix: which views of the listen experience (the music app, audiobooks and
// podcasts) are captured, at which viewports, and how each reaches its state. The legacy variant is
// today's hand-written widgets/music; the document variant is the built-in listen documents.
//
// Every capture runs against the frozen mock (LISTEN_MOCK_ENV): fixture dates pinned, a few titles
// already liked, silent media. Listening state is the app's own and is set per view by the mock build's
// parity hook (apps/vela/src/parity.ts): a queue paused at a fixed position, optionally Now Playing
// open. The browser clock is pinned to LISTEN_NOW (the greeting, relative dates).
import type { Viewport } from './views';

export const LISTEN_NOW = '2026-11-24T20:00:00.000Z';

/** The track every view has queued unless it says otherwise: Paper Boats, track 3, paused at 0:41. */
export const DEFAULT_AUDIO = 'album-paper-boats:2:41';

/** The mock's environment for a Listen parity run (beside PORT, DEV_ORIGIN and the media roots). */
export const LISTEN_MOCK_ENV: Record<string, string> = {
  VELA_MOCK_NOW: LISTEN_NOW,
  VELA_MOCK_SPORTS_FREEZE: '1',
  VELA_MOCK_SILENT_MEDIA: '1',
  VELA_MOCK_FAVORITES_LIST: '1',
  VELA_MOCK_LYRICS: '1',
  VELA_MOCK_PLAYLIST_TRACKS: ['track-neon-orchard-1-02', 'track-late-tram-home-1-01', 'track-paper-boats-1-02', 'track-glasshouse-weather-1-01',
    'track-afterglow-arcade-1-03', 'track-copper-kettle-sessions-1-04'].join(','),
  VELA_MOCK_LIKED: ['track-paper-boats-1-01', 'track-paper-boats-1-03', 'track-late-tram-home-1-02', 'track-glasshouse-weather-1-04',
    'track-neon-orchard-1-01', 'album-glasshouse-weather', 'album-late-tram-home', 'artist-mira-solenne'].join(','),
};

/** Web viewports: the Sports set plus the iPhone Duo's two displays (cover 466×678, unfolded 951×669). */
export const LISTEN_WEB_VIEWPORTS: Viewport[] = [
  { name: 'web-1440', width: 1440, height: 900 },
  { name: 'web-1920', width: 1920, height: 1080 },
  { name: 'web-1024', width: 1024, height: 768, touch: true },
  { name: 'web-390', width: 390, height: 844, touch: true },
  { name: 'web-466', width: 466, height: 678, touch: true },
  { name: 'web-951', width: 951, height: 669, touch: true },
];

/** The wide shell (Your Library beside the page, the bar below): wideMusic() at these sizes. */
export const WIDE = ['web-1440', 'web-1920', 'web-1024', 'web-951'];
export const COMPACT = ['web-390', 'web-466'];

/** A step after the view's page is ready: a click or hover (a data-testid prefix or text:…), typing
 * into a field, a key, or a pause. */
export type Step = { click: string } | { hover: string } | { fill: string; text: string } | { press: string } | { wait: number };

export interface ListenView {
  name: string;
  description: string;
  /** The library (music by default) and the place in it (`?m=`; '' is its Home). */
  library?: 'music' | 'audiobooks' | 'podcasts';
  place: string;
  /** The parity hook's queue spec; null for no queue at all. */
  audio?: string | null;
  /** Wait for this (a data-testid prefix, or text:…) before the steps. */
  ready: string;
  steps?: Step[];
  /** On a TV (and the simulators axe drives), the steps as remote keys: HID usage codes (40 select,
   * 41 Menu/Back, 79 right, 80 left, 81 down, 82 up). */
  keys?: number[];
  /** After the steps, wait for this before capturing. */
  settled?: string;
  scrollTo?: string;
  /** Only at these viewports (web names, or tvos, androidtv, ios-phone, ios-fold). */
  only?: string[];
  review?: string;
}

const open = (panel = '') => `${DEFAULT_AUDIO}:open${panel ? `-${panel}` : ''}`;

export const LISTEN_VIEWS: ListenView[] = [
  { name: 'home', description: 'Music Home: greeting, quick tiles, Jump back in, shelves; the bar (wide) or mini player (compact) paused on Kettle Song', place: '', ready: 'music-main' },
  { name: 'home-idle', description: 'Music Home with nothing queued (no bar, no mini player)', place: '', audio: null, ready: 'music-main' },
  { name: 'home-lower', description: 'Music Home scrolled to its later shelves', place: '', ready: 'music-main', scrollTo: 'text:Recently added albums' },
  { name: 'search', description: 'Search with an empty field (browse and recent searches)', place: 'search', ready: 'music-search' },
  { name: 'search-results', description: 'Search for "lantern": top result, songs, artists, albums', place: 'search', ready: 'music-search-input',
    steps: [{ fill: 'music-search-input', text: 'lantern' }, { wait: 1500 }], settled: 'music-search-results' },
  { name: 'liked', description: 'Liked Songs: header and track table', place: 'liked', ready: 'music-tracklist' },
  { name: 'library', description: 'Your Library as its own page (compact) / beside Home (wide)', place: 'library', ready: 'music-library' },
  { name: 'library-albums', description: 'Your Library filtered to Albums', place: 'library', ready: 'music-library', steps: [{ click: 'text:Albums' }, { wait: 800 }] },
  { name: 'rail-collapsed', description: 'Your Library collapsed to the rail (wide)', place: '', ready: 'music-library-collapse', steps: [{ click: 'music-library-collapse' }, { wait: 800 }], only: ['web-1440', 'web-1920'] },
  { name: 'artist', description: 'Artist page: header, Follow, popular tracks, discography', place: 'title:artist-hollow-lanterns', ready: 'music-discography' },
  { name: 'artist-lower', description: 'Artist page scrolled to the discography', place: 'title:artist-hollow-lanterns', ready: 'music-discography', scrollTo: 'music-discography' },
  { name: 'album', description: 'Album page of the queued album: header, track table with the current row lit', place: 'title:album-paper-boats', ready: 'music-tracklist' },
  { name: 'album-discs', description: 'A two-disc album (disc headings)', place: 'title:album-northern-almanac', ready: 'music-tracklist' },
  { name: 'album-liked', description: 'A liked album (filled heart)', place: 'title:album-glasshouse-weather', ready: 'music-tracklist' },
  { name: 'playlist', description: 'A music playlist page (Evening Drive)', place: 'playlist:playlist-evening-drive', ready: 'music-tracklist' },
  { name: 'playlist-video', description: 'A playlist of videos only (no songs to list)', place: 'playlist:playlist-weekend', ready: 'music-tracklist', only: ['web-1440', 'web-390'] },
  { name: 'albums', description: 'Every album matching "a" (Search\'s Albums See all)', place: 'albums:a', ready: 'music-albums' },
  { name: 'rewind', description: 'Rewind: listening recap, stats and chart', place: 'rewind', ready: 'music-rewind-page' },
  { name: 'import', description: 'Playlist Import: the form', place: 'import', ready: 'music-import-page' },
  { name: 'duplicates', description: 'Duplicate Recordings: the groups', place: 'duplicates', ready: 'music-duplicates-page' },
  { name: 'queue-panel', description: 'The queue beside the page (wide), from the bar', place: '', ready: 'bar-queue', steps: [{ click: 'bar-queue' }], settled: 'music-queue', only: WIDE },
  { name: 'sound-panel', description: 'Sound beside the page (wide), from the bar: AutoMix, levelling, EQ', place: '', ready: 'bar-sound', steps: [{ click: 'bar-sound' }], settled: 'sound-panel', only: WIDE },
  { name: 'now-playing', description: 'Now Playing on the queue tab, with the visualizer background where it can draw, and its Off switch', place: '', audio: open(), ready: 'now-playing-toggle' },
  { name: 'now-playing-lyrics', description: 'Now Playing on the lyrics tab', place: '', audio: open('lyrics'), ready: 'now-playing-toggle' },
  { name: 'now-playing-sound', description: 'Now Playing on Sound (its header button)', place: '', audio: open('sound'), ready: 'now-playing-toggle' },
  { name: 'visualizer', description: 'The full-screen visualizer with its scene picker', place: '', audio: open(), ready: 'now-playing-visualizer',
    steps: [{ click: 'now-playing-visualizer' }, { wait: 1200 }], settled: 'visualizer-page' },
  { name: 'audiobooks-home', description: 'Audiobooks Home (spoken word)', library: 'audiobooks', place: '', ready: 'spoken-home' },
  { name: 'audiobook', description: 'An audiobook in parts: progress, chapters, credits', library: 'audiobooks', place: 'title:audiobook-long-voyage-of-the-marigold', ready: 'spoken-audiobook' },
  { name: 'podcasts-home', description: 'Podcasts Home', library: 'podcasts', place: '', ready: 'spoken-home' },
  { name: 'podcast', description: 'A podcast show: episodes', library: 'podcasts', place: 'title:podcast-kettle-and-compass', ready: 'spoken-show' },
];

/** Where a variant draws a Listen view on the web. Both variants live at the library route today;
 * the documents keep the address (`?m=`), so old links still open the same page. */
export function listenPath(view: ListenView): string {
  const params = new URLSearchParams();
  if (view.place) params.set('m', view.place);
  const audio = view.audio === undefined ? DEFAULT_AUDIO : view.audio;
  if (audio) params.set('parityAudio', audio);
  const query = params.toString();
  return `/library/${view.library ?? 'music'}${query ? `?${query}` : ''}`;
}

/** Views compared by review, with the reason (a one-line, written acceptance). */
export const LISTEN_REVIEWED: { viewports: RegExp; views: string[]; reason: string }[] = [];

export function listenReviewed(view: { name: string; review?: string }, viewport: string): string | undefined {
  return LISTEN_REVIEWED.find(r => r.viewports.test(viewport) && r.views.includes(view.name))?.reason ?? view.review;
}
