// One library page: its view (the URL's sort and filters) read from core's store when it is not
// held yet, what the page shows meanwhile, and its next page. Each view is kept in the store for
// the session, so a revisited view shows at once and paging continues where it stopped.
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { libraryCardArtwork, libraryTabs, libraryKey, recommendationTab, reconcileProgressRows, tabCard, type Card, type Choice, type CollectionPage, type LibraryExtras, type LibraryLiveModel, type LibraryQuery, type Row } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import type { Env } from '@vela/skin';
import type { LibraryPage } from '@vela/skin/src/widgets/library/model';
import { useSectionFocus } from '../section-focus';
import { asQueried } from './library-query';
import { libraryExtras, noPart, viewPart, type Part } from './library-parts';

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

export function useLibraryPage(id: string, query: LibraryQuery, requestedView?: string, facetTitle?: string): LibraryState {
  const store = useVela();
  // The library list is published again once a server without declared tabs has been probed.
  useVelaState(state => state.libraries.value);
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
  const view = tabs ? selectedTab?.kind ?? 'library' : requestedView === 'library' || requestedView === 'recommended' || requestedView === 'collections' || requestedView === 'genres'
    ? requestedView : canRecommend ? 'recommended' : 'library';
  // What the view on show reads beyond the library's items: Recommended its rows, a Collections or
  // people tab its collections, Genres its genres. A slow or failed part never holds back a view
  // that does not show it, and nothing is read for a view that is not on show.
  const shows = facetTitle ? 'library' : view;
  // A recommended tab past the first has its own rows when the server answers tab rows; each is
  // read and held under its own key (core's recommendationTab), the first sharing the library's.
  const rowsTab = shows === 'recommended' ? recommendationTab(tabs, selectedTab?.id, store.catalogue.libraryTabRowsAvailable) : undefined;
  const rowsKey = `${id}|${rowsTab ?? ''}|${revision}`;
  const collectionsKey = `${id}|${revision}|${collectionTab ?? ''}|${tabQuery}`;
  const genresKey = `${id}|${revision}`;
  const needRows = canRecommend && shows === 'recommended';
  const needCollections = canRecommend && (shows === 'collections' || shows === 'people');
  const needGenres = canRecommend && shows === 'genres';
  const [rowsAttempt, setRowsAttempt] = useState(0);
  const [collectionsAttempt, setCollectionsAttempt] = useState(0);
  const [genresAttempt, setGenresAttempt] = useState(0);
  const [rowLoading, setRowLoading] = useState<string[]>([]);
  /** The last quiet re-read of the recommendations on show, so an unchanged answer is not read again on every return. */
  const checked = useRef('');
  const [liveFilterState, setLiveFilterState] = useState({ tab: '', value: '' });
  const liveFilter = liveFilterState.tab === searchKey ? liveFilterState.value : '';
  const setLiveFilter = useCallback((value: string) => setLiveFilterState({ tab: searchKey, value: value.slice(0, 128) }), [searchKey]);
  const liveGeneration = useRef(0);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [liveState, setLiveState] = useState<{ key: string; loading: boolean; failed: boolean; moreLoading?: boolean; items: Card[]; filters: LibraryLiveModel['filters']; cursor: string }>({ key: '', loading: false, failed: false, items: [], filters: [], cursor: '' });
  // A section drawn again (Android releases hidden ones) or prefetched starts from the session's
  // last answer for each part, and refreshes its recommendations quietly if progress moved since.
  const [rows, setRows] = useState<Part<Row[]>>(() => {
    const cached = store.catalogue.cachedLibraryRecommendations(id, rowsTab);
    return cached ? { key: rowsKey, load: 'ready', attempt: 0, value: cached.value, progressRevision: cached.progressRevision } : noPart;
  });
  const [collections, setCollections] = useState<Part<CollectionPage>>(() => {
    const cached = store.catalogue.cachedLibraryCollections(id, collectionTab, tabQuery);
    return cached ? { key: collectionsKey, load: 'ready', attempt: 0, value: cached } : noPart;
  });
  const [genres, setGenres] = useState<Part<Choice[]>>(() => {
    const cached = store.catalogue.cachedLibraryGenres(id);
    return cached ? { key: genresKey, load: 'ready', attempt: 0, value: cached } : noPart;
  });

  useEffect(() => {
    if (!id || !liveTab || !focused || !kind) return;
    const key = `${id}:${liveTab}:${tabQuery}:${liveFilter}:${revision}:${liveAttempt}`;
    let active = true;
    const leave = new AbortController();
    liveGeneration.current++;
    setLiveState({ key, loading: true, failed: false, items: [], filters: [], cursor: '' });
    void store.catalogue.libraryLive(id, liveTab, tabQuery, liveFilter, undefined, leave.signal).then(value => {
      if (active) setLiveState({ key, loading: false, failed: false, items: value.items, filters: value.filters, cursor: value.cursor });
    }).catch(() => { if (active) setLiveState({ key, loading: false, failed: true, items: [], filters: [], cursor: '' }); });
    return () => { active = false; leave.abort(); liveGeneration.current++; };
  }, [store, id, liveTab, tabQuery, liveFilter, revision, liveAttempt, focused, kind]);

  // Recommendations: read while Recommended is on show, and again quietly when progress moves.
  useEffect(() => {
    if (!id || !kind || !focused || !needRows) return;
    const check = `${rowsKey}|${progressRevision}`;
    let held = rows.key === rowsKey && rows.load === 'ready' ? rows.value : undefined;
    let heldRevision = rows.progressRevision;
    if (!held) {
      const cached = store.catalogue.cachedLibraryRecommendations(id, rowsTab);
      if (cached) {
        held = cached.value;
        heldRevision = cached.progressRevision;
        setRows({ key: rowsKey, load: 'ready', attempt: rowsAttempt, value: cached.value, progressRevision: cached.progressRevision });
      }
    }
    if (held && (heldRevision === progressRevision || checked.current === check)) return;
    let active = true;
    if (held) {
      // Recommendations on show are read again quietly (progress moved): they stay as they are,
      // and change only if what they show does. Redrawing a whole library page for an equal
      // answer held a TV's JS thread for 0.6-2 s on returns to the section. A changed answer
      // takes the new places into the rows on show (reconcileProgressRows): unchanged rows and
      // cards keep their objects, so only what moved draws again.
      const shown = held;
      void store.catalogue.libraryRecommendations(id, kind, progressRevision > 0, rowsTab).then(value => {
        if (!active) return;
        checked.current = check;
        if (!value) return;
        const next = reconcileProgressRows(shown, value, true);
        if (next === shown) return;
        startTransition(() => setRows({ key: rowsKey, load: 'ready', attempt: rowsAttempt, value: next, progressRevision }));
      }).catch(() => { if (active) checked.current = check; });
      return () => { active = false; };
    }
    const leave = new AbortController();
    setRows({ key: rowsKey, load: 'loading', attempt: rowsAttempt, progressRevision });
    void store.catalogue.libraryRecommendations(id, kind, progressRevision > 0, rowsTab, leave.signal).then(value => {
      if (active) setRows({ key: rowsKey, load: 'ready', attempt: rowsAttempt, value: value ?? [], progressRevision });
    }).catch(() => {
      if (active) setRows({ key: rowsKey, load: 'failed', attempt: rowsAttempt, progressRevision });
    });
    return () => { active = false; leave.abort(); };
  }, [store, id, kind, rowsKey, rowsTab, needRows, progressRevision, focused, rowsAttempt]);

  // Collections (or a people tab): read only while that view is on show, held for the session,
  // and read again only when the viewer asks (Try again). Progress never changes them.
  useEffect(() => {
    if (!id || !kind || !focused || !needCollections) return;
    if (collections.key === collectionsKey && collections.attempt === collectionsAttempt && collections.load === 'ready') return;
    const refresh = collections.key === collectionsKey && collections.attempt !== collectionsAttempt;
    const cached = refresh ? undefined : store.catalogue.cachedLibraryCollections(id, collectionTab, tabQuery);
    if (cached) {
      setCollections({ key: collectionsKey, load: 'ready', attempt: collectionsAttempt, value: cached });
      return;
    }
    let active = true;
    // Leaving the view stops a read the server asked to retry later (read-retry.ts).
    const leave = new AbortController();
    setCollections({ key: collectionsKey, load: 'loading', attempt: collectionsAttempt });
    void store.catalogue.libraryCollectionPage(id, collectionTab, tabQuery, refresh, leave.signal).then(value => {
      if (active) setCollections({ key: collectionsKey, load: 'ready', attempt: collectionsAttempt, value: value ?? { items: [], cursor: '' } });
    }).catch(() => {
      if (active) setCollections({ key: collectionsKey, load: 'failed', attempt: collectionsAttempt });
    });
    return () => { active = false; leave.abort(); };
  }, [store, id, kind, collectionsKey, needCollections, collectionTab, tabQuery, focused, collectionsAttempt]);

  // Genres: read while the Genres view is on show, held for the session.
  useEffect(() => {
    if (!id || !kind || !focused || !needGenres) return;
    if (genres.key === genresKey && genres.attempt === genresAttempt && genres.load === 'ready') return;
    const refresh = genres.key === genresKey && genres.attempt !== genresAttempt;
    const cached = refresh ? undefined : store.catalogue.cachedLibraryGenres(id);
    if (cached) {
      setGenres({ key: genresKey, load: 'ready', attempt: genresAttempt, value: cached });
      return;
    }
    let active = true;
    const leave = new AbortController();
    setGenres({ key: genresKey, load: 'loading', attempt: genresAttempt });
    void store.catalogue.libraryGenreChoices(id, refresh, leave.signal).then(value => {
      if (active) setGenres({ key: genresKey, load: 'ready', attempt: genresAttempt, value: value ?? [] });
    }).catch(() => {
      if (active) setGenres({ key: genresKey, load: 'failed', attempt: genresAttempt });
    });
    return () => { active = false; leave.abort(); };
  }, [store, id, kind, genresKey, needGenres, focused, genresAttempt]);

  const rowsPart = rows.key === rowsKey ? rows : undefined;
  const collectionsPart = collections.key === collectionsKey ? collections : undefined;
  const genresPart = genres.key === genresKey ? genres : undefined;
  const nativeExtras = useMemo<LibraryExtras | undefined>(() => canRecommend ? libraryExtras(shows, rowsPart, collectionsPart, genresPart) : undefined,
    [canRecommend, shows, rowsPart, collectionsPart, genresPart]);
  const rawExtras = useMemo<LibraryExtras | undefined>(() => nativeExtras ? { ...nativeExtras, genres: nativeExtras.genres.length ? nativeExtras.genres : current?.value?.genres ?? [] } : (current?.value?.genres.length ? {
    recommendationsAvailable: false, collectionsAvailable: false, rows: [], collections: [], collectionCursor: '', genres: current.value.genres, failed: false,
  } : undefined), [nativeExtras, current?.value]);
  // The tab's own card (a Concerts tab's 16:9 video cards in a square Music library) over the library's.
  const libraryCard = (current?.value ?? earlier)?.presentation?.card;
  const card = selectedTab?.kind === 'live' ? undefined : tabCard(selectedTab, libraryCard, store.catalogue.libraryTabCardsAvailable);
  const landscape = (card ?? libraryCard) === 'landscape';
  const extras = useMemo(() => rawExtras && landscape ? { ...rawExtras, rows: rawExtras.rows.map(row => ({ ...row, items: row.items.map(card => libraryCardArtwork(card, 'landscape')) })) } : rawExtras, [rawExtras, landscape]);
  const usableView = facetTitle ? 'library' : tabs ? view : view === 'recommended' && !canRecommend || view === 'collections' && !canRecommend || view === 'genres' && !extras?.genres.length ? 'library' : view;

  useEffect(() => {
    if (focused && !current?.value && current?.load !== 'loading' && current?.load !== 'failed') void store.catalogue.library(id, browseQuery, current?.value?.pages ?? 1, !!current?.value);
    // The key names the query; a session change empties the store, which reads it again.
  }, [store, id, key, missing, focused, browseQuery]);

  const page = useMemo<LibraryPage>(() => {
    const held = current?.value;
    const extrasView = usableView === 'recommended' || usableView === 'collections' || usableView === 'people' || usableView === 'genres' && canRecommend;
    const part = extrasView ? viewPart(usableView, rowsPart, collectionsPart, genresPart) : undefined;
    // While a new view is read, the library's last view stays on show under the new controls.
    return {
      model: (() => {
        const model = held ?? (earlier ? asQueried(earlier, browseQuery) : undefined);
        return model ? { ...model, genres: extras?.genres ?? model.genres,
          ...(card && card !== model.presentation?.card ? { presentation: { card }, ...(card === 'landscape' ? { items: model.items.map(item => libraryCardArtwork(item, card)) } : {}) } : {}),
          ...(usableView === 'live' ? { presentation: { card: selectedTab?.card ?? 'landscape' }, items: liveState.items, more: !!liveState.cursor, pages: 1 } : {}) } : model;
      })(),
      loading: !held && current?.load !== 'failed',
      moreLoading: usableView === 'live' ? !!liveState.moreLoading : (usableView === 'collections' || usableView === 'people') ? !!collectionsPart?.moreLoading : !!held && current?.load === 'loading',
      view: usableView,
      layout: viewTab?.layout ?? 'grid',
      viewLoad: usableView === 'live' ? liveState.failed ? 'failed' : liveState.loading ? 'loading' : 'ready'
        : !extrasView ? current?.load ?? 'idle'
        : part?.load ?? 'idle',
      tabId: selectedTab?.id,
      tabQuery,
      liveFilter,
      liveFilters: usableView === 'live' ? liveState.filters : undefined,
      facetTitle,
      canRecommend,
      liveAvailable,
      viewRequest: requestedView ?? '',
      extras,
      // Only the part the view shows: Recommended never waits on, or fails with, collections.
      extrasLoading: extrasView && (!part || part.load === 'idle' || part.load === 'loading'),
      extrasFailed: extrasView && (part?.load === 'failed' || !!part?.moreFailed),
    };
  }, [current, earlier, browseQuery, facetTitle, card, selectedTab?.id, selectedTab?.card, viewTab?.layout, usableView, requestedView, extras, rowsPart, collectionsPart, genresPart, canRecommend, liveAvailable, tabQuery, liveFilter, liveState]);

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
    if (page.view === 'collections' || page.view === 'people') {
      const cursor = collectionsPart?.value?.cursor;
      if (!cursor || collectionsPart.moreLoading || collectionsPart.moreFailed) return;
      const key = collectionsKey;
      const same = (previous: Part<CollectionPage>) => previous.key === key && previous.value?.cursor === cursor;
      setCollections(previous => same(previous) ? { ...previous, moreLoading: true } : previous);
      void store.catalogue.moreLibraryCollections(id, cursor, collectionTab, tabQuery).then(result => setCollections(previous => !same(previous) ? previous : {
        ...previous, moreLoading: false, value: { items: [...previous.value!.items, ...result.items], cursor: result.cursor },
      })).catch(() => setCollections(previous => same(previous) ? { ...previous, moreLoading: false, moreFailed: true } : previous));
      return;
    }
    if (page.view !== 'library' && page.view !== 'view') return;
    const held = current?.value;
    if (!held?.more || current?.load === 'loading') return;
    void store.catalogue.library(id, browseQuery, held.pages + 1);
  }, [store, id, browseQuery, current, page.view, collectionsPart, collectionsKey, collectionTab, tabQuery, liveTab, liveFilter, liveState]);

  const retry = useCallback(() => {
    if (page.view === 'live') {
      setLiveAttempt(value => value + 1);
      return;
    }
    if (page.view === 'recommended') setRowsAttempt(value => value + 1);
    else if (page.view === 'genres') setGenresAttempt(value => value + 1);
    else if (page.view === 'collections' || page.view === 'people') {
      // A page that failed to follow keeps what it shows and may page again; a failed first page is read again.
      if (collectionsPart?.moreFailed && collectionsPart.load === 'ready') setCollections(previous => ({ ...previous, moreFailed: false }));
      else setCollectionsAttempt(value => value + 1);
    }
    if (current?.load === 'failed' || page.view === 'library' || page.view === 'view') void store.catalogue.library(id, browseQuery, current?.value?.pages ?? 1);
  }, [store, id, browseQuery, current, page.view, collectionsPart]);

  const moreRow = useCallback((rowId: string) => {
    const row = rowsPart?.value?.find(item => item.id === rowId);
    if (!row?.nextCursor || rowLoading.includes(rowId)) return;
    const cursor = row.nextCursor;
    const key = rowsKey;
    setRowLoading(ids => [...ids, rowId]);
    void store.catalogue.moreLibraryRow(rowId, cursor, id).then(next => setRows(previous => {
      if (previous.key !== key || !previous.value) return previous;
      return { ...previous, value: previous.value.map(item => item.id === rowId && item.nextCursor === cursor
        ? { ...item, items: [...item.items, ...next.items], nextCursor: next.nextCursor, continuation: next.continuation } : item) };
    })).catch(() => { /* The row keeps its cursor; the viewer can page again. */ })
      .finally(() => setRowLoading(ids => ids.filter(value => value !== rowId)));
  }, [store, id, rowsKey, rowsPart, rowLoading]);

  return useMemo(() => ({ page, load, more, rowLoading, moreRow, retry, setSearch, setLiveFilter }), [page, load, more, rowLoading, moreRow, retry, setSearch, setLiveFilter]);
}
