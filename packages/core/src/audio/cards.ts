// The tracks a music card stands for when it is played or queued from a menu: a track itself, an
// album's or playlist's tracks in disc and track order.
import type { Card } from '../models';
import { childrenKey } from '../plugin-levels';
import type { Vela as VelaStore } from '../store';

/** Tracks in album order: disc, then track number, then as listed. */
export function albumOrder(cards: Card[]): Card[] {
  return cards.map((card, i) => ({ card, i }))
    .sort((a, b) => (a.card.media?.disc ?? 0) - (b.card.media?.disc ?? 0) || (a.card.media?.index ?? 0) - (b.card.media?.index ?? 0) || a.i - b.i)
    .map(({ card }) => card);
}

export async function audioCardsOf(store: VelaStore, card: Card): Promise<Card[]> {
  // A playable title with children (an audiobook in parts) plays its children.
  if (card.media?.audio && !card.media.childCount) return [card];
  if (card.kind === 'playlist') {
    await store.playlists.open(card.id);
    const items = await settled(store, () => store.getState().collections[card.id]);
    return (items?.items ?? []).filter(item => item.media?.audio) as Card[];
  }
  await store.media.children(card.id);
  const children = await settled(store, () => store.getState().children[childrenKey(card.id)]);
  return albumOrder((children?.items ?? []).filter(item => item.media?.audio));
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

/** Where a spoken-word item (a book's part, a podcast episode) played on its own resumes: the
 * viewer's place when under way, else its start. Music always starts from the top. */
export function resumePoint(card: Pick<Card, 'media' | 'progressSeconds' | 'played'>): number {
  const spoken = card.media?.class === 'audiobook' || card.media?.class === 'podcast';
  return spoken && card.progressSeconds > 0 && !card.played ? card.progressSeconds : 0;
}

/** Where playing a card's tracks starts: a book or show where the viewer left it (`listenFrom`),
 * anything else from its first. */
export function playStart(card: Pick<Card, 'media'>, items: Card[]): { items: Card[]; index: number; positionSeconds?: number } {
  const role = card.media?.role;
  return role === 'show' || role === 'audiobook' ? listenFrom(card, items) : { items, index: 0 };
}

/** A loadable's value once it is no longer loading (another caller may have started the load). */
function settled<T>(store: VelaStore, read: () => { load: string; value?: T } | undefined): Promise<T | undefined> {
  return new Promise(resolve => {
    const check = () => {
      const now = read();
      if (!now || now.load === 'loading') return false;
      resolve(now.value);
      return true;
    };
    if (check()) return;
    const off = store.subscribe(() => { if (check()) off(); });
  });
}
