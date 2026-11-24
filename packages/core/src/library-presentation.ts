import type { Card } from './models';
import type { Feature, Library, LibraryTab } from './wire';

export function libraryCard(value: unknown): 'poster' | 'landscape' | 'square' {
  return value === 'landscape' || value === 'square' ? value : 'poster';
}
export function libraryCardRatio(value: unknown): string {
  return libraryCard(value) === 'landscape' ? '16 / 9' : libraryCard(value) === 'square' ? '1 / 1' : '2 / 3';
}
/** Absent tabs means a legacy server. An explicit empty/unknown-only list stays empty. */
export function libraryTabs(tabs: Library['tabs']) {
  return tabs?.filter(tab => ['recommended', 'library', 'collections', 'people', 'live', 'view'].includes(tab.kind));
}

/** Landscape art follows Ether's declared preference; poster/square retain poster art. */
export function libraryCardArtwork(card: Card, shape: unknown): Card {
  return libraryCard(shape) === 'landscape'
    ? { ...card, poster: card.thumbnail || card.backdrop || card.poster }
    : card;
}

/** Facet collection IDs carry opaque value IDs, which can themselves contain colons. */
export function parseFacetCollectionId(id: string): { field: string; valueId: string } | undefined {
  const match = /^facet:([^:]+):(.+)$/.exec(id);
  return match ? { field: match[1]!, valueId: match[2]! } : undefined;
}
export function facetCollectionQuery(id: string, tab: LibraryTab) {
  const facet = parseFacetCollectionId(id);
  return tab.kind === 'collections' && tab.facet && facet?.field === tab.facet
    ? { facets: { [facet.field]: [facet.valueId] }, sort: tab.sort, direction: tab.direction }
    : undefined;
}

/** The experiences Vela draws. Any other id a server sends is drawn as 'watch'. */
export const VELA_EXPERIENCES = ['watch', 'listen', 'read', 'gallery', 'live'] as const;
export type VelaExperience = typeof VELA_EXPERIENCES[number];

/**
 * How a library opens (protocol README, Library experience). A server with
 * features.libraryExperiences names it per library; an id Vela does not know is 'watch'. A library
 * without the field, and every server without the feature (older Ether, Jellyfin, Emby, Plex), is
 * chosen by what it holds (classExperience), so a library keeps working across any upgrade.
 */
export function libraryExperience(
  library: { media?: unknown; kind?: unknown; experience?: unknown },
  feature: Feature | undefined,
): VelaExperience {
  const named = library.experience;
  if (feature?.available === true && typeof named === 'string' && named.trim()) {
    return (VELA_EXPERIENCES as readonly string[]).includes(named) ? named as VelaExperience : 'watch';
  }
  return classExperience(library.media, library.kind);
}

/** The experience a library's media class (and a live library's kind) implies: music, audiobooks and
 * podcasts listen; books and comics read; photos are a gallery; a live TV library is live; the rest
 * watch. */
export function classExperience(media: unknown, kind: unknown): VelaExperience {
  if (kind === 'live') return 'live';
  if (media === 'music' || media === 'audiobook' || media === 'podcast') return 'listen';
  if (media === 'book' || media === 'comic' || media === 'comics') return 'read';
  if (media === 'photo') return 'gallery';
  return 'watch';
}

/** The recommended tab whose rows are a library's Home in the audio app: its `home` tab when it
 * declares one, else none (the library's own rows). Asking for a tab a library does not declare is
 * a not-found. */
export function libraryHomeTab(tabs: readonly Pick<LibraryTab, 'id' | 'kind'>[] | undefined): string | undefined {
  return tabs?.some(tab => tab.id === 'home' && tab.kind === 'recommended') ? 'home' : undefined;
}
