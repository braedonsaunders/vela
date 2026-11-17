// One library page: its view (the URL's sort and filters) read from core's store when it is not
// held yet, what the page shows meanwhile, and its next page. Each view is kept in the store for
// the session, so a revisited view shows at once and paging continues where it stopped.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { libraryKey, type LibraryExtras, type LibraryQuery } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import type { Env } from '@vela/skin';
import type { LibraryPage } from '@vela/skin/src/widgets/library/model';
import { useSectionFocus } from '../section-focus';
import { asQueried } from './library-query';

export interface LibraryState {
  page: LibraryPage;
  load: Env['load'];
  /** Read the view's next page (the document's Show more, or its sentinel). */
  more(): void;
  rowLoading: string[];
  moreRow(id: string): void;
  /** Read the view again after a failure. */
  retry(): void;
}

export function useLibraryPage(id: string, query: LibraryQuery, requestedView?: string): LibraryState {
  const store = useVela();
  const revision = useVelaState(state => state.auth.revision);
  const focused = useSectionFocus() ?? true;
  const key = libraryKey(id, query);
  const current = useVelaState(state => state.library[key]);
  const earlier = useMemo(() => Object.values(store.getState().library)
    .find(view => view.value?.id === id)?.value, [store, id, key]);
  const missing = current === undefined;
  const kind = current?.value?.kind;
  const [extraAttempt, setExtraAttempt] = useState(0);
  const [rowLoading, setRowLoading] = useState<string[]>([]);
  const [extraState, setExtraState] = useState<{ id: string; revision: number; loading: boolean; failed: boolean; moreLoading?: boolean; value?: LibraryExtras }>({ id: '', revision: -1, loading: false, failed: false });

  useEffect(() => {
    if (!id || !kind || !focused) return;
    let active = true;
    setExtraState({ id, revision, loading: true, failed: false });
    void store.catalogue.libraryExtras(id, kind).then(value => {
      if (active) setExtraState({ id, revision, loading: false, failed: false, value });
    }).catch(() => {
      if (active) setExtraState({ id, revision, loading: false, failed: true });
    });
    return () => { active = false; };
  }, [store, id, kind, revision, focused, extraAttempt]);
  const nativeExtras = extraState.id === id && extraState.revision === revision ? extraState.value : undefined;
  const extras = useMemo<LibraryExtras | undefined>(() => nativeExtras ?? (current?.value?.genres.length ? {
    recommendationsAvailable: false, collectionsAvailable: false, rows: [], collections: [], collectionCursor: '', genres: current.value.genres, failed: false,
  } : undefined), [nativeExtras, current?.value]);
  const view = requestedView === 'library' || requestedView === 'recommended' || requestedView === 'collections' || requestedView === 'genres'
    ? requestedView : extras?.recommendationsAvailable ? 'recommended' : 'library';
  const usableView = view === 'recommended' && !extras?.recommendationsAvailable || view === 'collections' && !extras?.collectionsAvailable || view === 'genres' && !extras?.genres.length ? 'library' : view;

  useEffect(() => {
    if (focused && current?.load !== 'loading') void store.catalogue.library(id, query, current?.value?.pages ?? 1, !!current?.value);
    // The key names the query; a session change empties the store, which reads it again.
  }, [store, id, key, missing, focused]);

  const page = useMemo<LibraryPage>(() => {
    const held = current?.value;
    // While a new view is read, the library's last view stays on show under the new controls.
    return {
      model: (() => {
        const model = held ?? (earlier ? asQueried(earlier, query) : undefined);
        return model && extras ? { ...model, genres: extras.genres } : model;
      })(),
      loading: !held && current?.load !== 'failed',
      moreLoading: usableView === 'collections' ? !!extraState.moreLoading : !!held && current?.load === 'loading',
      view: usableView,
      viewRequest: requestedView ?? '',
      extras,
      extrasLoading: extraState.id === id && extraState.loading,
      extrasFailed: extraState.id === id && (extraState.failed || !!extras?.failed),
    };
  }, [current, earlier, query, usableView, requestedView, extras, extraState]);

  const failed = current?.load === 'failed' && !current.value;
  const load: Env['load'] = failed ? 'failed' : page.model ? 'ready' : 'loading';

  const more = useCallback(() => {
    if (page.view === 'collections' && extras?.collectionCursor && !extraState.moreLoading) {
      const cursor = extras.collectionCursor;
      setExtraState(previous => ({ ...previous, moreLoading: true }));
      void store.catalogue.moreLibraryCollections(id, cursor).then(result => setExtraState(previous => previous.id !== id || previous.revision !== revision || previous.value?.collectionCursor !== cursor ? previous : {
        ...previous, moreLoading: false, value: { ...previous.value, collections: [...previous.value.collections, ...result.items], collectionCursor: result.cursor },
      })).catch(() => setExtraState(previous => previous.id === id && previous.revision === revision ? { ...previous, moreLoading: false, failed: true } : previous));
      return;
    }
    if (page.view !== 'library') return;
    const held = current?.value;
    if (!held?.more || current?.load === 'loading') return;
    void store.catalogue.library(id, query, held.pages + 1);
  }, [store, id, revision, query, current, extras, page.view, extraState.moreLoading]);

  const retry = useCallback(() => {
    setExtraAttempt(value => value + 1);
    void store.catalogue.library(id, query, current?.value?.pages ?? 1);
  }, [store, id, query, current]);

  const moreRow = useCallback((rowId: string) => {
    const row = extras?.rows.find(item => item.id === rowId);
    if (!row?.nextCursor || rowLoading.includes(rowId)) return;
    const cursor = row.nextCursor;
    setRowLoading(ids => [...ids, rowId]);
    void store.catalogue.moreLibraryRow(rowId, cursor).then(next => setExtraState(previous => {
      if (previous.id !== id || previous.revision !== revision || !previous.value) return previous;
      return { ...previous, value: { ...previous.value, rows: previous.value.rows.map(item => item.id === rowId && item.nextCursor === cursor
        ? { ...item, items: [...item.items, ...next.items], nextCursor: next.nextCursor, continuation: next.continuation } : item) } };
    })).catch(() => setExtraState(previous => previous.id === id && previous.revision === revision ? { ...previous, failed: true } : previous))
      .finally(() => setRowLoading(ids => ids.filter(value => value !== rowId)));
  }, [store, id, revision, extras, rowLoading]);

  return { page, load, more, rowLoading, moreRow, retry };
}
