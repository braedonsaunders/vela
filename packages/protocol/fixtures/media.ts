// Music, book, audiobook and podcast fixtures for the media-kinds contract (docs/media-kinds.md).
// Every artist, album, track, book, author, narrator, show, host and label here is fictional.
import type { ArtworkRef, Chapter, Library, LibraryBrowseOptions, Loudness, MediaRole, ReadingFormat, RowEntry, Title, TitleDetail, WatchState } from '../types';

/** Stable 32-bit FNV-1a hash; seeds cover art, palettes and chapter layouts. */
export function mediaSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { hash ^= id.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}
export interface CoverPalette { bg: string; ink: string; accents: [string, string, string] }
export const coverPalettes: CoverPalette[] = [
  { bg: '#e9dcc3', ink: '#1f2a36', accents: ['#d2632f', '#2f6b6b', '#e2a93b'] },
  { bg: '#14213d', ink: '#f4efe6', accents: ['#fca311', '#e5e5e5', '#5a7fa8'] },
  { bg: '#1e3b33', ink: '#f0e6d2', accents: ['#c9a227', '#7fb6a3', '#e07a5f'] },
  { bg: '#f3d9d3', ink: '#3a1f2b', accents: ['#b23a48', '#f28f3b', '#5c7aa8'] },
  { bg: '#0f4c5c', ink: '#fbf5ea', accents: ['#e36414', '#fb8b24', '#9ad1d4'] },
  { bg: '#3d1f3a', ink: '#f6e7d8', accents: ['#e9a6a6', '#c06c84', '#f8b195'] },
  { bg: '#cfd8c4', ink: '#23312a', accents: ['#567d46', '#d98e48', '#3f5f8a'] },
  { bg: '#1b3a8a', ink: '#fdf6e3', accents: ['#f2c14e', '#f78154', '#5fad56'] },
  { bg: '#efe3d0', ink: '#3b2a1e', accents: ['#c4552d', '#8c9a5b', '#2d4a6b'] },
  { bg: '#1d1d24', ink: '#f5f5f5', accents: ['#ff5d8f', '#4cc9f0', '#f9c74f'] },
  { bg: '#5b1a24', ink: '#f3e3c3', accents: ['#d4a35a', '#e8c99b', '#9c3d4a'] },
  { bg: '#2e3f57', ink: '#eef1f4', accents: ['#ef8354', '#bfc0c0', '#7ea3cc'] },
];
/** Position within its group (albums, books, …), so neighbouring covers get distinct palettes and layouts. */
const variants = new Map<string, number>();
function variant(id: string, ordinal: number, step: number): string { variants.set(id, ordinal * step); return id; }
export const coverVariant = (id: string): number => variants.get(id) ?? mediaSeed(id);
export const paletteFor = (id: string): CoverPalette => coverPalettes[coverVariant(id) % coverPalettes.length]!;

export type CoverShape = 'square' | 'book' | 'wide';
/** Artwork served by the mock's /artwork route: square music/audiobook covers, 2:3 books, 16:9 backdrops. */
export function mediaArtwork(id: string, shape: CoverShape, kind: ArtworkRef['kind'] = shape === 'wide' ? 'backdrop' : 'poster'): ArtworkRef {
  const widths = shape === 'wide' ? [640, 1280] : shape === 'book' ? [240, 480] : [300, 600];
  const ratio = shape === 'wide' ? 9 / 16 : shape === 'book' ? 3 / 2 : 1;
  return { id: `${id}-${kind}`, kind, tag: 'media-v1', color: paletteFor(id).bg,
    sizes: widths.map(width => ({ width, height: Math.round(width * ratio), url: `/vela/v0/artwork/${id}?kind=${kind}&width=${width}&v=m1` })) };
}

// ---------------------------------------------------------------------------------------------
// Generated media. The generators in mock-server/scripts read these tables, so a plan's
// durationSeconds is the real duration of the file it serves.
export interface AudioSource { file: string; durationSeconds: number; mimeType: string; codec: string }
export const musicClips: (AudioSource & { key: string })[] = [
  { key: 'lantern-waltz', file: 'clip-lantern-waltz.m4a', durationSeconds: 48, mimeType: 'audio/mp4', codec: 'aac' },
  { key: 'harbour-pluck', file: 'clip-harbour-pluck.m4a', durationSeconds: 40, mimeType: 'audio/mp4', codec: 'aac' },
  { key: 'music-box', file: 'clip-music-box.m4a', durationSeconds: 60, mimeType: 'audio/mp4', codec: 'aac' },
  { key: 'blue-hour-keys', file: 'clip-blue-hour-keys.m4a', durationSeconds: 56, mimeType: 'audio/mp4', codec: 'aac' },
  { key: 'glasshouse-drone', file: 'clip-glasshouse-drone.mp3', durationSeconds: 70, mimeType: 'audio/mpeg', codec: 'mp3' },
  { key: 'arcade-bounce', file: 'clip-arcade-bounce.flac', durationSeconds: 34, mimeType: 'audio/flac', codec: 'flac' },
];
/**
 * The gapless test albums (mock-server/scripts/make-gapless-media.ts): one continuous signal (a 220 to
 * 880 Hz sweep over a seeded noise floor) cut into four parts at sample counts that line up with no codec
 * frame, encoded as FLAC, MP3 and AAC. Played in order, the parts must join with no gap and no click;
 * tools/gapless/measure.ts compares a recording against the signal at each join.
 */
export type GaplessFormat = 'flac' | 'mp3' | 'aac';
export const GAPLESS_RATE = 44100;
export const gaplessPartFrames = [321_930, 302_085, 357_651, 341_334];
const gaplessTypes: Record<GaplessFormat, { ext: string; mimeType: string; codec: string }> = {
  flac: { ext: 'flac', mimeType: 'audio/flac', codec: 'flac' },
  mp3: { ext: 'mp3', mimeType: 'audio/mpeg', codec: 'mp3' },
  aac: { ext: 'm4a', mimeType: 'audio/mp4', codec: 'aac' },
};
export const gaplessSources: (AudioSource & { format: GaplessFormat; part: number; frames: number })[] = (['flac', 'mp3', 'aac'] as const).flatMap(format =>
  gaplessPartFrames.map((frames, index) => ({ format, part: index + 1, frames, file: `gapless-sweep-${index + 1}.${gaplessTypes[format].ext}`,
    durationSeconds: frames / GAPLESS_RATE, mimeType: gaplessTypes[format].mimeType, codec: gaplessTypes[format].codec })));
export interface ReadingSource { file: string; format: ReadingFormat; mimeType: string }
export const readingMimeTypes: Record<ReadingFormat, string> = { epub: 'application/epub+zip', pdf: 'application/pdf', cbz: 'application/vnd.comicbook+zip' };

// ---------------------------------------------------------------------------------------------
// People
export interface MediaPerson { id: string; name: string; roles: string[]; knownFor: string; biography: string }
const people = new Map<string, MediaPerson>();
function person(slug: string, name: string, role: string, knownFor: string, biography: string): string {
  const id = `person-${slug}`, held = people.get(id);
  if (held) { if (!held.roles.includes(role)) held.roles.push(role); return id; }
  people.set(id, { id, name, roles: [role], knownFor, biography });
  return id;
}
const roleLabel: Record<string, string> = { artist: 'Artist', albumArtist: 'Album artist', author: 'Author', narrator: 'Narrator', composer: 'Composer', illustrator: 'Illustrator', host: 'Host' };

