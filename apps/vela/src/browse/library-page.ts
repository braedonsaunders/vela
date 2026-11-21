// One library page: its view (the URL's sort and filters) read from core's store when it is not
// held yet, what the page shows meanwhile, and its next page. Each view is kept in the store for
// the session, so a revisited view shows at once and paging continues where it stopped.
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { libraryCardArtwork, libraryTabs, libraryKey, reconcileProgressRows, type Card, type LibraryExtras, type LibraryLiveModel, type LibraryQuery } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import type { Env } from '@vela/skin';
import type { LibraryPage } from '@vela/skin/src/widgets/library/model';
import { useSectionFocus } from '../section-focus';
import { asQueried } from './library-query';

export interface LibraryState {
  page: LibraryPage;
  setSearch(query: string): void;
  setLiveFilter(filter: string): void;
  load: Env['load'];
  /** Read the view's next page (the document's Show more, or its sentinel). */
  more(): void;
  rowLoading: string[];
  moreRow(id: string): void;
  /** Read the view again after a failure. */
  retry(): void;
}

interface ExtraState {
  id: string; tab?: string; query?: string; attempt?: number; revision: number; progressRevision: number;
  loading: boolean; failed: boolean; moreLoading?: boolean; value?: LibraryExtras;
}

/** Whether the extras held are this view's (of any progress revision: a stale answer shows while it refreshes). */
function sameExtras(state: ExtraState, id: string, revision: number, tab: string | undefined, query: string): boolean {
  return state.id === id && state.revision === revision && state.tab === tab && state.query === query;
}

/** Whether a re-read answer shows the same as the one on show, rows aside (they reconcile by
 * progress): every response carries fresh ranking receipts, so the answers never compare equal whole. */
function sameExtrasAnswer(held: LibraryExtras, value: LibraryExtras): boolean {
  const ids = (cards: LibraryExtras['collections']) => cards.map(card => card.id).join('\u0000');
  return held.failed === value.failed && held.rowsLoad === value.rowsLoad && held.collectionsLoad === value.collectionsLoad
    && held.genresLoad === value.genresLoad && held.collectionCursor === value.collectionCursor
    && ids(held.collections) === ids(value.collections) && JSON.stringify(held.genres) === JSON.stringify(value.genres);
}

