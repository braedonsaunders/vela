import type { Card, DetailModel, HomeModel, LibraryModel, CollectionModel, Row } from '../models';
import type { WatchRequest, WatchState } from '../wire';
import type { VelaState } from './index';
import type { Loadable } from './state';
import type { LikedList, MusicState } from './music';

type Change = Omit<WatchRequest, 'idempotencyKey'> & { positionSeconds?: number; progressLabel?: string };

export interface CardWatchSnapshot extends WatchState { progressLabel: string }
export function cardWatch(card: Card): CardWatchSnapshot {
  return {
    positionSeconds: card.progressSeconds,
    played: card.played,
    favorite: card.favorite ?? false,
    watchlisted: card.watchlisted ?? false,
    progressLabel: card.progressLabel,
  };
}

export function changeCardWatch(card: Card, id: string, change: Change): Card {
  if (card.id !== id) return card;
  const played = change.played ?? card.played;
  const position = change.played === true ? 0 : change.positionSeconds ?? card.progressSeconds;
  return {
    ...card,
    played,
    progressSeconds: position,
    progressLabel: change.played === true ? '' : change.progressLabel ?? card.progressLabel,
    ...(change.favorite !== undefined ? { favorite: change.favorite } : {}),
    ...(change.watchlisted !== undefined ? { watchlisted: change.watchlisted } : {}),
  };
}

const cards = (values: Card[], id: string, change: Change) => values.map(card => changeCardWatch(card, id, change));
/** A row after one viewer mutation: a progress row drops a title marked played or removed. */
export const watchRow = (value: Row, id: string, change: Change): Row => row(value, id, change);
const row = (value: Row, id: string, change: Change): Row => !value.items.some(card => card.id === id) ? value : ({
  ...value,
  items: (value.purpose === 'continue' && change.played === true)
    || (value.purpose === 'continue' && change.continueWatching === false)
    ? value.items.filter(card => card.id !== id)
    : cards(value.items, id, change),
});
const load = <T>(known: Loadable<T>, map: (value: T) => T): Loadable<T> => known.value ? { ...known, value: map(known.value) } : known;

function detail(value: DetailModel, id: string, change: Change): DetailModel {
  const own = value.title[0]?.id === id;
  return {
    ...value,
    title: cards(value.title, id, change), episodes: cards(value.episodes, id, change),
    nextUp: value.nextUp ? cards(value.nextUp, id, change) : value.nextUp,
    related: value.related.map(item => row(item, id, change)),
    ...(own && change.played === true ? { resumeSeconds: 0, resumePosition: '' } : {}),
  };
}

/** The viewer's liked lists (Liked Songs, Your Library's albums and artists) after a like changes:
 * an unliked title leaves them at once; a new like arrives with the list's next read. */
export function likedAfter(liked: MusicState['liked'], id: string, change: Change): MusicState['liked'] {
  if (change.favorite !== false) return liked;
  let changed = false;
  const next: MusicState['liked'] = {};
  for (const [role, known] of Object.entries(liked)) {
    const list: LikedList | undefined = known?.value;
    if (!known || !list?.items.some(item => item.id === id)) { next[role] = known; continue; }
    changed = true;
    const items = list.items.filter(item => item.id !== id);
    next[role] = { ...known, value: { ...list, items, total: Math.max(items.length, list.total - (list.items.length - items.length)) } };
  }
  return changed ? next : liked;
}

/** Optimistically apply one viewer mutation everywhere the title is currently drawn. */
export function optimisticWatchState(state: VelaState, id: string, change: Change): VelaState {
  const mapRecord = <T>(record: Record<string, Loadable<T>>, map: (value: T) => T) =>
    Object.fromEntries(Object.entries(record).map(([key, known]) => [key, load(known, map)]));
  return {
    ...state,
    home: state.home.value ? { ...state.home, value: { ...state.home.value, hero: cards(state.home.value.hero, id, change), rows: state.home.value.rows.map(item => row(item, id, change)) } as HomeModel } : state.home,
    titles: mapRecord(state.titles, value => detail(value, id, change)),
    related: mapRecord(state.related, value => value.map(item => row(item, id, change))),
    rows: mapRecord(state.rows, value => row(value, id, change)),
    library: mapRecord(state.library, value => {
      let items = cards(value.items, id, change);
      if (change.played !== undefined && value.playedFilter) items = items.filter(card => card.id !== id || String(card.played) === value.playedFilter);
      if (change.favorite !== undefined && value.favoriteFilter) items = items.filter(card => card.id !== id || card.favorite === true);
      return { ...value, items } as LibraryModel;
    }),
    collections: mapRecord(state.collections, value => ({ ...value, items: cards(value.items, id, change) } as CollectionModel)),
    ...(state.music ? { music: { ...state.music, liked: likedAfter(state.music.liked, id, change) } } : {}),
    search: {
      ...state.search,
      sections: state.search.sections?.map(section => section.id === state.auth.serverId ? {
        ...section, results: section.results.map(result => result.viewer === state.auth.viewerId && result.card.id === id
          ? { ...result, card: changeCardWatch(result.card, id, change) } : result),
      } : section),
      fast: { ...state.search.fast, items: cards(state.search.fast.items, id, change) },
      descriptive: { ...state.search.descriptive, items: cards(state.search.descriptive.items, id, change) },
      ai: { ...state.search.ai, items: cards(state.search.ai.items, id, change) },
    },
  };
}

export function watchInState(state: VelaState, id: string): CardWatchSnapshot | undefined {
  const home = state.home.value;
  const found = home?.hero.find(card => card.id === id)
    ?? home?.rows.flatMap(item => item.items).find(card => card.id === id)
    ?? Object.values(state.titles).flatMap(known => known.value ? [...known.value.title, ...known.value.episodes] : []).find(card => card.id === id)
    ?? state.search.fast.items.find(card => card.id === id);
  return found ? cardWatch(found) : undefined;
}