// ---------------------------------------------------------------------------------------------
// Music: artist → album → track. Title.kind keeps the show/season/episode projection.
interface AlbumSpec { slug: string; name: string; year: number; month: number; day?: number; type: 'Album' | 'EP'; summary: string; discs: string[]; gapless?: GaplessFormat }
interface ArtistSpec { slug: string; name: string; genres: string[]; label: string; bio: string; composer?: string; albums: AlbumSpec[] }
/** A filmed concert: a plugin's video level under the artist (features.pluginLevels), role 'concert'. */
interface ConcertSpec { slug: string; name: string; venue: string; year: number; month: number; minutes: number; summary: string; positionSeconds?: number }
/** Duplicate recordings across studio albums, deluxe editions and label anthologies (features.duplicates). */
const canonicalRecordingIds: Record<string, string> = {
  'Paper Boats': 'US-DRW-19-00101',
  'Paper Boats (2024 Remaster)': 'US-DRW-19-00101',
  'Salt in the Lamplight': 'US-DRW-19-00102',
  'Salt in the Lamplight (2024 Remaster)': 'US-DRW-19-00102',
  'Harbour Lights': 'US-DRW-19-00106',
  'Harbour Lights (2024 Remaster)': 'US-DRW-19-00106',
  'Glasshouse': 'US-NLR-20-00202',
  'Late Tram Home': 'US-KTS-18-00301',
  'Neon Orchard': 'US-LTA-17-00401',
};
const artistSpecs: ArtistSpec[] = [
  { slug: 'hollow-lanterns', name: 'The Hollow Lanterns', genres: ['Indie Folk', 'Folk'], label: 'Driftwood Records',
    bio: 'A four-piece from a fictional fishing town who write warm, harmony-heavy songs about weather, kitchens and the long way home.',
    albums: [
      { slug: 'paper-boats', name: 'Paper Boats', year: 2019, month: 4, type: 'Album', summary: 'A debut recorded in a converted boathouse: banjo, brushed drums and four voices around one microphone.',
        discs: ['Paper Boats|Salt in the Lamplight|Kettle Song|The Long Field|Borrowed Coat|Harbour Lights|Swallows over Ashby|Morning Train to Wells'] },
      { slug: 'northern-almanac', name: 'Northern Almanac', year: 2022, month: 10, type: 'Album', summary: 'A double album with a song for every turn of the year, from the January thaw to the last waltz of December.',
        discs: ['January Thaw|Frost on the Orchard|March Wind|The Lambing Moon|April Rain|Hawthorn', 'Harvest Fair|September Swallows|The Clocks Go Back|Bonfire Smoke|First Snow|Year’s End Waltz'] },
      { slug: 'small-hours', name: 'Small Hours', year: 2024, month: 2, type: 'EP', summary: 'Six quiet songs written between midnight and dawn, sung barely above a whisper.',
        discs: ['Small Hours|Lamplighter|Night Bus|Kitchen Radio|Still Awake|Dawn Chorus'] },
    ] },
  { slug: 'mira-solenne', name: 'Mira Solenne', genres: ['Ambient', 'Electronic'], label: 'Northlight Recordings',
    bio: 'An imaginary composer of slow electronic music built from field recordings, tape loops and patient synthesisers.',
    albums: [
      { slug: 'glasshouse-weather', name: 'Glasshouse Weather', year: 2020, month: 6, type: 'Album', summary: 'Humid, glowing ambient pieces imagined inside a Victorian palm house during a summer storm.',
        discs: ['Condensation|Glasshouse|Fern Light|Humidity|Slow Bloom|Terrarium|Rain on the Panes|Afterglow Botanica'] },
      { slug: 'satellite-lullabies', name: 'Satellite Lullabies', year: 2023, month: 11, type: 'Album', summary: 'Bedtime music for small machines in low orbit, full of telemetry chirps and soft analogue drift.',
        discs: ['Low Orbit|Telemetry|Sleeping Satellites|Ground Station|Perigee|Signal Drift|Aurora Uplink|Re-entry|Lullaby for a Probe'] },
    ] },
  { slug: 'cedar-and-wire', name: 'Cedar & Wire', genres: ['Jazz'], label: 'Kettle & Spoon',
    bio: 'A piano-and-guitar duo who play unhurried small-hours jazz in the corner booths of cities that do not exist.',
    albums: [
      { slug: 'late-tram-home', name: 'Late Tram Home', year: 2018, month: 9, type: 'Album', summary: 'Seven tunes for the last tram across town, recorded live to tape in a single evening.',
        discs: ['Late Tram Home|Corner Booth|Umbrella Blues|Last Orders|Rain Check|Streetlamp Ballad|Night Owl Shuffle'] },
      { slug: 'blue-hour-sketches', name: 'Blue Hour Sketches', year: 2021, month: 3, type: 'EP', summary: 'Short, loose studies written to accompany an imaginary exhibition of charcoal drawings.',
        discs: ['Blue Hour|Charcoal|Pencil Waltz|Smudge|Watercolour Rain|The Unfinished Portrait'] },
      { slug: 'copper-kettle-sessions', name: 'Copper Kettle Sessions', year: 2024, month: 7, type: 'Album', summary: 'Breakfast-table jazz: brushed snare, warm Rhodes and a kettle that always seems about to boil.',
        discs: ['Copper Kettle|Steam|Two Sugars|Sunday Crossword|The Slow Pour|Biscuit Tin Bossa|Window Seat|Second Cup|Goodnight, Kitchen'] },
    ] },
  { slug: 'velvet-comet', name: 'Velvet Comet', genres: ['Synth-pop', 'Electronic'], label: 'Lowtide Audio',
    bio: 'A made-up synth-pop band powered by drum machines, glittering arpeggios and unreasonable optimism.',
    albums: [
      { slug: 'neon-orchard', name: 'Neon Orchard', year: 2017, month: 5, type: 'Album', summary: 'Bright, bouncing pop songs about fruit, phosphor and falling for someone at the arcade.',
        discs: ['Neon Orchard|Cherry Static|Pulse Garden|Electric Peach|Moonlit Arcade|Dancing in Low Res|Paper Hearts, Chrome Skies'] },
      { slug: 'afterglow-arcade', name: 'Afterglow Arcade', year: 2021, month: 8, type: 'Album', summary: 'A concept album set in a seaside arcade the night before it closes for good.',
        discs: ['Insert Coin|Afterglow|High Score Heart|Pixel Rain|Continue?|Two Player Mode|Game Over, Darling|Attract Mode'] },
    ] },
  { slug: 'ondine-marsh-quartet', name: 'Ondine Marsh Quartet', genres: ['Classical', 'Chamber'], label: 'Paper Moon Music', composer: 'Ondine Marsh',
    bio: 'A fictional string quartet devoted to new chamber music about coasts, tides and the people who keep watch over them.',
    albums: [
      { slug: 'tidewater-suite', name: 'Tidewater Suite', year: 2016, month: 1, type: 'Album', summary: 'Six movements following a single tide through an estuary, from slack water to night harbour.',
        discs: ['I. Slack Water|II. Flood Tide|III. Estuary Birds|IV. Mudflat Scherzo|V. Ebb|VI. Night Harbour'] },
      { slug: 'lighthouse-variations', name: 'Lighthouse Variations', year: 2020, month: 10, type: 'Album', summary: 'A theme and six variations on the turning of a lighthouse lamp, closing with a radiant finale.',
        discs: ['Theme: The Lamp|Variation 1: Fog|Variation 2: Gulls|Variation 3: Keeper’s Log|Variation 4: Gale|Variation 5: Calm|Variation 6: Last Light|Finale: Beacon'] },
      { slug: 'winter-garden', name: 'Winter Garden', year: 2023, month: 12, type: 'Album', summary: 'Seven miniatures for a frozen garden, written for the shortest days of the year.',
        discs: ['Hoarfrost|Snowdrops|Bare Branches|Robin at the Window|Frozen Pond|Candlemas|Thaw'] },
    ] },
  { slug: 'vela-test-signals', name: 'Vela Test Signals', genres: ['Test Signal'], label: 'Vela',
    bio: 'Not music: one continuous sweep cut into four parts, to hear (and measure) whether a player joins tracks with no gap.',
    albums: (['flac', 'mp3', 'aac'] as const).map((format, index) => ({ slug: `gapless-sweep-${format}`, name: `Gapless Sweep (${format.toUpperCase()})`, year: 2026, month: 11 - index,
      type: 'EP' as const, gapless: format, summary: `A 220 to 880 Hz sweep in four ${format.toUpperCase()} parts that must play as one unbroken tone.`,
      discs: ['Sweep, part 1|Sweep, part 2|Sweep, part 3|Sweep, part 4'] })) },
  // Concerts only: a live band with no studio albums in the library.
  { slug: 'harbour-brass-collective', name: 'Harbour Brass Collective', genres: ['Brass', 'Jazz'], label: 'Quayside Live',
    bio: 'An imaginary twelve-piece street brass band who only ever play live, from harbour walls to festival tents.', albums: [] },
  // Label anthologies and deluxe reissues that carry duplicate recordings of studio tracks.
  { slug: 'driftwood-anthology', name: 'Driftwood Records', genres: ['Indie Folk', 'Ambient', 'Jazz', 'Synth-pop'], label: 'Driftwood Records',
    bio: 'Label anthologies, coastal compilations and anniversary reissues from the Driftwood and Northlight rosters.',
    albums: [
      { slug: 'coastal-anthology', name: 'Coastal Anthology: Five Years of Driftwood', year: 2023, month: 8, type: 'Album',
        summary: 'A label compilation gathering the flagship recordings from the first five years along the coast.',
        discs: ['Paper Boats|Salt in the Lamplight|Harbour Lights|Glasshouse|Late Tram Home|Neon Orchard'] },
      { slug: 'harbour-sessions-deluxe', name: 'Paper Boats (Anniversary Deluxe Edition)', year: 2024, month: 5, type: 'Album',
        summary: 'Remastered anniversary reissue of the boathouse debut, packaged with the original master transfers.',
        discs: ['Paper Boats (2024 Remaster)|Salt in the Lamplight (2024 Remaster)|Harbour Lights (2024 Remaster)'] },
    ] },
  { slug: 'tomorrow-signals', name: 'Tomorrow Signals', genres: ['Ambient'], label: 'Vela',
    bio: 'Fictional recordings from a future release.',
    albums: [{ slug: 'unreleased-signals', name: 'Unreleased Signals', year: 2099, month: 12, day: 11, type: 'EP',
      summary: 'An upcoming release from Tomorrow Signals.', discs: ['First Signal|Second Signal'] }] },
];
/** Artists with albums only, concerts only (Harbour Brass Collective) and both (The Hollow Lanterns, Velvet Comet). */
/** A fixture track's loudness (features.loudness), stable per track: most albums measured (with fades),
 * every fourth album only partly known (a provider hint on odd tracks, nothing on even ones). */
