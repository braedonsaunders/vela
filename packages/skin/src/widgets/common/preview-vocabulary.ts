// Whether a card's or the hero's trailer preview plays now (renderer 16), so a document draws
// its preview overlay (the box around widget `cardPreview` or `heroPreview`) only meanwhile.
import { selectEnv } from '../../host-source';
import type { Accessor } from '../../vocabulary';

/** `env.preview`: the ids whose previews play ('' for none). */
export interface PreviewView {
  cardId: string;
  heroId: string;
}

const yes = (value: boolean) => (value ? 'true' : 'false');

/** Whether this card's or hero's preview plays, read so that a preview starting or ending redraws
 * only the cards it starts or ends on (selectEnv), not every card that asks. */
export const cardPreviewing = (env: Parameters<Accessor>[1], id: string) =>
  selectEnv(env, 'preview', `card:${id}`, preview => preview?.cardId === id);
export const heroPreviewing = (env: Parameters<Accessor>[1], id: string) =>
  selectEnv(env, 'preview', `hero:${id}`, preview => preview?.heroId === id);

export const PREVIEW_VOCABULARY: Record<string, Accessor> = {
  'card.previewing': (c, e) => (c.card ? yes(cardPreviewing(e, c.card.id)) : ''),
  'hero.previewing': (c, e) => (c.hero ? yes(heroPreviewing(e, c.hero.id)) : ''),
};
