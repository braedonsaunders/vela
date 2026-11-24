// The `titleCard` layout block (`docs/plugin-screens.md` §6): renders Vela's own title card for an
// `item:<id>` record in the record pool, using the active skin's `card` slot (`host.doc.routes` / `card`)
// so library items embedded inside a plugin screen match Vela's native library cards.
import { useHost } from '../host';
import { fill, type RNode, type Template } from '../resolve';
import type { Card, Ctx } from '../vocabulary';
import { stripRecordPrefix } from './action-validation';
import { useScreenBlockRuntime, type TitleCardBlockNode } from './types';

function coerceRecordToCard(id: string, data: Record<string, unknown>): Card {
  const str = (key: string, fallback = '') => (typeof data[key] === 'string' ? (data[key] as string) : fallback);
  const num = (key: string, fallback = 0) => (typeof data[key] === 'number' ? (data[key] as number) : fallback);
  const bool = (key: string) => data[key] === true;
  const kind = str('kind', 'movie');
  const year = num('year', 0);
  const genres = Array.isArray(data.genres) ? data.genres.map(String) : [];
  return {
    id,
    kind,
    name: str('name', str('title', id)),
    summary: str('summary', ''),
    airDate: str('airDate', ''),
    facts: str('facts', ''),
    year,
    yearLabel: str('yearLabel', year > 0 ? String(year) : ''),
    rating: str('rating', ''),
    durationSeconds: num('durationSeconds', 0),
    durationLabel: str('durationLabel', ''),
    progressSeconds: num('progressSeconds', 0),
    progressLabel: str('progressLabel', ''),
    played: bool('played'),
    favorite: bool('favorite'),
    watchlisted: bool('watchlisted'),
    poster: str('poster', str('image', '')),
    backdrop: str('backdrop', ''),
    logo: str('logo', ''),
    accent: str('accent', ''),
    receipt: str('receipt', ''),
    showId: str('showId', ''),
    seasonId: str('seasonId', ''),
    seasonNumber: num('seasonNumber', 0),
    seasonNumberLabel: str('seasonNumberLabel', ''),
    episodeNumber: num('episodeNumber', 0),
    episodeNumberLabel: str('episodeNumberLabel', ''),
    showName: str('showName', ''),
    episodeContext: str('episodeContext', ''),
    contextParts: [],
    genres,
  };
}

export function TitleCardBlock({ node, ctx }: { node: TitleCardBlockNode; ctx: Ctx }) {
  const host = useHost();
  const runtime = useScreenBlockRuntime();

  const rawItem = fill(node.item as Template, ctx, host.env).trim();
  if (!rawItem || !runtime) return null;

  const itemId = stripRecordPrefix(rawItem, 'item');
  const recordKey = rawItem.startsWith('item:') ? rawItem : `item:${itemId}`;

  let card: Card | undefined = runtime.resolveItemCard?.(recordKey, ctx);
  if (!card) {
    const entry = ctx.screen?.record(recordKey);
    const data = entry?.value;
    if (data && typeof data === 'object') {
      card = coerceRecordToCard(itemId, data as Record<string, unknown>);
    }
  }
  if (!card) return null;

  const cardSlot = (host.doc as { slots?: { card?: RNode } }).slots?.card;
  if (!cardSlot) return null;

  return runtime.renderNode(cardSlot, { ...ctx, card });
}