function trackLoudness(id: string, durationSeconds: number, albumOrdinal: number): { loudness?: Loudness; bpm?: number } {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const unit = (shift: number) => ((hash >>> shift) % 1000) / 1000;
  const trackGainDb = Math.round((-3 - unit(0) * 8) * 10) / 10;
  const bpm = 84 + Math.round(unit(3) * 60);
  const ordinal = Number(id.slice(-2));
  if (albumOrdinal % 4 === 3) return ordinal % 2 ? { loudness: { trackGainDb, reference: -18, source: 'provider' }, bpm } : {};
  const endMs = Math.round(durationSeconds * 1000 - unit(5) * 600);
  return { bpm, loudness: { trackGainDb, trackPeak: Math.round((0.88 + unit(7) * 0.12) * 1000) / 1000, lufs: Math.round((-18 - trackGainDb) * 10) / 10, reference: -18, source: 'measured',
    trim: { startMs: Math.round(unit(9) * 300), endMs, fadeInEndMs: Math.round(400 + unit(11) * 1600), fadeOutStartMs: Math.round(endMs - 1500 - unit(13) * 7500) } } };
}

const concertSpecs: Record<string, ConcertSpec[]> = {
  'hollow-lanterns': [
    { slug: 'lanterns-live-at-the-boathouse', name: 'Live at the Boathouse', venue: 'The Old Boathouse', year: 2023, month: 6, minutes: 94, positionSeconds: 75,
      summary: 'The band return to the boathouse where they made their first record, for a candlelit midsummer set filmed on four cameras.' },
    { slug: 'lanterns-almanac-tour', name: 'Northern Almanac: The Tour Film', venue: 'Ashby Corn Exchange', year: 2023, month: 1, minutes: 118,
      summary: 'Every song from the double album, played in order across one long winter night, with the year turning on screen behind them.' },
  ],
  'velvet-comet': [
    { slug: 'comet-arcade-nights', name: 'Arcade Nights', venue: 'Pier Pavilion', year: 2022, month: 8, minutes: 86,
      summary: 'A neon-soaked show on the end of the pier, with a light rig built from salvaged arcade cabinets.' },
    { slug: 'comet-orchard-in-concert', name: 'Neon Orchard in Concert', venue: 'Glass Dome Theatre', year: 2018, month: 3, minutes: 72,
      summary: 'The debut album live under a glass dome, every arpeggio bouncing off the panes.' },
    { slug: 'comet-new-year-countdown', name: 'New Year Countdown', venue: 'Harbour Square', year: 2024, month: 12, minutes: 131,
      summary: 'Three hours of synth-pop in the open air, filmed through to the midnight countdown and the fireworks after it.' },
  ],
  'harbour-brass-collective': [
    { slug: 'brass-on-the-harbour-wall', name: 'On the Harbour Wall', venue: 'North Quay', year: 2024, month: 7, minutes: 64,
      summary: 'A summer evening set played to the boats coming in, with gulls, foghorns and a crowd on every bollard.' },
    { slug: 'brass-festival-tent', name: 'Midnight in the Festival Tent', venue: 'Saltmarsh Festival', year: 2025, month: 8, minutes: 101,
      summary: 'The band close the festival with a sweaty, joyful midnight set that runs an hour past curfew.' },
    { slug: 'brass-winter-procession', name: 'The Winter Procession', venue: 'Old Town Streets', year: 2023, month: 12, minutes: 58,
      summary: 'Filmed as the band march the lantern procession through the old town, from the church steps to the harbour lights.' },
  ],
};

// VELA_MOCK_NOW pins the instant relative dates count from (parity captures on different days).
const fixtureNow = Date.parse(process.env.VELA_MOCK_NOW ?? '') || Date.now();
const artists: Title[] = [], albums: Title[] = [], tracks: Title[] = [], concerts: Title[] = [];
const audioSources = new Map<string, AudioSource>();
const childrenOf = new Map<string, Title[]>();
let trackOrdinal = 0;
for (const spec of artistSpecs) {
  const artistId = variant(`artist-${spec.slug}`, artists.length, 5);
  const personId = person(spec.slug, spec.name, 'Artist', 'Music', spec.bio);
  const composerId = spec.composer ? person(spec.composer.toLowerCase().replace(/[^a-z0-9]+/g, '-'), spec.composer, 'Composer', 'Music', `${spec.composer} is a fictional composer who writes for the ${spec.name}.`) : undefined;
  const artistAlbums: Title[] = [];
  const concertList = concertSpecs[spec.slug] ?? [];
  const artist: Title = { id: artistId, kind: 'show', name: spec.name, summary: spec.bio, year: spec.albums[0]?.year ?? concertList[0]!.year, genres: spec.genres,
    artwork: [mediaArtwork(artistId, 'square'), mediaArtwork(artistId, 'wide')],
    media: { class: 'music', role: 'artist', childCount: spec.albums.length + concertList.length,
      // Per child level, as a server with plugin levels counts them; a level with none is left out.
      childCounts: { ...(spec.albums.length ? { album: spec.albums.length } : {}), ...(concertList.length ? { concert: concertList.length } : {}) },
      credits: [{ name: spec.name, role: 'artist', personId }] } };
  artists.push(artist);
  spec.albums.forEach((album, albumIndex) => {
    const albumId = variant(`album-${album.slug}`, albums.length, 5), airDate = `${album.year}-${String(album.month).padStart(2, '0')}-${String(album.day ?? 3 + albumIndex * 7).padStart(2, '0')}`;
    const cover = mediaArtwork(albumId, 'square');
    const albumTracks: Title[] = [];
    album.discs.forEach((disc, discIndex) => disc.split('|').forEach((name, index) => {
      const clip = album.gapless ? gaplessSources.find(source => source.format === album.gapless && source.part === index + 1)! : musicClips[trackOrdinal++ % musicClips.length]!;
      const id = `track-${album.slug}-${discIndex + 1}-${String(index + 1).padStart(2, '0')}`;
      const recordingId = canonicalRecordingIds[name] ?? `US-VLA-${String(album.year).slice(-2)}-${String(tracks.length + albumTracks.length + 1).padStart(5, '0')}`;
      audioSources.set(id, clip);
      albumTracks.push({ id, kind: 'episode', name, summary: '', year: album.year, airDate, genres: spec.genres, durationSeconds: clip.durationSeconds,
        artwork: [cover], showId: artistId, showName: spec.name, seasonId: albumId, seasonNumber: albumIndex + 1, episodeNumber: albumTracks.length + 1,
        media: { class: 'music', role: 'track', index: index + 1, disc: discIndex + 1, recordingId,
          ...trackLoudness(id, clip.durationSeconds, albums.length),
          parents: [{ id: albumId, name: album.name, role: 'album' }, { id: artistId, name: spec.name, role: 'artist' }],
          credits: [{ name: spec.name, role: 'artist', personId }, ...(spec.composer ? [{ name: spec.composer, role: 'composer', personId: composerId }] : [])],
          facts: [{ label: 'ISRC', value: recordingId }, { label: 'Format', value: clip.codec.toUpperCase() }] } });
    }));
    // Album gain once every track of the album is measured (features.loudness.album).
    const measured = albumTracks.map(track => track.media?.loudness).filter(l => l?.source === 'measured');
    if (measured.length === albumTracks.length && measured.length) {
      const albumGainDb = Math.round(10 * -10 * Math.log10(measured.reduce((sum, l) => sum + 10 ** (-l!.trackGainDb / 10), 0) / measured.length)) / 10;
      const albumPeak = Math.max(...measured.map(l => l!.trackPeak ?? 0));
      for (const track of albumTracks) track.media!.loudness = { ...track.media!.loudness!, albumGainDb, albumPeak };
    }
    const albumTitle: Title = { id: albumId, kind: 'season', name: album.name, summary: album.summary, year: album.year, airDate, genres: spec.genres,
      durationSeconds: albumTracks.reduce((total, track) => total + (track.durationSeconds ?? 0), 0), artwork: [cover],
      showId: artistId, showName: spec.name, seasonNumber: albumIndex + 1,
      media: { class: 'music', role: 'album', parents: [{ id: artistId, name: spec.name, role: 'artist' }], childCount: albumTracks.length,
        credits: [{ name: spec.name, role: 'albumArtist', personId }],
        facts: [{ label: 'Label', value: spec.label }, { label: 'Released', value: airDate }, { label: 'Type', value: album.type },
          ...(album.discs.length > 1 ? [{ label: 'Discs', value: String(album.discs.length) }] : [])] } };
    albums.push(albumTitle); artistAlbums.push(albumTitle); tracks.push(...albumTracks);
    childrenOf.set(albumId, albumTracks);
  });
  // A concert is a video title: kind 'movie', media class video with the level's role, its artist as parent.
  const artistConcerts = concertList.map((concert, index): Title => {
    const id = variant(`concert-${concert.slug}`, concerts.length + index, 3);
    return { id, kind: 'movie', name: concert.name, summary: concert.summary, year: concert.year, airDate: `${concert.year}-${String(concert.month).padStart(2, '0')}-14`,
      genres: spec.genres, durationSeconds: concert.minutes * 60,
      ...(concert.positionSeconds ? { watch: { positionSeconds: concert.positionSeconds, played: false, favorite: false, watchlisted: false, lastViewedAt: new Date(fixtureNow - 3_600_000).toISOString() } } : {}),
      artwork: [mediaArtwork(id, 'wide', 'thumb'), mediaArtwork(id, 'wide', 'backdrop'), mediaArtwork(id, 'book', 'poster')],
      media: { class: 'video', role: 'concert', parents: [{ id: artistId, name: spec.name, role: 'artist' }],
        facts: [{ label: 'Venue', value: concert.venue }, { label: 'Filmed', value: `${concert.year}` }] } };
  });
  concerts.push(...artistConcerts);
  childrenOf.set(artistId, [...artistAlbums, ...artistConcerts]);
}