export function useLibraryPage(id: string, query: LibraryQuery, requestedView?: string, facetTitle?: string): LibraryState {
  const store = useVela();
  useVelaState(state => state.libraries.load);
  const canRecommend = store.catalogue.libraryRecommendationsAvailable;
  const liveAvailable = useVelaState(state => state.home.value?.libraryLiveAvailable ?? false);
  const progressRevision = useVelaState(state => state.home.progressRevision);
  const revision = useVelaState(state => state.auth.revision);
  const focused = useSectionFocus() ?? true;
  const initialKey = libraryKey(id, query);
  const initial = useVelaState(state => state.library[initialKey]);
  const earlier = useMemo(() => Object.values(store.getState().library)
    .find(view => view.value?.id === id)?.value, [store, id, initial]);
  const tabs = libraryTabs((initial?.value ?? earlier)?.tabs)?.filter(tab => tab.kind !== 'live' || liveAvailable);
  const selectedTab = tabs?.find(tab => tab.id === requestedView) ?? tabs?.[0];
  const collectionTab = (selectedTab?.kind === 'collections' || selectedTab?.kind === 'people') ? selectedTab.id : undefined;
  const liveTab = selectedTab?.kind === 'live' ? selectedTab.id : undefined;
  // A Smart View, or a library tab listing one level (Albums, Tracks; docs/media-kinds.md), is read by its tab.
  const viewTab = selectedTab?.kind === 'view' || (selectedTab?.kind === 'library' && selectedTab.level) ? selectedTab : undefined;
  const [searchState, setSearchState] = useState({ tab: '', value: '' });
  const searchKey = `${id}:${collectionTab ?? liveTab ?? viewTab?.id ?? ''}`;
  const tabQuery = searchState.tab === searchKey ? searchState.value : '';
  const setSearch = useCallback((value: string) => setSearchState({ tab: searchKey, value: value.trim().slice(0, liveTab ? 256 : 100) }), [searchKey, liveTab]);
  useEffect(() => setSearchState({ tab: searchKey, value: '' }), [searchKey]);
  const browseQuery = useMemo<LibraryQuery>(() => viewTab ? {
    ...query,
    tab: viewTab.id,
    sort: viewTab.sort ?? query.sort,
    direction: viewTab.direction ?? query.direction,
    query: viewTab.search && tabQuery ? tabQuery : undefined,
  } : query, [query, viewTab, tabQuery]);
  const key = libraryKey(id, browseQuery);
  const current = useVelaState(state => state.library[key]);
  const missing = current === undefined;
  const kind = current?.value?.kind;
  const extraGeneration = useRef(0);
  const [extraAttempt, setExtraAttempt] = useState(0);
  const [rowLoading, setRowLoading] = useState<string[]>([]);
  /** The last quiet re-read of the extras on show, so an unchanged answer is not read again on every return. */
  const checked = useRef('');
  const [liveFilterState, setLiveFilterState] = useState({ tab: '', value: '' });
  const liveFilter = liveFilterState.tab === searchKey ? liveFilterState.value : '';
  const setLiveFilter = useCallback((value: string) => setLiveFilterState({ tab: searchKey, value: value.slice(0, 128) }), [searchKey]);
  const liveGeneration = useRef(0);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [liveState, setLiveState] = useState<{ key: string; loading: boolean; failed: boolean; moreLoading?: boolean; items: Card[]; filters: LibraryLiveModel['filters']; cursor: string }>({ key: '', loading: false, failed: false, items: [], filters: [], cursor: '' });
  // A section drawn again (Android releases hidden ones) or prefetched starts from the
  // session's last answer for this view, and refreshes it quietly if progress moved since.
  const [extraState, setExtraState] = useState<ExtraState>(() => {
    const cached = store.catalogue.cachedLibraryExtras(id, collectionTab, tabQuery);
    return cached ? { id, tab: collectionTab, query: tabQuery, attempt: 0, revision, progressRevision: cached.progressRevision, loading: false, failed: false, value: cached.value }
      : { id: '', revision: -1, progressRevision: -1, loading: false, failed: false };
  });

  useEffect(() => {
    if (!id || !liveTab || !focused || !kind) return;
    const key = `${id}:${liveTab}:${tabQuery}:${liveFilter}:${revision}:${liveAttempt}`;
    let active = true;
    liveGeneration.current++;
    setLiveState({ key, loading: true, failed: false, items: [], filters: [], cursor: '' });
    void store.catalogue.libraryLive(id, liveTab, tabQuery, liveFilter).then(value => {
      if (active) setLiveState({ key, loading: false, failed: false, items: value.items, filters: value.filters, cursor: value.cursor });
    }).catch(() => { if (active) setLiveState({ key, loading: false, failed: true, items: [], filters: [], cursor: '' }); });
    return () => { active = false; liveGeneration.current++; };
  }, [store, id, liveTab, tabQuery, liveFilter, revision, liveAttempt, focused, kind]);

  useEffect(() => {
    if (!id || !kind || !focused || liveTab || viewTab) return;
    // A modal person page keeps this library mounted. Keep its accumulated pages on return.
    const check = `${id}|${revision}|${collectionTab ?? ''}|${tabQuery}|${progressRevision}|${extraAttempt}`;
    // On show: this view's answer, possibly partial (a read cut short when the section was left).
    const shown = sameExtras(extraState, id, revision, collectionTab, tabQuery) && !!extraState.value && !extraState.failed;
    if (shown && !extraState.loading && (extraState.progressRevision === progressRevision && extraState.attempt === extraAttempt && !extraState.value!.failed || checked.current === check)) {
      setExtraState(previous => previous.moreLoading ? { ...previous, moreLoading: false } : previous);
      return;
    }
    let active = true;
    extraGeneration.current++;
    if (shown) {
      // A view on show is read again quietly (progress moved, part of it failed last time, or its
      // read was cut short when the section was left): it stays as it is, and changes only if
      // what it shows does. Redrawing a whole library page for an equal answer held a TV's JS
      // thread for 0.6-2 s on returns to the section. A changed answer takes the new places into
      // the rows on show (reconcileProgressRows): unchanged rows and cards keep their objects, so
      // only what moved draws again.
      const held = extraState.value!;
      const partial = extraState.loading;
      void store.catalogue.libraryExtras(id, kind, undefined, collectionTab, tabQuery, progressRevision > 0).then(value => {
        if (!active) return;
        checked.current = check;
        if (!value) return;
        const rows = reconcileProgressRows(held.rows, value.rows, true);
        if (!partial && rows === held.rows && sameExtrasAnswer(held, value)) return;
        startTransition(() => setExtraState({ id, tab: collectionTab, query: tabQuery, attempt: extraAttempt, revision, progressRevision, loading: false, failed: false, value: { ...value, rows } }));
      }).catch(() => { if (active) checked.current = check; });
      return () => { active = false; extraGeneration.current++; };
    }
    setExtraState({ id, tab: collectionTab, query: tabQuery, attempt: extraAttempt, revision, progressRevision, loading: true, failed: false });
    // The recommendations show as soon as they arrive; collections and genres follow.
    const rows = (value: LibraryExtras) => {
      if (active) setExtraState(previous => previous.id === id && previous.revision === revision && previous.progressRevision === progressRevision && previous.loading
        ? { ...previous, value: previous.value ? { ...previous.value, rows: value.rows, rowsLoad: value.rowsLoad } : value } : previous);
    };
    const settle = (next: ExtraState) => { if (active) setExtraState(next); };
    void store.catalogue.libraryExtras(id, kind, rows, collectionTab, tabQuery, progressRevision > 0).then(value => {
      settle({ id, tab: collectionTab, query: tabQuery, attempt: extraAttempt, revision, progressRevision, loading: false, failed: false, value });
    }).catch(() => {
      settle({ id, tab: collectionTab, query: tabQuery, attempt: extraAttempt, revision, progressRevision, loading: false, failed: true });
    });
    return () => { active = false; extraGeneration.current++; };
  }, [store, id, kind, revision, progressRevision, focused, extraAttempt, canRecommend, collectionTab, tabQuery, liveTab, viewTab]);
  const nativeExtras = sameExtras(extraState, id, revision, collectionTab, tabQuery) ? extraState.value : undefined;
  const rawExtras = useMemo<LibraryExtras | undefined>(() => nativeExtras ? { ...nativeExtras, genres: nativeExtras.genres.length ? nativeExtras.genres : current?.value?.genres ?? [] } : (current?.value?.genres.length ? {
    recommendationsAvailable: false, collectionsAvailable: false, rows: [], collections: [], collectionCursor: '', genres: current.value.genres, failed: false,
  } : undefined), [nativeExtras, current?.value]);
  const landscape = (current?.value ?? earlier)?.presentation?.card === 'landscape';
  const extras = useMemo(() => rawExtras && landscape ? { ...rawExtras, rows: rawExtras.rows.map(row => ({ ...row, items: row.items.map(card => libraryCardArtwork(card, 'landscape')) })) } : rawExtras, [rawExtras, landscape]);
  const view = tabs ? selectedTab?.kind ?? 'library' : requestedView === 'library' || requestedView === 'recommended' || requestedView === 'collections' || requestedView === 'genres'
    ? requestedView : canRecommend ? 'recommended' : 'library';
  const usableView = facetTitle ? 'library' : tabs ? view : view === 'recommended' && !canRecommend || view === 'collections' && !canRecommend || view === 'genres' && !extras?.genres.length ? 'library' : view;

  useEffect(() => {
    if (focused && !current?.value && current?.load !== 'loading' && current?.load !== 'failed') void store.catalogue.library(id, browseQuery, current?.value?.pages ?? 1, !!current?.value);
    // The key names the query; a session change empties the store, which reads it again.
  }, [store, id, key, missing, focused, browseQuery]);

  const page = useMemo<LibraryPage>(() => {
    const held = current?.value;
    // While a new view is read, the library's last view stays on show under the new controls.
    return {
      model: (() => {
        const model = held ?? (earlier ? asQueried(earlier, browseQuery) : undefined);
        return model ? { ...model, name: facetTitle || model.name, genres: extras?.genres ?? model.genres,
          ...(usableView === 'live' ? { presentation: { card: selectedTab?.card ?? 'landscape' }, items: liveState.items, more: !!liveState.cursor, pages: 1 } : {}) } : model;
      })(),
      loading: !held && current?.load !== 'failed',
      moreLoading: usableView === 'live' ? !!liveState.moreLoading : (usableView === 'collections' || usableView === 'people') ? !!extraState.moreLoading : !!held && current?.load === 'loading',
      view: usableView,
      layout: viewTab?.layout ?? 'grid',
      viewLoad: usableView === 'live' ? liveState.failed ? 'failed' : liveState.loading ? 'loading' : 'ready'
        : usableView === 'library' || usableView === 'view' || usableView === 'genres' && !canRecommend ? current?.load ?? 'idle'
        : !sameExtras(extraState, id, revision, collectionTab, tabQuery) ? 'idle'
        : extraState.failed ? 'failed'
        : (usableView === 'recommended' ? nativeExtras?.rowsLoad : usableView === 'genres' ? nativeExtras?.genresLoad : nativeExtras?.collectionsLoad)
          ?? (extraState.loading ? 'loading' : nativeExtras?.failed ? 'failed' : nativeExtras ? 'ready' : 'idle'),
      tabId: selectedTab?.id,
      tabQuery,
      liveFilter,
      liveFilters: usableView === 'live' ? liveState.filters : undefined,
      facetTitle,
      canRecommend,
      liveAvailable,
      viewRequest: requestedView ?? '',
      extras,
      extrasLoading: usableView !== 'live' && canRecommend && (!nativeExtras && !(extraState.id === id && extraState.revision === revision && extraState.progressRevision === progressRevision && extraState.failed) || extraState.id === id && extraState.loading),
      extrasFailed: usableView !== 'live' && extraState.id === id && extraState.progressRevision === progressRevision && (extraState.failed || !!extras?.failed),
    };
  }, [current, earlier, browseQuery, facetTitle, selectedTab?.id, selectedTab?.card, viewTab?.layout, usableView, requestedView, extras, extraState, canRecommend, liveAvailable, nativeExtras, id, revision, progressRevision, tabQuery, liveFilter, liveState]);

  const failed = current?.load === 'failed';
  const load: Env['load'] = failed ? 'failed' : page.model ? 'ready' : 'loading';

  const more = useCallback(() => {
    if (page.view === 'live' && liveTab && liveState.cursor && !liveState.moreLoading) {
      const cursor = liveState.cursor;
      const generation = liveGeneration.current;
      setLiveState(previous => ({ ...previous, moreLoading: true }));
      void store.catalogue.libraryLive(id, liveTab, tabQuery, liveFilter, cursor).then(value => setLiveState(previous => generation !== liveGeneration.current || previous.cursor !== cursor ? previous : {
        ...previous, moreLoading: false, items: [...previous.items, ...value.items], filters: value.filters, cursor: value.cursor,
      })).catch(() => setLiveState(previous => generation === liveGeneration.current ? { ...previous, moreLoading: false, failed: true } : previous));
      return;
    }
    if ((page.view === 'collections' || page.view === 'people') && extras?.collectionCursor && !extraState.moreLoading) {
      const cursor = extras.collectionCursor;
      const generation = extraGeneration.current;
      setExtraState(previous => ({ ...previous, moreLoading: true }));
      void store.catalogue.moreLibraryCollections(id, cursor, collectionTab, tabQuery).then(result => setExtraState(previous => generation !== extraGeneration.current || previous.id !== id || previous.revision !== revision || previous.value?.collectionCursor !== cursor ? previous : {
        ...previous, moreLoading: false, value: { ...previous.value, collections: [...previous.value.collections, ...result.items], collectionCursor: result.cursor },
      })).catch(() => setExtraState(previous => generation === extraGeneration.current && previous.id === id && previous.revision === revision ? { ...previous, moreLoading: false, failed: true } : previous));
      return;
    }
    if (page.view !== 'library' && page.view !== 'view') return;
    const held = current?.value;
    if (!held?.more || current?.load === 'loading') return;
    void store.catalogue.library(id, browseQuery, held.pages + 1);
  }, [store, id, revision, browseQuery, current, extras, page.view, extraState.moreLoading, collectionTab, tabQuery, liveTab, liveFilter, liveState]);

  const retry = useCallback(() => {
    if (page.view === 'live') {
      setLiveAttempt(value => value + 1);
      return;
    }
    setExtraAttempt(value => value + 1);
    void store.catalogue.library(id, browseQuery, current?.value?.pages ?? 1);
  }, [store, id, browseQuery, current, page.view]);

  const moreRow = useCallback((rowId: string) => {
    const row = extras?.rows.find(item => item.id === rowId);
    if (!row?.nextCursor || rowLoading.includes(rowId)) return;
    const cursor = row.nextCursor;
    const generation = extraGeneration.current;
    setRowLoading(ids => [...ids, rowId]);
    void store.catalogue.moreLibraryRow(rowId, cursor, id).then(next => setExtraState(previous => {
      if (generation !== extraGeneration.current || previous.id !== id || previous.revision !== revision || !previous.value) return previous;
      return { ...previous, value: { ...previous.value, rows: previous.value.rows.map(item => item.id === rowId && item.nextCursor === cursor
        ? { ...item, items: [...item.items, ...next.items], nextCursor: next.nextCursor, continuation: next.continuation } : item) } };
    })).catch(() => setExtraState(previous => generation === extraGeneration.current && previous.id === id && previous.revision === revision ? { ...previous, failed: true } : previous))
      .finally(() => setRowLoading(ids => ids.filter(value => value !== rowId)));
  }, [store, id, revision, extras, rowLoading]);

  return useMemo(() => ({ page, load, more, rowLoading, moreRow, retry, setSearch, setLiveFilter }), [page, load, more, rowLoading, moreRow, retry, setSearch, setLiveFilter]);
}
