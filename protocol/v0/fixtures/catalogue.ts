import type { ArtworkRef, Channel, Extra, Programme, Row, Title, TitleDetail } from '../types';

export function artwork(id: string, kind: ArtworkRef['kind'] = 'poster'): ArtworkRef {
  const wide = kind !== 'poster';
  return { id: `${id}-${kind}`, kind, tag: 'fixture-v1', color: '#293443', sizes: (wide ? [640, 1280] : [240, 480]).map(width => ({ width, height: Math.round(width * (wide ? 9 / 16 : 3 / 2)), url: `/vela/v0/artwork/${id}?kind=${kind}&width=${width}` })) };
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
export const seasons: Title[] = [1, 2].map(n => ({ ...show, id: `season-meridian-${n}`, kind: 'season', name: `Season ${n}`, showId: show.id, seasonNumber: n }));
export const episodes: Title[] = seasons.flatMap(s => ['Arrival', 'The Night Watch', 'Pressure Drop', 'A Distant Light', 'The Sounding', 'Home Waters'].map((name, i) => ({ ...show, id: `episode-${s.seasonNumber}-${i + 1}`, kind: 'episode', name, showId: show.id, seasonId: s.id, seasonNumber: s.seasonNumber, episodeNumber: i + 1, durationSeconds: 2700 + i * 60 })));
titles.splice(14, 1, show);
export const allTitles = [...titles, ...seasons, ...episodes];
export const extras: Extra[] = [{ id: 'extra-meridian-trailer', parentId: show.id, kind: 'trailer', name: 'Meridian Station — First Look', durationSeconds: 60, availability: 'ready' }];
export function detail(id: string): TitleDetail | undefined {
  const title = allTitles.find(t => t.id === id);
  return title && { title, canPlay: title.kind === 'movie' || title.kind === 'episode',
    ...(title.kind === 'show' ? { seasons } : title.kind === 'season' ? { episodes: episodes.filter(e => e.seasonId === id) } : {}),
    extras: extras.filter(e => e.parentId === id), chapters: [], cast: [] };
}
// Unbound fixtures are bound to a grant by the HTTP layer before delivery.
export const rows: Row[] = collections.map(([name], row) => ({ id: `row-${row + 1}`, name: name!, purpose: row === 0 ? 'recommendation' : 'collection', receiptToken: `row-${row + 1}`, style: row === 3 ? 'landscape' : 'poster', items: titles.slice(row * 15, row * 15 + 15).map(t => ({ id: `${row + 1}:${t.id}`, kind: 'title', title: t, receiptToken: `${row + 1}:${t.id}` })), continuation: 'exhausted' }));
export const channels: Channel[] = ['World News', 'Field & Forest', 'Cinema One', 'Classic Evenings', 'Discovery Lab', 'Coastal Living', 'Matchday', 'The Kitchen', 'Young Explorers', 'Arts & Culture', 'Night Music', 'Open Roads'].map((name, i) => ({ id: `channel-${i + 1}`, number: String(101 + i), name, kind: 'tv', artwork: [artwork(`channel-${i + 1}`, 'channel')], favorite: i < 2 }));
export function guide(from: number, until: number, ids: string[]): Programme[] {
  const hour = 3600000, start = Math.floor(from / hour) * hour;
  return channels.filter(c => !ids.length || ids.includes(c.id)).flatMap((c, i) => Array.from({ length: Math.ceil((until - start) / hour) }, (_, n) => {
    const t = start + n * hour;
    return { id: `${c.id}:${t}`, channelId: c.id, name: ['Morning Edition', 'A World Outside', 'The Long Journey', 'In Conversation', 'Evening Stories', 'After the Headlines'][(n + i) % 6]!, summary: `An hour of original programming from ${c.name}.`, start: new Date(t).toISOString(), end: new Date(t + hour).toISOString(), artwork: c.artwork };
  }));
}
