// Whether a card's or the hero's trailer preview plays now (renderer 16), so a document draws
// its preview overlay (the box around widget `cardPreview` or `heroPreview`) only meanwhile.
import type { Accessor } from '../../vocabulary';

/** `env.preview`: the ids whose previews play ('' for none). */
export interface PreviewView {
  cardId: string;
  heroId: string;
}

const yes = (value: boolean) => (value ? 'true' : 'false');

export const PREVIEW_VOCABULARY: Record<string, Accessor> = {
  'card.previewing': (c, e) => (c.card ? yes(e.preview?.cardId === c.card.id) : ''),
  'hero.previewing': (c, e) => (c.hero ? yes(e.preview?.heroId === c.hero.id) : ''),
};
