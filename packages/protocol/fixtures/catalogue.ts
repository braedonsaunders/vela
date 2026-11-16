import type { ArtworkRef, Channel, Extra, Hero, Programme, Row, Title, TitleDetail } from '../types';

export function artwork(id: string, kind: ArtworkRef['kind'] = 'poster'): ArtworkRef {
  const wide = kind !== 'poster';
  return { id: `${id}-${kind}`, kind, tag: 'fixture-v2', color: '#293443', sizes: (wide ? [640, 1280] : [240, 480]).map(width => ({ width, height: Math.round(width * (wide ? 9 / 16 : 3 / 2)), url: `/vela/v0/artwork/${id}?kind=${kind}&width=${width}&v=2` })) };
}
const collections = [
  ['Beyond the horizon', 'The Last Observatory', 'A Map of Quiet Stars', 'Signal from Europa', 'The Long Orbit', 'Under a Copper Sky', 'The Glass Planet', 'After the Comet', 'Dawn at Meridian', 'The Gravity Garden', 'Passengers of Light', 'A Thousand Small Suns', 'The Far Shore', 'Orbit of Silence', 'The Ninth Moon', 'The Blue Interval'],
  ['An evening elsewhere', 'Letters from Lisbon', 'The Midnight Tram', 'A Table for Three', 'Summer on the Quay', 'The Borrowed Bicycle', 'Saturday in October', 'The Bookshop Upstairs', 'Rain over Kyoto', 'The Last Ferry Home', 'The Orange Grove', 'The Secret Courtyard', 'One More Espresso', 'The Apartment on Via Roma', 'Two Days in June', 'The Postcard Collector'],
  ['Edge of your seat', 'The Narrow Bridge', 'Northbound at Midnight', 'The Silent Witness', 'A Second Exit', 'The Winter Cipher', 'Below the Waterline', 'The Missing Hour', 'The Third Passenger', 'Cold Signal', 'The River Knows', 'The Last Switch', 'Seven Locked Doors', 'The Unmarked Road', 'The Quiet Alarm', 'No Lights on the Pier'],
  ['Our living world', 'Forests after Rain', 'The Hidden Coast', 'A Year with the Wolves', 'River of Ice', 'Under the Canopy', 'Songs of the Deep', 'The Patient Mountain', 'Islands at Dawn', 'Wild City Nights', 'The Smallest Wilderness', 'When the Tides Return', 'The Desert in Bloom', 'On Ancient Wings', 'The Shape of Snow', 'Life beneath the Roots'],
  ['Human stories', 'The Piano Tuner', 'A Place at the Window', 'The Distance Between Us', 'Small Repairs', 'The Family Photograph', 'A House of Paper', 'The Sunday Match', 'The Last Summer Job', 'Ordinary Miracles', 'The Long Way Round', 'A Room with Music', 'The Garden Fence', 'What We Carried', 'The Second Season', 'Someone to Call'],
  ['After hours', 'Neon Harbour', 'The Amber Room', 'City of Echoes', 'Night Service', 'The Velvet Hour', 'South of the Station', 'The Record Store', 'Electric Weather', 'The Rooftop Club', 'A Different Frequency', 'Last Call at Orion', 'The Side Street', 'The Silver Taxi', 'Tomorrow at Two', 'The Night Archivist'],
];
const genres = [['Science Fiction', 'Adventure'], ['Romance', 'Comedy'], ['Thriller', 'Mystery'], ['Documentary', 'Nature'], ['Drama'], ['Drama', 'Mystery']];
export const titles: Title[] = collections.flatMap(([_, ...names], row) => names.map((name, n): Title => ({
  id: `title-${row + 1}-${n + 1}`, kind: 'movie', name, year: 2012 + (row * 3 + n) % 14,
  summary: [
    'A remote research crew follows a faint transmission that challenges everything they know about the journey home.',
    'An unexpected meeting changes the plans of two travellers, one long afternoon and a city full of small surprises.',
    'A routine assignment becomes a race to uncover the truth before the last safe route disappears.',
    'An intimate journey through a changing landscape, following the people and wildlife who call it home.',
    'An estranged family returns to familiar streets and discovers the quiet courage it takes to begin again.',
    'Across one sleepless night, the lives of strangers intersect beneath the lights of a harbour city.',
  ][row]!, genres: genres[row]!, rating: row === 2 ? 'TV-14' : 'PG', durationSeconds: 5400 + n * 180,
  artwork: [artwork(`title-${row + 1}-${n + 1}`), artwork(`title-${row + 1}-${n + 1}`, 'backdrop')],
  ...(row === 0 && n < 3 ? { watch: { positionSeconds: 12 + n * 8, played: false, favorite: n === 0, watchlisted: false } } : {}),
})));
const show: Title = { id: 'show-meridian', kind: 'show', name: 'Meridian Station', summary: 'At a remote coastal weather station, a new team maps the strange rhythms of an isolated island.', year: 2025, genres: ['Drama', 'Mystery'], rating: 'TV-14', artwork: [artwork('show-meridian'), artwork('show-meridian', 'backdrop')] };
export const seasons: Title[] = [1, 2].map(n => ({ ...show, id: `season-meridian-${n}`, kind: 'season', name: `Season ${n}`, showId: show.id, showName: show.name, seasonNumber: n }));
export const episodes: Title[] = seasons.flatMap(s => ['Arrival', 'The Night Watch', 'Pressure Drop', 'A Distant Light', 'The Sounding', 'Home Waters'].map((name, i) => ({ ...show, id: `episode-${s.seasonNumber}-${i + 1}`, kind: 'episode', name, showId: show.id, showName: show.name, seasonId: s.id, seasonNumber: s.seasonNumber, episodeNumber: i + 1, airDate: `2025-0${s.seasonNumber}-${String(i + 1).padStart(2, '0')}`, durationSeconds: 180, watch: { positionSeconds: i === 1 ? 68 : 0, played: i === 0, favorite: false, watchlisted: false } })));
titles.splice(14, 1, show);
// Fictional follow-up titles keep the twenty-card first pages genuinely pageable.
const additionalTitles: Title[] = collections.flatMap((_, row) => Array.from({ length: 12 }, (_, n) => {
  const base = titles[row * 15 + n]!, id = `title-${row + 1}-${n + 16}`;
  return { ...base, id, name: `${base.name} — ${['Afterlight', 'Homecoming', 'The Crossing', 'Another Season'][n % 4]}`, watch: undefined,
    artwork: [artwork(id), artwork(id, 'backdrop')] };
}));
titles.push(...additionalTitles);
export const allTitles = [...titles, ...seasons, ...episodes];
export const extras: Extra[] = [{ id: 'extra-observatory-preview', parentId: titles[0]!.id, kind: 'trailer', name: 'Synthetic cached preview', durationSeconds: 180, availability: 'ready' }, { id: 'extra-meridian-trailer', parentId: show.id, kind: 'trailer', name: 'Meridian Station — First Look', durationSeconds: 60, availability: 'ready' }];
export function detail(id: string): TitleDetail | undefined {
  const title = allTitles.find(t => t.id === id);
  return title && { title, canPlay: title.kind === 'movie' || title.kind === 'episode',
    ...(title.kind === 'show' ? { seasons, episodes: episodes.filter(e => e.seasonId === seasons[0]?.id) } : title.kind === 'season' ? { seasons, episodes: episodes.filter(e => e.seasonId === id) } : {}),
    extras: extras.filter(e => e.parentId === id), chapters: [], cast: [] };
}
// Unbound fixtures are bound to a grant by the HTTP layer before delivery.
export const featuredSources: (Pick<Hero, 'title' | 'reason' | 'action' | 'label'> & { rowId: string })[] = [
  { title: titles[0]!, rowId: 'row-1', reason: 'resume', action: { kind: 'resume', titleId: titles[0]!.id, positionSeconds: titles[0]!.watch!.positionSeconds }, label: 'Continue watching' },
  { title: episodes[2]!, rowId: 'row-1', reason: 'nextEpisode', action: { kind: 'play', titleId: episodes[2]!.id, positionSeconds: 0 }, label: 'S1 · E3 · New episode' },
  { title: titles[30]!, rowId: 'row-3', reason: 'forYou', action: { kind: 'details', titleId: titles[30]!.id }, label: 'Picked for you' },
  { title: titles[45]!, rowId: 'row-4', reason: 'trending', action: { kind: 'play', titleId: titles[45]!.id, positionSeconds: 0 }, label: 'Popular this week' },
  { title: titles[15]!, rowId: 'row-2', reason: 'newRelease', action: { kind: 'play', titleId: titles[15]!.id, positionSeconds: 0 }, label: 'Recently added' },
  { title: titles[60]!, rowId: 'row-5', reason: 'featured', action: { kind: 'details', titleId: titles[60]!.id }, label: 'Pinned by your host' },
];
export const featuredTitles = featuredSources.map(source => source.title);
const featuredIds = new Set(featuredTitles.map(t => t.id));
const topTen: Row = {
  id: 'row-top10', name: 'Top 10 this week', purpose: 'recommendation', presentation: 'ranked', style: 'landscape',
  receiptToken: 'row-top10', previewOnFocus: false, continuation: 'exhausted',
  items: ['title-3-2', 'title-1-4', 'title-6-3', 'title-2-5', 'title-5-4', 'title-4-3', 'title-1-7', 'title-6-8', 'title-2-10', 'title-5-9'].map(id => {
    const title = titles.find(title => title.id === id);
    if (!title || featuredIds.has(id)) throw new Error(`Invalid Top 10 fixture title: ${id}`);
    return { id: `top10:${id}`, kind: 'title', title, receiptToken: `top10:${id}` };
  }),
};
export const rows: Row[] = [topTen, ...collections.map<Row>(([name], row) => ({ id: `row-${row + 1}`, name: name!, purpose: row === 0 ? 'recommendation' : 'collection', receiptToken: `row-${row + 1}`, previewOnFocus: row % 2 === 0, style: row === 3 ? 'landscape' : 'poster', items: [...titles.slice(row * 15, row * 15 + 15), ...additionalTitles.filter(t => t.id.startsWith(`title-${row + 1}-`))].filter(t => !featuredIds.has(t.id)).map(t => ({ id: `${row + 1}:${t.id}`, kind: 'title', title: t, receiptToken: `${row + 1}:${t.id}` })), continuation: 'exhausted' }))];
const channelNames = ['World News', 'Field & Forest', 'Cinema One', 'Classic Evenings', 'Discovery Lab', 'Coastal Living', 'Matchday', 'The Kitchen', 'Young Explorers', 'Arts & Culture', 'Night Music', 'Open Roads'];
const programmeGenres = ['News', 'Sports', 'Movies', 'Kids', 'Documentary', 'Drama', 'Comedy', 'Music', 'Lifestyle'];
const fixtureGuides = [
  { id: 'guide-news', name: 'News' }, { id: 'guide-sports', name: 'Sports' }, { id: 'guide-movies', name: 'Movies' },
  { id: 'guide-kids', name: 'Kids' }, { id: 'guide-documentary', name: 'Documentary' }, { id: 'guide-drama', name: 'Drama' },
  { id: 'guide-comedy', name: 'Comedy' }, { id: 'guide-music', name: 'Music' }, { id: 'guide-lifestyle', name: 'Lifestyle' },
];
const houseGuide = { id: 'guide-house-picks', name: 'House picks' };
// VELA_MOCK_CHANNELS sizes the lineup (default 170) for guide scale runs, e.g. 12000.
const channelCount = Math.max(1, Math.floor(Number(process.env.VELA_MOCK_CHANNELS) || 170));
export const channels: Channel[] = Array.from({ length: channelCount }, (_, i) => ({ id: `channel-${i + 1}`, number: String(i < 150 ? 101 + i : 1980 + i - 150),
  name: i < channelNames.length ? channelNames[i]! : `${['North', 'Coastal', 'Studio', 'Vista', 'Metro'][i % 5]} ${programmeGenres[i % programmeGenres.length]} ${Math.floor(i / 45) + 1}`,
  kind: 'tv', group: programmeGenres[i % programmeGenres.length], guides: [fixtureGuides[i % fixtureGuides.length]!, ...(i < 6 ? [houseGuide] : [])], artwork: i % 5 === 4 ? [] : [artwork(`channel-${i + 1}`, 'channel')], favorite: i < 6 }));
