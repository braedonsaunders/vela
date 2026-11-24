import type { Library, RowEntry } from '../types';
import { artwork, channels, titles } from './catalogue';

const movies = titles.filter(t => t.kind === 'movie');
const shows = titles.filter(t => t.kind === 'show');
const fixtureNow = Date.now();
export const libraries: Library[] = [
  { id: 'movies', name: 'Movies', kind: 'movies', artwork: [artwork(movies[0]!.id, 'backdrop')] },
  { id: 'shows', name: 'TV Shows', kind: 'shows', artwork: [artwork(shows[0]!.id, 'backdrop')] },
  { id: 'documentaries', name: 'Our Living World', kind: 'movies', artwork: [artwork('title-4-1', 'backdrop')] },
  { id: 'live', name: 'Live TV', kind: 'live', artwork: [] },
  { id: 'videos', name: 'Creator videos', kind: 'mixed', artwork: [artwork(movies[0]!.id, 'backdrop')] },
  { id: 'all', name: 'Studio Collection', kind: 'mixed', artwork: [] },
].map(l => {
  const kind = l.kind as Library['kind'];
  const members = l.id === 'shows' ? shows : l.id === 'documentaries' ? movies.filter(t => t.genres.includes('Documentary')) : l.id === 'all' ? titles : movies;
  if (l.id === 'videos') return { ...l, kind, dateDisplay: 'date', presentation: { card: 'landscape' }, tabs: [
    { id: 'discover', label: 'For you', kind: 'recommended' },
    { id: 'smart-grid', label: 'Recently watched', kind: 'view', layout: 'grid', sort: 'lastViewed', direction: 'desc', search: true, searchPlaceholder: 'Search watch history' },
    { id: 'smart-list', label: 'History list', kind: 'view', layout: 'list', sort: 'lastViewed', direction: 'desc', search: true },
    { id: 'smart-timeline', label: 'History timeline', kind: 'view', layout: 'timeline', sort: 'lastViewed', direction: 'desc', search: true },
    { id: 'performers', label: 'Performers', kind: 'people', facet: 'creator', order: 'name' }, { id: 'videos', label: 'All videos', kind: 'library' }, { id: 'popular-cast', label: 'Popular cast', kind: 'people', facet: 'creator', order: 'count' }, { id: 'topics', label: 'Topics', kind: 'collections', facet: 'topic', order: 'name' }, { id: 'popular-topics', label: 'Popular topics', kind: 'collections', facet: 'topic', order: 'count' }, { id: 'live-now', label: 'Live now', kind: 'live', card: 'landscape', search: true, searchPlaceholder: 'Search live streams' },
    ...Array.from({ length: 35 }, (_, index) => ({ id: `smart-overflow-${index + 1}`, label: `View ${String(index + 1).padStart(2, '0')}`, kind: 'view' as const, sort: 'lastViewed' as const, direction: 'desc' as const })),
  ],
    browse: { sorts: [{ id: 'index', directions: ['asc'] }, { id: 'title', directions: ['asc', 'desc'] }, { id: 'lastViewed', directions: ['desc', 'asc'] }], defaultSort: 'index', defaultDirection: 'asc',
      filters: { facets: [{ id: 'topic', label: 'Topic', type: 'strings', multi: true }, { id: 'creator', label: 'Creator', type: 'people', multi: true }, { id: 'length', label: 'Length', type: 'duration', multi: true }] } } } as Library;
  return { ...l, kind, presentation: { card: 'poster' }, tabs: kind === 'live' ? [{ id: 'library', label: 'Channels', kind: 'library' }] : [
    { id: 'recommended', label: 'Recommendations', kind: 'recommended' }, { id: 'library', label: 'Library', kind: 'library' }, { id: 'collections', label: 'Collections', kind: 'collections', ...(l.id === 'movies' ? { facet: 'studios', sort: 'released', direction: 'desc' } : {}) }], browse: { sorts: kind === 'live' ? [{ id: 'server', directions: ['asc'] }] : [
    { id: 'server', directions: ['asc'] }, { id: 'title', directions: ['asc', 'desc'] }, { id: 'year', directions: ['asc', 'desc'] }, { id: 'released', directions: ['asc', 'desc'] }],
    defaultSort: 'server', defaultDirection: 'asc', filters: kind === 'live' ? {} : {
      kind: kind === 'shows' ? ['show'] : kind === 'mixed' ? ['movie', 'show'] : ['movie'],
      facets: l.id === 'movies' ? [{ id: 'studios', label: 'Studios', type: 'strings', multi: true }] : undefined,
      genre: true, genres: [...new Set(members.flatMap(t => t.genres))], year: true, played: true, favorite: true, collectionId: true } } } as Library;
});

export function libraryEntries(id: string): RowEntry[] {
  if (id === 'live') return channels.map(channel => ({ id: `live:${channel.id}`, kind: 'channel', channel, receiptToken: '' }));
  const items = id === 'shows' ? shows : id === 'documentaries' ? movies.filter(t => t.genres.includes('Documentary')) : id === 'all' ? titles : movies;
  return items.map((title, index) => ({ id: `${id}:${title.id}`, kind: 'title', title: {
    ...title,
    airDate: `${title.year ?? 2020}-06-15`,
    ...(id === 'videos' ? {
      artwork: title.artwork.filter(a => a.kind === 'backdrop'),
      watch: {
        ...(title.watch ?? { positionSeconds: index % 4 ? 900 + index * 120 : 0, played: index % 4 === 0, favorite: false, watchlisted: false }),
        lastViewedAt: new Date(fixtureNow - [2 * 3_600_000, 26 * 3_600_000, 3 * 86_400_000, 16 * 86_400_000, 47 * 86_400_000][index % 5]!).toISOString(),
      },
    } : {}),
  }, receiptToken: '' }));
}