// ---------------------------------------------------------------------------------------------
// Books: series → book, plus standalone books.
interface SeriesSpec { slug: string; name: string; summary: string }
interface BookSpec { slug: string; name: string; year: number; author: [string, string]; genres: string[]; publisher: string; summary: string;
  format: ReadingFormat; pages: number; series?: [string, number]; illustrator?: [string, string]; progress?: { fraction: number; locator: string; label: string; daysAgo: number } }
const seriesSpecs: SeriesSpec[] = [
  { slug: 'saltglass-chronicles', name: 'The Saltglass Chronicles', summary: 'A fantasy trilogy about a harbour city built on glass made from the sea, and the cartographers sworn to map its shifting streets.' },
  { slug: 'inspector-wren', name: 'The Inspector Wren Mysteries', summary: 'Cosy coastal mysteries following a patient inspector and her bad-tempered terrier through a town with too many secrets.' },
];
const authorBios: Record<string, string> = {
  'ione-ashcombe': 'Ione Ashcombe is an imaginary novelist who writes maps before she writes chapters, and keeps a jar of sea glass on her desk.',
  'tobias-fenwright': 'Tobias Fenwright is a fictional former harbour clerk who turned his ledger of local gossip into a long-running mystery series.',
  'halina-brook': 'Halina Brook is an invented author of quiet, luminous novels about orchards, museums and the people who tend them.',
  'samir-holloway': 'Samir Holloway is a fictional essayist who writes on night crossings, timetables and the strange intimacy of travel.',
  'adaeze-linfield': 'Adaeze Linfield is a made-up nature writer and gardener whose books move at the pace of the seasons.',
  'ottilie-penhallow': 'Ottilie Penhallow is an imaginary illustrator and naturalist of birds that have never existed.',
  'juno-kestrel': 'Juno Kestrel is a fictional author of picture books and comics for readers who like lighthouses and cats.',
  'fen-arkwright': 'Fen Arkwright is an invented cartoonist with a fondness for thick ink lines and enormous skies.',
  'marguerite-oyelaran': 'Marguerite Oyelaran is a fictional science-fiction writer fascinated by small stars and the long distances between people.',
};
const bookSpecs: BookSpec[] = [
  { slug: 'saltglass-gate', name: 'The Saltglass Gate', year: 2015, author: ['ione-ashcombe', 'Ione Ashcombe'], genres: ['Fantasy'], publisher: 'Harbourlight Press', format: 'epub', pages: 412, series: ['saltglass-chronicles', 1],
    summary: 'Apprentice cartographer Teodora Vell discovers that the city’s glass gate opens onto streets that were never on any map.',
    progress: { fraction: 1, locator: 'epubcfi(/6/18!/4/2/14/1:0)', label: 'Finished', daysAgo: 40 } },
  { slug: 'harbour-of-bells', name: 'A Harbour of Bells', year: 2017, author: ['ione-ashcombe', 'Ione Ashcombe'], genres: ['Fantasy'], publisher: 'Harbourlight Press', format: 'epub', pages: 468, series: ['saltglass-chronicles', 2],
    summary: 'When the harbour bells ring on their own, Teodora must chart the drowned quarter before the tide takes the city.',
    progress: { fraction: 0.34, locator: 'epubcfi(/6/8!/4/2/10/1:20)', label: 'Chapter 3 · 34%', daysAgo: 1 } },
  { slug: 'drowned-cartographer', name: 'The Drowned Cartographer', year: 2020, author: ['ione-ashcombe', 'Ione Ashcombe'], genres: ['Fantasy'], publisher: 'Harbourlight Press', format: 'epub', pages: 503, series: ['saltglass-chronicles', 3],
    summary: 'The final voyage beneath the saltglass, where every map Teodora ever drew is waiting to be redrawn.' },
  { slug: 'death-at-low-tide', name: 'Death at Low Tide', year: 2012, author: ['tobias-fenwright', 'Tobias Fenwright'], genres: ['Mystery', 'Crime'], publisher: 'Gull & Lantern', format: 'epub', pages: 288, series: ['inspector-wren', 1],
    summary: 'A body on the mudflats, a missing rowing boat and a town that would rather the tide had kept its secret.' },
  { slug: 'clockmakers-alibi', name: 'The Clockmaker’s Alibi', year: 2014, author: ['tobias-fenwright', 'Tobias Fenwright'], genres: ['Mystery', 'Crime'], publisher: 'Gull & Lantern', format: 'epub', pages: 304, series: ['inspector-wren', 2],
    summary: 'Every clock in the shop stopped at the same minute. Inspector Wren suspects only one of them is lying.' },
  { slug: 'quiet-poison', name: 'A Quiet Poison', year: 2019, author: ['tobias-fenwright', 'Tobias Fenwright'], genres: ['Mystery', 'Crime'], publisher: 'Gull & Lantern', format: 'epub', pages: 336, series: ['inspector-wren', 3],
    summary: 'A village flower show, a prize-winning foxglove and a judge who never makes it to the final round.' },
  { slug: 'orchard-at-worlds-end', name: 'The Orchard at World’s End', year: 2021, author: ['halina-brook', 'Halina Brook'], genres: ['Literary Fiction'], publisher: 'Willow Lane Books', format: 'epub', pages: 352,
    summary: 'Three generations, one failing orchard and a single autumn in which everything is finally said aloud.',
    progress: { fraction: 0.71, locator: 'epubcfi(/6/14!/4/2/8/1:48)', label: 'Chapter 6 · 71%', daysAgo: 3 } },
  { slug: 'notes-from-a-night-ferry', name: 'Notes from a Night Ferry', year: 2018, author: ['samir-holloway', 'Samir Holloway'], genres: ['Essays', 'Travel'], publisher: 'Meridian House', format: 'epub', pages: 224,
    summary: 'Essays written on overnight crossings, about cabins, timetables and the people you meet at three in the morning.' },
  { slug: 'patient-garden', name: 'The Patient Garden', year: 2022, author: ['adaeze-linfield', 'Adaeze Linfield'], genres: ['Nature', 'Memoir'], publisher: 'Fieldfare Editions', format: 'epub', pages: 256,
    summary: 'A year spent restoring a neglected walled garden, and learning to wait for things that cannot be hurried.' },
  { slug: 'weight-of-small-stars', name: 'The Weight of Small Stars', year: 2024, author: ['marguerite-oyelaran', 'Marguerite Oyelaran'], genres: ['Science Fiction'], publisher: 'Meridian House', format: 'epub', pages: 384,
    summary: 'On a survey ship orbiting a red dwarf, a lonely navigator begins receiving letters from a crew member who died years ago.' },
  { slug: 'field-guide-imaginary-birds', name: 'A Field Guide to Imaginary Birds', year: 2019, author: ['ottilie-penhallow', 'Ottilie Penhallow'], genres: ['Art', 'Natural History'], publisher: 'Fieldfare Editions', format: 'pdf', pages: 6,
    summary: 'A slim illustrated guide to birds that have never existed, with notes on their songs, habits and preferred weather.' },
  { slug: 'captain-pebble', name: 'Captain Pebble and the Lighthouse Cat', year: 2023, author: ['juno-kestrel', 'Juno Kestrel'], illustrator: ['fen-arkwright', 'Fen Arkwright'], genres: ['Comics', 'Children'], publisher: 'Inkwell Harbour', format: 'cbz', pages: 8,
    summary: 'A small sea captain, a large orange cat and one very important lighthouse in a wordless comic adventure.' },
];
const series: Title[] = [], books: Title[] = [];
const readingSources = new Map<string, ReadingSource>();
for (const spec of seriesSpecs) {
  const members = bookSpecs.filter(book => book.series?.[0] === spec.slug);
  const [authorSlug, authorName] = members[0]!.author;
  const id = variant(`series-${spec.slug}`, series.length + 3, 7);
  series.push({ id, kind: 'show', name: spec.name, summary: spec.summary, year: members[0]!.year, genres: members[0]!.genres,
    artwork: [mediaArtwork(id, 'book')],
    media: { class: 'book', role: 'series', childCount: members.length, credits: [{ name: authorName, role: 'author', personId: person(authorSlug, authorName, 'Author', 'Writing', authorBios[authorSlug]!) }] } });
}
for (const spec of bookSpecs) {
  const id = variant(`book-${spec.slug}`, books.length, 7);
  const authorId = person(spec.author[0], spec.author[1], 'Author', 'Writing', authorBios[spec.author[0]]!);
  const parent = spec.series ? series.find(title => title.id === `series-${spec.series![0]}`)! : undefined;
  const watch: WatchState | undefined = spec.progress ? { positionSeconds: 0, played: spec.progress.fraction >= 0.98, favorite: false, watchlisted: false,
    lastViewedAt: new Date(fixtureNow - spec.progress.daysAgo * 86_400_000).toISOString(),
    reading: { locator: spec.progress.locator, fraction: spec.progress.fraction, label: spec.progress.label, updatedAt: new Date(fixtureNow - spec.progress.daysAgo * 86_400_000).toISOString() } } : undefined;
  readingSources.set(id, { file: `${id}.${spec.format}`, format: spec.format, mimeType: readingMimeTypes[spec.format] });
  const book: Title = { id, kind: parent ? 'episode' : 'movie', name: spec.name, summary: spec.summary, year: spec.year, airDate: `${spec.year}-09-01`, genres: spec.genres,
    artwork: [mediaArtwork(id, 'book')],
    ...(parent ? { showId: parent.id, showName: parent.name, seasonNumber: 1, episodeNumber: spec.series![1] } : {}),
    ...(watch ? { watch } : {}),
    media: { class: 'book', role: 'book', ...(parent ? { index: spec.series![1], parents: [{ id: parent.id, name: parent.name, role: 'series' as MediaRole }] } : {}),
      credits: [{ name: spec.author[1], role: 'author', personId: authorId },
        ...(spec.illustrator ? [{ name: spec.illustrator[1], role: 'illustrator', personId: person(spec.illustrator[0], spec.illustrator[1], 'Illustrator', 'Illustration', authorBios[spec.illustrator[0]]!) }] : [])],
      reading: { format: spec.format, pages: spec.pages },
      facts: [{ label: 'Publisher', value: spec.publisher }, { label: 'Published', value: String(spec.year) }, { label: 'Pages', value: String(spec.pages) }, { label: 'Format', value: spec.format.toUpperCase() }] } };
  books.push(book);
  if (parent) childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), book].sort((a, b) => (a.media!.index ?? 0) - (b.media!.index ?? 0)));
}