export function guide(from: number, until: number, ids: string[]): Programme[] {
  const minute = 60000, durations = [15, 25, 30, 45, 60, 90, 120], cycle = 385;
  const wanted = new Set(ids);
  return channels.flatMap((c, i) => {
    if (i % 4 === 3 || wanted.size && !wanted.has(c.id)) return [];
    const result: Programme[] = [], phase = (i * 13) % cycle;
    for (let n = Math.floor((from / minute - phase) / cycle); (n * cycle + phase) * minute < until; n++) {
      let at = (n * cycle + phase) * minute;
      for (let j = 0; j < durations.length; j++) {
        const start = at, end = start + durations[(j + i) % durations.length]! * minute; at = end;
        if (end <= from || start >= until || i < 2 && j === 3) continue;
        const k = ((n * 7 + j + i) % 6 + 6) % 6;
        result.push({ id: `${c.id}:${start}`, channelId: c.id,
          name: ['Morning Edition', 'A World Outside', 'The Long Journey', 'In Conversation', 'Evening Stories', 'After the Headlines'][k]!,
          summary: [`Original programming from ${c.name}.`, `The people and places behind today's stories, with reports from our correspondents.`, `A new journey across familiar landscapes. Our team meets the people shaping local communities, follows the quiet rhythms of the season and uncovers stories that deserve a closer look.`][(i + j) % 3]!,
          start: new Date(start).toISOString(), end: new Date(end).toISOString(), genres: [programmeGenres[i % programmeGenres.length]!],
          ...((i + j) % 2 === 0 ? { episodeTitle: ['New Beginnings', 'On the Road', 'The Turning Point'][j % 3], seasonNumber: 1 + i % 5, episodeNumber: j + 1, rating: i % 3 ? 'PG' : 'TV-14' } : {}),
          artwork: (i + j) % 5 < 2 ? [artwork(`programme-${i}-${k}`, 'still')] : [] });
      }
    }
    return result;
  });
}
