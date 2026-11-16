// One library page: its view (the URL's sort and filters) read from core's store when it is not
// held yet, what the page shows meanwhile, and its next page. Each view is kept in the store for
// the session, so a revisited view shows at once and paging continues where it stopped.
import { useCallback, useEffect, useMemo } from 'react';
import { libraryKey, type LibraryQuery } from '@vela/core';
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
  /** Read the view again after a failure. */
  retry(): void;
}

export function useLibraryPage(id: string, query: LibraryQuery): LibraryState {
  const store = useVela();
  const focused = useSectionFocus() ?? true;
  const key = libraryKey(id, query);
  const current = useVelaState(state => state.library[key]);
  const earlier = useMemo(() => Object.values(store.getState().library)
    .find(view => view.value?.id === id)?.value, [store, id, key]);
  const missing = current === undefined;

  useEffect(() => {
    if (focused && current?.load !== 'loading') void store.catalogue.library(id, query, current?.value?.pages ?? 1, !!current?.value);
    // The key names the query; a session change empties the store, which reads it again.
  }, [store, id, key, missing, focused]);

  const page = useMemo<LibraryPage>(() => {
    const held = current?.value;
    // While a new view is read, the library's last view stays on show under the new controls.
    return {
      model: held ?? (earlier ? asQueried(earlier, query) : undefined),
      loading: !held && current?.load !== 'failed',
      moreLoading: !!held && current?.load === 'loading',
    };
  }, [current, earlier, query]);

  const failed = current?.load === 'failed' && !current.value;
  const load: Env['load'] = failed ? 'failed' : page.model ? 'ready' : 'loading';

  const more = useCallback(() => {
    const held = current?.value;
    if (!held?.more || current?.load === 'loading') return;
    void store.catalogue.library(id, query, held.pages + 1);
  }, [store, id, query, current]);

  const retry = useCallback(() => {
    void store.catalogue.library(id, query, current?.value?.pages ?? 1);
  }, [store, id, query, current]);

  return { page, load, more, retry };
}