// ---------------------------------------------------------------------------------------------
// Audiobooks: single-file books with embedded chapters, and one multi-part book whose parts
// are child titles (role 'part'), as the contract's "parts as children".
const narratorBios: Record<string, string> = {
  'beatrix-thornfield': 'Beatrix Thornfield is a fictional narrator with a voice made for lamplit fiction and long sea voyages.',
  'elias-varno': 'Elias Varno is an invented actor and narrator known for unhurried, gently wry readings.',
  'rosalind-achterberg': 'Rosalind Achterberg is a made-up narrator who records in a converted chapel full of birdsong.',
  'callum-driscoll': 'Callum Driscoll is a fictional narrator whose winters-and-wolves voice suits slow northern stories.',
};
interface AudiobookSpec { slug: string; name: string; year: number; author: [string, string]; narrator: [string, string]; genres: string[]; publisher: string; summary: string;
  durationSeconds: number; chapters: string[]; positionSeconds?: number }
const audiobookSpecs: AudiobookSpec[] = [
  { slug: 'cartographers-daughter', name: 'The Cartographer’s Daughter', year: 2022, author: ['ione-ashcombe', 'Ione Ashcombe'], narrator: ['beatrix-thornfield', 'Beatrix Thornfield'], genres: ['Fantasy'], publisher: 'Harbourlight Audio',
    summary: 'A standalone tale from the world of the Saltglass Chronicles: a mapmaker’s daughter inherits an atlas that redraws itself every night.',
    durationSeconds: 270, positionSeconds: 137,
    chapters: ['Opening Credits', 'The Atlas', 'Ink and Salt', 'A Door in the Margin', 'The Night Survey', 'Compass Rose', 'Where the Coast Ends', 'Homecoming', 'End Credits'] },
  { slug: 'midnight-paper-museum', name: 'Midnight at the Paper Museum', year: 2023, author: ['halina-brook', 'Halina Brook'], narrator: ['elias-varno', 'Elias Varno'], genres: ['Literary Fiction'], publisher: 'Willow Lane Audio',
    summary: 'A night guard at a museum of paper discovers that the exhibits rearrange themselves after closing time.',
    durationSeconds: 330,
    chapters: ['Opening Credits', 'The First Round', 'Origami Hall', 'The Letter Room', 'Watermarks', 'The Map Collection', 'A Visitor after Hours', 'Folded Cranes', 'The Archive Stairs', 'Paper Lanterns', 'Dawn Shift', 'End Credits'] },
  { slug: 'short-history-of-tomorrow', name: 'A Short History of Tomorrow', year: 2021, author: ['samir-holloway', 'Samir Holloway'], narrator: ['samir-holloway', 'Samir Holloway'], genres: ['Essays'], publisher: 'Meridian Audio',
    summary: 'Eight short essays, read by the author, on calendars, forecasts and why we cannot stop imagining the day after this one.',
    durationSeconds: 252,
    chapters: ['Introduction', 'Calendars', 'Weather Forecasts', 'Timetables', 'Seed Catalogues', 'Letters to the Future', 'Alarm Clocks', 'Afterword'] },
  { slug: 'lantern-keepers-almanac', name: 'The Lantern Keeper’s Almanac', year: 2024, author: ['adaeze-linfield', 'Adaeze Linfield'], narrator: ['rosalind-achterberg', 'Rosalind Achterberg'], genres: ['Nature', 'Memoir'], publisher: 'Fieldfare Audio',
    summary: 'A year of notes kept by the last keeper of a lighthouse garden, one short chapter for each turn of the season.',
    durationSeconds: 360,
    chapters: ['Opening Credits', 'January', 'February', 'March', 'April', 'May', 'June', 'Midsummer', 'July', 'August', 'September', 'October', 'November', 'December', 'End Credits'] },
  { slug: 'seven-winters-in-vell', name: 'Seven Winters in Vell', year: 2020, author: ['tobias-fenwright', 'Tobias Fenwright'], narrator: ['callum-driscoll', 'Callum Driscoll'], genres: ['Historical Fiction'], publisher: 'Gull & Lantern Audio',
    summary: 'A young clerk is posted to a northern town for one winter, and stays for seven.',
    durationSeconds: 300,
    chapters: ['Opening Credits', 'The First Winter', 'The Second Winter', 'The Thaw Between', 'The Third Winter', 'The Fourth Winter', 'The Fifth Winter', 'The Sixth Winter', 'The Seventh Winter', 'End Credits'] },
];
const multiPart = { slug: 'long-voyage-of-the-marigold', name: 'The Long Voyage of the Marigold', year: 2025, author: ['juno-kestrel', 'Juno Kestrel'] as [string, string],
  narrator: ['beatrix-thornfield', 'Beatrix Thornfield'] as [string, string], genres: ['Adventure', 'Children'], publisher: 'Inkwell Harbour Audio',
  summary: 'An unabridged family adventure in four parts: a small ship, a smaller crew and a very long way to go.',
  parts: [
    { name: 'Part One: Leaving Harbour', durationSeconds: 96, chapters: ['Opening Credits', 'The Marigold', 'Casting Off'] },
    { name: 'Part Two: The Doldrums', durationSeconds: 112, chapters: ['No Wind at All', 'The Message in the Barrel', 'A Change in the Sky'] },
    { name: 'Part Three: The Storm', durationSeconds: 84, chapters: ['Reefing the Sails', 'The Long Night'] },
    { name: 'Part Four: Landfall', durationSeconds: 120, chapters: ['Gulls', 'The Unknown Shore', 'Home Again', 'End Credits'] },
  ], inProgress: { part: 2, positionSeconds: 41 } };

