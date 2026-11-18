// The library and collection pages' vocabulary (docs/skin-schema.md, renderers 9, 10 and 13):
// the library view on show (`library.*`), its sort and filter options (`opt.*`), the collection
// on show (`collection.*`), and the collections those pages repeat over. The semantics are those
// of the Contract renderer's table (tools/renderer.ts at cf3b1e5), key for key.
import { libraryCard, libraryCardRatio } from '@vela/core';
import type { Choice, CollectionModel, LibraryModel } from '@vela/core';
import type { CollectionPage, LibraryOption, LibraryPage, OptionOf } from './model';

/** The binding context and environment fields these pages add. */
export interface LibraryCtx {
  opt?: LibraryOption;
  index: number;
}
export interface LibraryEnv {
  library?: LibraryPage;
  collection?: CollectionPage;
  libraries: { kind: string }[];
}

type LibraryAccessor = (c: LibraryCtx, e: LibraryEnv) => string;

const yes = (value: boolean) => (value ? 'true' : 'false');

function library(read: (l: LibraryModel) => string): LibraryAccessor {
  return (_, e) => {
    const model = e.library?.model;
    return model ? read(model) : '';
  };
}

function collection(read: (c: CollectionModel) => string): LibraryAccessor {
  return (_, e) => {
    const model = e.collection?.model;
    return model ? read(model) : '';
  };
}

function option(read: (o: LibraryOption) => string): LibraryAccessor {
  return c => (c.opt ? read(c.opt) : '');
}

const currentSort = (l: LibraryModel) => l.sorts.find(o => o.id === l.sort);

/** Whether an option is the one in force: the kind or genre filtered by, or the sort. */
function chosen(o: LibraryOption, l: LibraryModel | undefined): boolean {
  if (!l) return false;
  if (o.of === 'kind') return l.kindFilter === o.id;
  if (o.of === 'genre') return l.genreFilter === o.id;
  return l.sort === o.id;
}

export const LIBRARY_VOCABULARY: Record<string, LibraryAccessor> = {
  'library.declaredTabs': (_, e) => yes(e.library?.model?.tabs !== undefined),
  'library.card': (_, e) => libraryCard(e.library?.model?.presentation?.card),
  'library.cardRatio': (_, e) => libraryCardRatio(e.library?.model?.presentation?.card),
  'library.view': (_, e) => e.library?.view ?? 'library',
  'library.hasViews': (_, e) => yes(!!e.library?.extras),
  'library.canRecommend': (_, e) => yes(e.library?.canRecommend ?? !!e.library?.extras?.recommendationsAvailable),
  'library.canCollections': (_, e) => yes(!!e.library?.extras?.collectionsAvailable),
  'library.recommendationCount': (_, e) => String(e.library?.extras?.rows.length ?? 0),
  'library.collectionCount': (_, e) => String(e.library?.extras?.collections.length ?? 0),
  'library.collectionsMore': (_, e) => yes(!!e.library?.extras?.collectionCursor),
  'library.genresCount': (_, e) => String(e.library?.extras?.genres.length ?? 0),
  'env.libraryExtrasLoading': (_, e) => yes(e.library?.extrasLoading ?? false),
  'env.libraryExtrasFailed': (_, e) => yes(e.library?.extrasFailed ?? false),
  'library.id': library(l => l.id),
  'library.name': library(l => l.name),
  'library.kind': library(l => l.kind),
  'library.backdrop': library(l => l.backdrop),
  'library.sort': library(l => l.sort),
  'library.direction': library(l => l.direction),
  'library.sortLabel': library(l => currentSort(l)?.label ?? ''),
  'library.canFlip': library(l => yes(currentSort(l)?.directions.length === 2)),
  'library.kindFilter': library(l => l.kindFilter),
  'library.genreFilter': library(l => l.genreFilter),
  'library.playedFilter': library(l => l.playedFilter),
  'library.favoriteFilter': library(l => yes(l.favoriteFilter)),
  'library.year': library(l => (l.yearFilter > 0 ? String(l.yearFilter) : '')),
  'library.canYear': library(l => yes(l.canYear)),
  'library.canPlayed': library(l => yes(l.canPlayed)),
  'library.canFavorite': library(l => yes(l.canFavorite)),
  'library.kindCount': library(l => String(l.kinds.length)),
  'library.genreCount': library(l => String(l.genres.length)),
  'library.sortCount': library(l => String(l.sorts.length)),
  'library.more': library(l => yes(l.more)),
  'library.itemCount': library(l => String(l.items.length)),
  'env.libraryLoading': (_, e) => yes(e.library?.loading ?? false),
  'env.libraryMoreLoading': (_, e) => yes(e.library?.moreLoading ?? false),
  'env.hasLiveLibrary': (_, e) => yes(e.libraries.some(l => l.kind === 'live')),

  'opt.id': option(o => o.id),
  'opt.label': option(o => o.label),
  'opt.of': option(o => o.of),
  'opt.on': (c, e) => (c.opt ? yes(chosen(c.opt, e.library?.model)) : ''),

  'collection.name': collection(x => x.name),
  'collection.more': collection(x => yes(x.more)),
  'collection.complete': collection(x => yes(x.complete)),
  'collection.itemCount': collection(x => String(x.items.length)),
  'env.collectionMoreLoading': (_, e) => yes(e.collection?.moreLoading ?? false),
};

/** The items a `repeat` over a library or collection list draws, or null for another collection. */
export function libraryCollection<C extends LibraryCtx & { card?: LibraryModel['items'][number] }>(
  over: string,
  c: C,
  e: LibraryEnv,
  limit: number,
): C[] | null {
  const model = e.library?.model;
  const options = (of: OptionOf, list: Choice[]) =>
    list.slice(0, limit).map(({ id, label }, index) => ({ ...c, opt: { id, label, of }, index }));
  const cards = (list: LibraryModel['items']) => list.slice(0, limit).map((card, index) => ({ ...c, card, index }));
  switch (over) {
    case 'library.rows': return (e.library?.extras?.rows ?? []).slice(0, limit).map((row, index) => ({ ...c, row, index }));
    case 'library.collections': return cards(e.library?.extras?.collections ?? []);
    case 'library.genreViews': return options('genre', e.library?.extras?.genres ?? []);
    case 'library.items': return cards(model?.items ?? []);
    case 'library.kinds': return options('kind', model?.kinds ?? []);
    case 'library.genres': return options('genre', model?.genres ?? []);
    case 'library.sorts': return options('sort', model?.sorts ?? []);
    case 'collection.items': return cards(e.collection?.model?.items ?? []);
    default: return null;
  }
}
