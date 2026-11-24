import { mediaClass } from './media';
import type { Card } from './models';
import type { Feature, Library, LibraryExperience, LibraryTab } from './wire';

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

/**
 * How a library opens (protocol README, Library experience): the audio app or the standard pages.
 * A server with features.libraryExperiences decides each library; without it, or for a library that
 * does not say, music opens as the audio app and every other class as the standard pages.
 */
export function libraryExperience(
  library: { media?: unknown; presentation?: { experience?: unknown } },
  feature: (Feature & { experiences?: readonly string[] }) | undefined,
): LibraryExperience {
  const asked = library.presentation?.experience;
  if (feature?.available === true && (asked === 'audio' || asked === 'standard')
    && (!Array.isArray(feature.experiences) || feature.experiences.includes(asked))) return asked;
  return mediaClass(library.media) === 'music' ? 'audio' : 'standard';
}