/** Chapter boundaries for a file: whole seconds, credits short, ends exactly at the duration. */
function layoutChapters(id: string, durationSeconds: number, names: string[]): Chapter[] {
  const seed = mediaSeed(id);
  const weights = names.map((name, index) => /credits/i.test(name) ? 0.35 : 0.8 + ((seed >>> (index % 24)) % 9) / 10);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = 0;
  return names.map((name, index) => {
    const startSeconds = Math.round(at);
    at += weights[index]! / total * durationSeconds;
    return { id: `${id}-chapter-${index + 1}`, name, startSeconds, endSeconds: index === names.length - 1 ? durationSeconds : Math.round(at) };
  });
}
const audiobooks: Title[] = [], parts: Title[] = [];
const chaptersOf = new Map<string, Chapter[]>();
/** Files the audiobook generator writes, with chapter starts it marks with a chime. */
export const audiobookFiles: { titleId: string; file: string; durationSeconds: number; chapters: Chapter[] }[] = [];
const audiobookFacts = (publisher: string, durationSeconds: number) => [{ label: 'Publisher', value: publisher }, { label: 'Edition', value: 'Unabridged' },
  { label: 'Length', value: `${Math.floor(durationSeconds / 60)} min ${durationSeconds % 60} s` }];
const audiobookCredits = (author: [string, string], narrator: [string, string]) => [
  { name: author[1], role: 'author', personId: person(author[0], author[1], 'Author', 'Writing', authorBios[author[0]]!) },
  { name: narrator[1], role: 'narrator', personId: person(narrator[0], narrator[1], 'Narrator', 'Narration', narratorBios[narrator[0]] ?? authorBios[narrator[0]]!) },
];
for (const spec of audiobookSpecs) {
  const id = variant(`audiobook-${spec.slug}`, audiobooks.length + 2, 5);
  const chapters = layoutChapters(id, spec.durationSeconds, spec.chapters);
  chaptersOf.set(id, chapters);
  const source: AudioSource = { file: `${id}.m4a`, durationSeconds: spec.durationSeconds, mimeType: 'audio/mp4', codec: 'aac' };
  audioSources.set(id, source);
  audiobookFiles.push({ titleId: id, file: source.file, durationSeconds: spec.durationSeconds, chapters });
  audiobooks.push({ id, kind: 'movie', name: spec.name, summary: spec.summary, year: spec.year, airDate: `${spec.year}-03-15`, genres: spec.genres, durationSeconds: spec.durationSeconds,
    artwork: [mediaArtwork(id, 'square')],
    ...(spec.positionSeconds ? { watch: { positionSeconds: spec.positionSeconds, played: false, favorite: false, watchlisted: false, lastViewedAt: new Date(fixtureNow - 7_200_000).toISOString() } } : {}),
    media: { class: 'audiobook', role: 'audiobook', credits: audiobookCredits(spec.author, spec.narrator), facts: audiobookFacts(spec.publisher, spec.durationSeconds) } });
}
{
  const id = variant(`audiobook-${multiPart.slug}`, 9, 5);
  const total = multiPart.parts.reduce((sum, part) => sum + part.durationSeconds, 0);
  const credits = audiobookCredits(multiPart.author, multiPart.narrator);
  const children: Title[] = [];
  let offset = 0;
  const bookChapters: Chapter[] = [];
  multiPart.parts.forEach((spec, index) => {
    const partId = `${id}-part-${index + 1}`;
    const chapters = layoutChapters(partId, spec.durationSeconds, spec.chapters);
    chaptersOf.set(partId, chapters);
    bookChapters.push({ id: `${id}-chapter-${index + 1}`, name: spec.name, startSeconds: offset, endSeconds: offset + spec.durationSeconds });
    offset += spec.durationSeconds;
    const source: AudioSource = { file: `${partId}.m4a`, durationSeconds: spec.durationSeconds, mimeType: 'audio/mp4', codec: 'aac' };
    audioSources.set(partId, source);
    audiobookFiles.push({ titleId: partId, file: source.file, durationSeconds: spec.durationSeconds, chapters });
    const inProgress = multiPart.inProgress.part === index + 1;
    children.push({ id: partId, kind: 'episode', name: spec.name, summary: `Part ${index + 1} of ${multiPart.parts.length} of ${multiPart.name}.`, year: multiPart.year, genres: multiPart.genres,
      durationSeconds: spec.durationSeconds, artwork: [mediaArtwork(partId, 'square')], showId: id, showName: multiPart.name, seasonNumber: 1, episodeNumber: index + 1,
      ...(index + 1 < multiPart.inProgress.part ? { watch: { positionSeconds: 0, played: true, favorite: false, watchlisted: false } } : {}),
      ...(inProgress ? { watch: { positionSeconds: multiPart.inProgress.positionSeconds, played: false, favorite: false, watchlisted: false, lastViewedAt: new Date(fixtureNow - 86_400_000).toISOString() } } : {}),
      media: { class: 'audiobook', role: 'part', index: index + 1, parents: [{ id, name: multiPart.name, role: 'audiobook' }], credits } });
  });
  chaptersOf.set(id, bookChapters);
  parts.push(...children);
  childrenOf.set(id, children);
  audiobooks.push({ id, kind: 'show', name: multiPart.name, summary: multiPart.summary, year: multiPart.year, airDate: `${multiPart.year}-05-20`, genres: multiPart.genres, durationSeconds: total,
    artwork: [mediaArtwork(id, 'square')],
    media: { class: 'audiobook', role: 'audiobook', childCount: children.length, credits, facts: [...audiobookFacts(multiPart.publisher, total), { label: 'Parts', value: String(children.length) }] } });
}

