import type { Card } from './models';
import type { Library } from './wire';

export function libraryCard(value: unknown): 'poster' | 'landscape' | 'square' {
  return value === 'landscape' || value === 'square' ? value : 'poster';
}
export function libraryCardRatio(value: unknown): string {
  return libraryCard(value) === 'landscape' ? '16 / 9' : libraryCard(value) === 'square' ? '1 / 1' : '2 / 3';
}
/** Absent tabs means a legacy server. An explicit empty/unknown-only list stays empty. */
export function libraryTabs(tabs: Library['tabs']) {
  return tabs?.filter(tab => ['recommended', 'library', 'collections'].includes(tab.kind));
}

/** Landscape art follows Ether's declared preference; poster/square retain poster art. */
export function libraryCardArtwork(card: Card, shape: unknown): Card {
  return libraryCard(shape) === 'landscape'
    ? { ...card, poster: card.thumbnail || card.backdrop || card.poster }
    : card;
}
