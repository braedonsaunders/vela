import type { Library, RowEntry } from '../types';
import { artwork, channels, titles } from './catalogue';

const movies = titles.filter(t => t.kind === 'movie');
const shows = titles.filter(t => t.kind === 'show');
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
  if (l.id === 'videos') return { ...l, kind, presentation: { card: 'landscape' }, tabs: [
    { id: 'discover', label: 'For you', kind: 'recommended' }, { id: 'videos', label: 'All videos', kind: 'library' }],
    browse: { sorts: [{ id: 'index', directions: ['asc'] }, { id: 'title', directions: ['asc', 'desc'] }], defaultSort: 'index', defaultDirection: 'asc',
      filters: { facets: [{ id: 'topic', label: 'Topic', type: 'strings', multi: true }, { id: 'creator', label: 'Creator', type: 'people', multi: true }, { id: 'length', label: 'Length', type: 'duration', multi: true }] } } } as Library;
  return { ...l, kind, presentation: { card: 'poster' }, tabs: kind === 'live' ? [{ id: 'library', label: 'Channels', kind: 'library' }] : [
    { id: 'recommended', label: 'Recommended', kind: 'recommended' }, { id: 'library', label: 'Library', kind: 'library' }, { id: 'collections', label: 'Collections', kind: 'collections' }], browse: { sorts: kind === 'live' ? [{ id: 'server', directions: ['asc'] }] : [
    { id: 'server', directions: ['asc'] }, { id: 'title', directions: ['asc', 'desc'] }, { id: 'year', directions: ['asc', 'desc'] }],
    defaultSort: 'server', defaultDirection: 'asc', filters: kind === 'live' ? {} : {
      kind: kind === 'shows' ? ['show'] : kind === 'mixed' ? ['movie', 'show'] : ['movie'],
      genre: true, genres: [...new Set(members.flatMap(t => t.genres))], year: true, played: true, favorite: true, collectionId: true } } } as Library;
});

export function libraryEntries(id: string): RowEntry[] {
  if (id === 'live') return channels.map(channel => ({ id: `live:${channel.id}`, kind: 'channel', channel, receiptToken: '' }));
  const items = id === 'shows' ? shows : id === 'documentaries' ? movies.filter(t => t.genres.includes('Documentary')) : id === 'all' ? titles : movies;
  return items.map(title => ({ id: `${id}:${title.id}`, kind: 'title', title: id === 'videos' ? { ...title, artwork: title.artwork.filter(a => a.kind === 'backdrop') } : title, receiptToken: '' }));
}