// ---------------------------------------------------------------------------------------------
// Podcasts: show → episode, newest first. Episodes play the audiobook generator's spoken-word
// stand-ins (no files of their own), with podcast chapter names over the same chimes. One episode
// is under way, older ones are played, the newest of each show is new.
const hostBios: Record<string, string> = {
  'wren-alcott': 'Wren Alcott is a fictional radio maker who has never once finished a cup of tea while it was still warm.',
  'dev-marchetti': 'Dev Marchetti is an invented science writer who keeps a shed full of instruments that measure nothing in particular.',
  'oona-fairweather': 'Oona Fairweather is a made-up walker and storyteller who records every episode outdoors, whatever the weather.',
  'teo-brannigan': 'Teo Brannigan is an imaginary co-host whose questions are always better than his answers.',
};
interface ShowSpec { slug: string; name: string; hosts: [string, string][]; genres: string[]; publisher: string; summary: string; episodes: { name: string; summary: string; daysAgo: number; positionFraction?: number; played?: boolean }[] }
const showSpecs: ShowSpec[] = [
  { slug: 'kettle-and-compass', name: 'Kettle & Compass', hosts: [['wren-alcott', 'Wren Alcott']], genres: ['Society & Culture'], publisher: 'Lamplit Radio',
    summary: 'Small stories from far-off kitchens: every week, one recipe, one journey and the person who carried it home.',
    episodes: [
      { name: 'The Lighthouse Keeper’s Porridge', summary: 'Oats, salt and a very long night on a rock in the middle of the sea.', daysAgo: 2 },
      { name: 'A Samovar on the Night Train', summary: 'Tea, glass holders and the conductor who kept everyone awake.', daysAgo: 9, positionFraction: 0.42 },
      { name: 'Bread from the Saltglass Bakery', summary: 'A recipe that changes with the tide, and the baker who never writes it down.', daysAgo: 16, played: true },
      { name: 'Picnic at the Edge of the Map', summary: 'What three cartographers ate on the last unsurveyed hill.', daysAgo: 23, played: true },
      { name: 'Soup for a Snowed-in Village', summary: 'One pot, forty neighbours and a week without roads.', daysAgo: 30, played: true },
    ] },
  { slug: 'small-instruments', name: 'Small Instruments', hosts: [['dev-marchetti', 'Dev Marchetti'], ['teo-brannigan', 'Teo Brannigan']], genres: ['Science'], publisher: 'Fieldfare Audio',
    summary: 'Two friends take apart one ordinary measuring device each week and find the universe inside it.',
    episodes: [
      { name: 'The Rain Gauge', summary: 'How much is a millimetre of rain, and who decided?', daysAgo: 4 },
      { name: 'The Kitchen Scale', summary: 'Springs, strain gauges and the weight of a single grain of rice.', daysAgo: 11 },
      { name: 'The Sundial', summary: 'Telling time with a shadow, and why it is always a little wrong.', daysAgo: 18, played: true },
      { name: 'The Barometer', summary: 'A column of mercury that predicts picnics.', daysAgo: 25 },
    ] },
  { slug: 'long-way-round', name: 'The Long Way Round', hosts: [['oona-fairweather', 'Oona Fairweather']], genres: ['Travel', 'Nature'], publisher: 'Gull & Lantern Audio',
    summary: 'Slow walks along old paths, recorded as they happen: footsteps, weather and whoever we meet on the way.',
    episodes: [
      { name: 'The Coffin Road', summary: 'A path the dead were carried along, now walked by hikers and sheep.', daysAgo: 6 },
      { name: 'Along the Old Canal', summary: 'Locks, herons and a narrowboat that has not moved in twenty years.', daysAgo: 20 },
      { name: 'Over the Saltmarsh at Dawn', summary: 'Tides, mud and the loudest birds in the county.', daysAgo: 34, played: true },
    ] },
];
const shows: Title[] = [], episodes: Title[] = [];
const podcastSegments = ['This week', 'The story', 'Out in the field', 'A word from a listener', 'The long answer', 'What we got wrong', 'One more thing', 'Coming up', 'The quick round', 'Letters', 'Postscript', 'Notes from the road', 'Housekeeping'];
const podcastChapterNames = (count: number) => Array.from({ length: count }, (_, index) => index === 0 ? 'Cold open' : index === count - 1 ? 'Outro and thanks' : podcastSegments[(index - 1) % podcastSegments.length]!);
let episodeOrdinal = 0;
for (const spec of showSpecs) {
  const id = variant(`podcast-${spec.slug}`, shows.length * 2 + 1, 5);
  const credits = spec.hosts.map(([slug, name]) => ({ name, role: 'host', personId: person(slug, name, 'Host', 'Podcasts', hostBios[slug]!) }));
  const children = spec.episodes.map((episode, index): Title => {
    const file = audiobookFiles.filter(f => !/-part-/.test(f.titleId))[episodeOrdinal++ % audiobookSpecs.length]!;
    const episodeId = `${id}-episode-${spec.episodes.length - index}`;
    audioSources.set(episodeId, { file: file.file, durationSeconds: file.durationSeconds, mimeType: 'audio/mp4', codec: 'aac' });
    const names = podcastChapterNames(file.chapters.length);
    chaptersOf.set(episodeId, file.chapters.map((chapter, n) => ({ ...chapter, id: `${episodeId}-chapter-${n + 1}`, name: names[n]! })));
    const airDate = new Date(fixtureNow - episode.daysAgo * 86_400_000).toISOString().slice(0, 10);
    const position = episode.positionFraction ? Math.round(file.durationSeconds * episode.positionFraction) : 0;
    return { id: episodeId, kind: 'episode', name: episode.name, summary: episode.summary, year: Number(airDate.slice(0, 4)), airDate, genres: spec.genres,
      durationSeconds: file.durationSeconds, artwork: [mediaArtwork(id, 'square')], showId: id, showName: spec.name, seasonNumber: 1, episodeNumber: spec.episodes.length - index,
      ...(episode.played ? { watch: { positionSeconds: 0, played: true, favorite: false, watchlisted: false, lastViewedAt: new Date(fixtureNow - (episode.daysAgo - 1) * 86_400_000).toISOString() } } : {}),
      ...(position ? { watch: { positionSeconds: position, played: false, favorite: false, watchlisted: false, lastViewedAt: new Date(fixtureNow - 5_400_000).toISOString() } } : {}),
      media: { class: 'podcast', role: 'episode', index: spec.episodes.length - index, parents: [{ id, name: spec.name, role: 'show' }], credits } };
  });
  childrenOf.set(id, children);
  episodes.push(...children);
  shows.push({ id, kind: 'show', name: spec.name, summary: spec.summary, year: Number(children[children.length - 1]!.airDate!.slice(0, 4)), airDate: children[0]!.airDate, genres: spec.genres,
    artwork: [mediaArtwork(id, 'square')],
    media: { class: 'podcast', role: 'show', childCount: children.length, credits, facts: [{ label: 'Publisher', value: spec.publisher }, { label: 'Episodes', value: String(children.length) }] } });
}

// ---------------------------------------------------------------------------------------------
// Photos: one level of pictures (class photo), drawn as procedural scenes by the mock.
const photoSpecs: { slug: string; name: string; daysAgo: number; place: string }[] = [
  { slug: 'harbour-at-dawn', name: 'Harbour at dawn', daysAgo: 3, place: 'North Quay' },
  { slug: 'orchard-in-fog', name: 'Orchard in fog', daysAgo: 9, place: 'Ashby' },
  { slug: 'saltmarsh-evening', name: 'Saltmarsh, evening', daysAgo: 14, place: 'Saltmarsh' },
  { slug: 'lighthouse-path', name: 'The lighthouse path', daysAgo: 21, place: 'Gull Point' },
  { slug: 'first-snow', name: 'First snow on the hill', daysAgo: 40, place: 'Vell' },
  { slug: 'summer-meadow', name: 'Summer meadow', daysAgo: 120, place: 'Long Field' },
  { slug: 'night-ferry', name: 'From the night ferry', daysAgo: 160, place: 'The crossing' },
  { slug: 'garden-wall', name: 'The walled garden', daysAgo: 200, place: 'Fieldfare House' },
];
const photos: Title[] = photoSpecs.map((spec, index) => {
  const id = variant(`photo-${spec.slug}`, index * 5 + 2, 7);
  const airDate = new Date(fixtureNow - spec.daysAgo * 86_400_000).toISOString().slice(0, 10);
  return { id, kind: 'movie', name: spec.name, summary: '', year: Number(airDate.slice(0, 4)), airDate, genres: [],
    artwork: [mediaArtwork(id, 'square'), mediaArtwork(id, 'wide', 'backdrop'), mediaArtwork(id, 'wide', 'thumb')],
    media: { class: 'photo', role: 'item', facts: [{ label: 'Place', value: spec.place }, { label: 'Taken', value: airDate }] } };
});

// ---------------------------------------------------------------------------------------------
export const mediaGroups = { artists, albums, tracks, concerts, series, books, audiobooks, parts, shows, episodes, photos };
/** Shared, mutable fixture titles; the mock updates their watch state in place, like the video catalogue. */
export const mediaTitles: Title[] = [...artists, ...albums, ...tracks, ...concerts, ...series, ...books, ...audiobooks, ...parts, ...shows, ...episodes, ...photos];
const byId = new Map(mediaTitles.map(title => [title.id, title]));
export const mediaTitle = (id: string): Title | undefined => byId.get(id);
/** A title's children; `level` (a role, or the level key for a role-less level) keeps one child level. */
export const mediaChildren = (id: string, level?: string): Title[] => (childrenOf.get(id) ?? []).filter(child => !level || child.media?.role === level);
/** A video child level (concerts): plays as video, whatever its library's class. */
export const isVideoChild = (title: Title): boolean => title.media?.class === 'video';
export const audioSourceFor = (id: string): AudioSource | undefined => audioSources.get(id);
export const readingSourceFor = (id: string): ReadingSource | undefined => readingSources.get(id);
export const mediaChapters = (id: string): Chapter[] => chaptersOf.get(id) ?? [];
export const mediaPeople: MediaPerson[] = [...people.values()];
export const mediaPerson = (id: string): MediaPerson | undefined => people.get(id);
export const mediaPersonArtwork = (id: string): ArtworkRef => mediaArtwork(id, 'square', 'person');
export const creditLabel = (role: string): string => roleLabel[role] ?? role;
/** Titles that credit a person, with the credit as a role label. Artists credit their albums. */
export function mediaPersonTitles(personId: string): { title: Title; role: string }[] {
  return [...artists, ...albums, ...series, ...books, ...audiobooks, ...shows, ...levels.photos!['']!].flatMap(title => {
    const credit = title.media?.credits?.find(value => value.personId === personId);
    if (!credit || title.media?.role === 'artist') return [];
    return [{ title, role: creditLabel(credit.role) }];
  });
}
/** Children are a playable/openable leaf's container: tracks (disc, index), albums, books, parts. */
export function mediaDetail(id: string): TitleDetail | undefined {
  const title = byId.get(id);
  if (!title?.media) return undefined;
  const children = mediaChildren(id);
  const playable = !!audioSources.get(id) || isVideoChild(title);
  return { title, canPlay: playable,
    ...(title.media.role === 'artist' ? { seasons: children.filter(child => !isVideoChild(child)) } : children.length ? { episodes: children } : {}),
    extras: [], chapters: mediaChapters(id), cast: [],
    crew: (title.media.credits ?? []).map(credit => ({ ...(credit.personId ? { id: credit.personId } : {}), name: credit.name, role: creditLabel(credit.role) })) };
}

