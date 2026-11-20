// One collection page (a box set, a folder, a playlist): read from core's store when it is not
// held yet, page by page from the server's cursor. A failed read, first or further, shows the
// page's failure; trying again reads the collection from its start.
import { useCallback, useEffect, useMemo } from 'react';
import { useVela, useVelaState } from '@vela/core/react';
import type { Env } from '@vela/skin';
import type { CollectionPage } from '@vela/skin/src/widgets/library/model';

export interface CollectionState {
  page: CollectionPage;
  load: Env['load'];
  more(): void;
  retry(): void;
}

export function useCollectionPage(id: string, playlist = false): CollectionState {
  const store = useVela();
  const current = useVelaState(state => state.collections[id]);
  const missing = current === undefined;

  useEffect(() => {
    if (missing && id) void (playlist ? store.playlists.open(id) : store.catalogue.collection(id));
  }, [store, id, missing, playlist]);

  const page = useMemo<CollectionPage>(
    () => ({ model: current?.value, moreLoading: !!current?.value && current.load === 'loading' }),
    [current],
  );
  const load: Env['load'] = current?.load === 'failed' ? 'failed' : current?.value ? 'ready' : 'loading';
  const more = useCallback(() => void (playlist ? store.playlists.open(id, true) : store.catalogue.collection(id, true)), [store, id, playlist]);
  const retry = useCallback(() => void (playlist ? store.playlists.open(id) : store.catalogue.collection(id)), [store, id, playlist]);

  return { page, load, more, retry };
}
