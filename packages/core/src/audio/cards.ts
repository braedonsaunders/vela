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