// ---------------------------------------------------------------------------------------------
// Libraries
const sorts: LibraryBrowseOptions['sorts'] = [{ id: 'index', directions: ['asc'] }, { id: 'title', directions: ['asc', 'desc'] }, { id: 'year', directions: ['asc', 'desc'] }];
const genresOf = (items: Title[]) => [...new Set(items.flatMap(title => title.genres))];
export const mediaLibraries: Library[] = [
  // Every library names how it opens (features.libraryExperiences): music and the spoken-word
  // libraries listen, books read, photos are a gallery.
  { id: 'music', name: 'Music', kind: 'shows', media: 'music', experience: 'listen', presentation: { card: 'square' }, artwork: [mediaArtwork(artists[0]!.id, 'wide')],
    tabs: [
      { id: 'recommended', label: 'Recommendations', kind: 'recommended' },
      // A second recommended tab with its own shelves and card (features.pluginLevels).
      { id: 'concerts', label: 'Concerts', kind: 'recommended', card: 'landscape' },
      { id: 'artists', label: 'Artists', kind: 'library' },
      { id: 'albums', label: 'Albums', kind: 'library', level: 'album' },
      { id: 'tracks', label: 'Tracks', kind: 'library', level: 'track', layout: 'list' },
    ],
    browse: { sorts, defaultSort: 'index', defaultDirection: 'asc', filters: { genre: true, genres: genresOf(artists), year: true, favorite: true } } },
  { id: 'books', name: 'Books', kind: 'mixed', media: 'book', experience: 'read', presentation: { card: 'poster' }, artwork: [mediaArtwork(books[0]!.id, 'book')],
    tabs: [
      { id: 'recommended', label: 'Recommendations', kind: 'recommended' },
      { id: 'library', label: 'Library', kind: 'library' },
      { id: 'all-books', label: 'All books', kind: 'library', level: 'book' },
      { id: 'series', label: 'Series', kind: 'library', level: 'series' },
      { id: 'authors', label: 'Authors', kind: 'people', facet: 'author', order: 'name' },
    ],
    browse: { sorts, defaultSort: 'index', defaultDirection: 'asc',
      filters: { facets: [{ id: 'author', label: 'Author', type: 'people', multi: true }], genre: true, genres: genresOf(books), year: true, played: true, favorite: true } } },
  { id: 'audiobooks', name: 'Audiobooks', kind: 'mixed', media: 'audiobook', experience: 'listen', presentation: { card: 'square' }, artwork: [mediaArtwork(audiobooks[0]!.id, 'square')],
    tabs: [
      { id: 'recommended', label: 'Recommendations', kind: 'recommended' },
      { id: 'library', label: 'Library', kind: 'library' },
      { id: 'authors', label: 'Authors', kind: 'people', facet: 'author', order: 'name' },
      { id: 'narrators', label: 'Narrators', kind: 'people', facet: 'narrator', order: 'name' },
    ],
    browse: { sorts, defaultSort: 'index', defaultDirection: 'asc',
      filters: { facets: [{ id: 'author', label: 'Author', type: 'people', multi: true }, { id: 'narrator', label: 'Narrator', type: 'people', multi: true }],
        genre: true, genres: genresOf(audiobooks), year: true, played: true, favorite: true } } },
  { id: 'podcasts', name: 'Podcasts', kind: 'shows', media: 'podcast', experience: 'listen', presentation: { card: 'square' }, artwork: [mediaArtwork(shows[0]!.id, 'square')],
    tabs: [
      { id: 'recommended', label: 'Recommendations', kind: 'recommended' },
      { id: 'shows', label: 'Shows', kind: 'library' },
      { id: 'episodes', label: 'Episodes', kind: 'library', level: 'episode', layout: 'list' },
      { id: 'hosts', label: 'Hosts', kind: 'people', facet: 'host', order: 'name' },
    ],
    browse: { sorts, defaultSort: 'index', defaultDirection: 'asc',
      filters: { facets: [{ id: 'host', label: 'Host', type: 'people', multi: true }], genre: true, genres: genresOf(shows), year: true, played: true, favorite: true } } },
  { id: 'photos', name: 'Photos', kind: 'mixed', media: 'photo', experience: 'gallery', presentation: { card: 'square' }, artwork: [mediaArtwork(photos[0]!.id, 'wide')],
    tabs: [{ id: 'library', label: 'All photos', kind: 'library' }],
    browse: { sorts: [{ id: 'released', directions: ['desc', 'asc'] }, { id: 'title', directions: ['asc', 'desc'] }], defaultSort: 'released', defaultDirection: 'desc', filters: { year: true, favorite: true } } },
];
export const isMediaLibrary = (id: string): boolean => mediaLibraries.some(library => library.id === id);
const levels: Record<string, Record<string, Title[]>> = {
  music: { '': artists, artist: artists, album: albums, track: tracks, concert: concerts },
  books: { '': [...series, ...books.filter(book => !book.media?.parents?.length)], series, book: books },
  audiobooks: { '': audiobooks, audiobook: audiobooks, part: parts },
  podcasts: { '': shows, show: shows, episode: episodes },
  photos: { '': photos },
};
/** Root level by default; a level key lists that level. Undefined for an unknown library or level. */
export function mediaLibraryEntries(libraryId: string, level = ''): RowEntry[] | undefined {
  const items = levels[libraryId]?.[level];
  return items?.map(title => ({ id: `${libraryId}:${title.id}`, kind: 'title', title: { ...title }, receiptToken: '' }));
}
/** People credited in a library under a credit role (author, narrator), with their title counts. */
export function mediaLibraryPeople(libraryId: string, creditRole: string): { person: MediaPerson; itemCount: number }[] {
  const counts = new Map<string, number>();
  for (const entry of mediaLibraryEntries(libraryId, libraryId === 'books' ? 'book' : '') ?? []) if (entry.kind === 'title')
    for (const credit of entry.title.media?.credits ?? []) if (credit.role === creditRole && credit.personId) counts.set(credit.personId, (counts.get(credit.personId) ?? 0) + 1);
  return [...counts].map(([id, itemCount]) => ({ person: people.get(id)!, itemCount }));
}

/** Optional mock catalogue. The baseline Photos fixtures stay intact for parity captures. */
export function enableGalleryFixtures(scale: number): void {
  const library = mediaLibraries.find(item => item.id === 'photos')!;
  if (library.tabs?.some(tab => tab.id === 'photo-albums')) return;
  const subjects = [
    { id: person('elena-rivers', 'Elena Rivers', 'subject', 'Photography', ''), name: 'Elena Rivers' },
    { id: person('sam-calder', 'Sam Calder', 'subject', 'Photography', ''), name: 'Sam Calder' },
  ];
  const galleryAlbums: Title[] = [];
  const galleryPhotos = photos.map(title => ({ ...title, media: { ...title.media! } }));
  const count = Number.isFinite(scale) ? Math.min(20_000, Math.floor(scale)) : 0;
  for (let index = photos.length; index < count; index++) {
    const id = `photo-gallery-${index + 1}`;
    const airDate = new Date(fixtureNow - (201 + Math.floor((index - photos.length) / 12)) * 86_400_000).toISOString().slice(0, 10);
    galleryPhotos.push({
      id, kind: 'movie', name: `Field notes ${index + 1}`, summary: '', year: Number(airDate.slice(0, 4)), airDate, genres: [],
      artwork: [mediaArtwork(id, 'square'), mediaArtwork(id, 'wide', 'backdrop'), mediaArtwork(id, 'wide', 'thumb')],
      media: { class: 'photo', role: 'item', facts: [{ label: 'Taken', value: airDate }] },
    });
  }
  for (const [index, name] of ['Along the coast', 'A year outdoors'].entries()) {
    const id = `photo-album-${index + 1}`;
    const children = galleryPhotos.filter((_, position) => position % subjects.length === index);
    for (const child of children) child.media!.parents = [{ id, name, role: 'album' }];
    const cover = children[0]!;
    galleryAlbums.push({
      id, kind: 'movie', name, summary: '', airDate: cover.airDate, year: cover.year, genres: [], artwork: cover.artwork,
      media: { class: 'photo', role: 'album', childCount: children.length },
    });
    childrenOf.set(id, children);
  }
  // Make the subjects cross album boundaries so a viewer sequence can prove which grid opened it.
  galleryPhotos.forEach((photo, index) => {
    const subject = subjects[(index + Math.floor(index / 2)) % subjects.length]!;
    photo.media!.credits = [{ name: subject.name, personId: subject.id, role: 'subject' }];
  });
  levels.photos = { '': galleryPhotos, item: galleryPhotos, album: galleryAlbums };
  for (const title of [...galleryPhotos, ...galleryAlbums]) byId.set(title.id, title);
  library.tabs = [
    { id: 'library', label: 'All photos', kind: 'library', level: 'item' },
    { id: 'photo-albums', label: 'Albums', kind: 'library', level: 'album' },
    { id: 'photo-people', label: 'People', kind: 'people', facet: 'subject', order: 'name' },
  ];
}
